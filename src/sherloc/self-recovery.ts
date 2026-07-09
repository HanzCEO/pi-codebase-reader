/**
 * SHERLOC Self-Recovery Mechanisms.
 *
 * Lightweight recovery for common failure modes in multi-turn tool use:
 *   1. Loop detection — warns when the LLM repeats identical tool calls
 *   2. Implicit tool-call recovery — parses malformed but unambiguous requests
 *   3. Context management — first-and-recent truncation strategy
 *   4. Response-length management — re-prompts when near the safe limit
 *   5. Final-turn prompting — forces synthesis when the step budget is exhausted
 */

import type { RecoveryState } from "./types.js";

// ── Loop Detection ──────────────────────────────────────────────────────

/**
 * Check the tool call history for repeated identical calls.
 * Returns a warning message if a loop is detected, or null if clean.
 */
export function detectLoop(
  state: RecoveryState,
  toolName: string,
  params: Record<string, unknown>,
): string | null {
  const key = `${toolName}(${JSON.stringify(params)})`;
  const recent = state.toolCallHistory;

  // Count consecutive identical calls
  let count = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const prev = recent[i];
    const prevKey = `${prev.name}(${JSON.stringify(prev.params)})`;
    if (prevKey === key) {
      count++;
    } else {
      break;
    }
  }

  if (count >= state.loopThreshold) {
    return (
      `[Self-Recovery] Loop detected! You have attempted ${toolName} ` +
      `${count + 1} times with the same parameters. ` +
      `DO NOT repeat the same command. Try a different approach or ` +
      `a different file/query to gather new evidence.`
    );
  }

  return null;
}

/**
 * Record a tool call in the history for loop detection.
 */
export function recordToolCall(
  state: RecoveryState,
  toolName: string,
  params: Record<string, unknown>,
): void {
  state.toolCallHistory.push({ name: toolName, params });

  // Keep history bounded
  if (state.toolCallHistory.length > 20) {
    state.toolCallHistory.shift();
  }
}

/**
 * Reset the tool call history (e.g., after a strategy change).
 */
export function resetToolCallHistory(state: RecoveryState): void {
  state.toolCallHistory = [];
}

// ── Implicit Tool-Call Recovery ─────────────────────────────────────────

/**
 * Patterns that indicate a tool call even when the model omits the
 * canonical <tool_call> wrapper.
 *
 * Matches patterns like:
 *   - view_file("path/to/file.py", 10, 50)
 *   - View file: path/to/file.py lines 10-50
 *   - Search for "some string" in codebase
 *   - Show me the repo tree
 *   - connected_tree for path/to/file.py
 */
const TOOL_CALL_PATTERNS: Array<{
  name: string;
  regex: RegExp;
  parse: (match: RegExpMatchArray) => Record<string, unknown> | null;
}> = [
  {
    // view_file("path", start, end) or view_file("path")
    name: "view_file",
    regex: /view_file\s*\(\s*["']([^"']+)["']\s*(?:,\s*(\d+)\s*(?:,\s*(\d+))?)?\s*\)/i,
    parse: (m) => {
      const params: Record<string, unknown> = { path: m[1] };
      if (m[2]) params.offset = parseInt(m[2], 10);
      if (m[3]) params.limit = parseInt(m[3], 10);
      return params;
    },
  },
  {
    // View file: "path" lines 10-50 (quoted path with optional line range)
    name: "view_file",
    regex: /view\s+file:?\s+"([^"]+)"(?:\s+lines?\s*(\d+)\s*-?\s*(\d+))?/i,
    parse: (m) => {
      const params: Record<string, unknown> = { path: m[1].trim() };
      if (m[2]) params.offset = parseInt(m[2], 10);
      if (m[3]) params.limit = parseInt(m[3], 10) - parseInt(m[2], 10) + 1;
      return params;
    },
  },
  {
    // View file: path lines 10-50 (unquoted path with line range — "lines" is non-optional so the non-greedy capture works)
    name: "view_file",
    regex: /view\s+file:?\s+([^"'\n]+?)\s+lines?\s*(\d+)\s*-?\s*(\d+)/i,
    parse: (m) => {
      const params: Record<string, unknown> = { path: m[1].trim() };
      params.offset = parseInt(m[2], 10);
      params.limit = parseInt(m[3], 10) - parseInt(m[2], 10) + 1;
      return params;
    },
  },
  {
    // View file: path (unquoted path, no line range — greedy capture to end of available text)
    name: "view_file",
    regex: /view\s+file:?\s+([^"'\n]+)/i,
    parse: (m) => {
      const params: Record<string, unknown> = { path: m[1].trim() };
      return params;
    },
  },
  {
    // codebase_search("query") or Search for "query"
    name: "codebase_search",
    regex: /(?:codebase_search\s*\(\s*["']([^"']+)["']\s*\)|search\s+for\s+["']([^"']+)["'])/i,
    parse: (m) => ({ query: m[1] || m[2] }),
  },
  {
    // repo_tree() or Show repo tree / repository tree
    name: "repo_tree",
    regex: /(?:repo_tree\s*\(\s*\)|show\s+(?:the\s+)?(?:repo|repository|directory)\s+tree)/i,
    parse: () => ({}),
  },
  {
    // connected_tree("path") or connected_tree for path
    name: "connected_tree",
    regex: /connected_tree\s*(?:\(\s*["']([^"']+)["']\s*\)|for\s+([^"'\n]+))/i,
    parse: (m) => ({ path: m[1] || m[2] }),
  },
];

/**
 * Try to recover a malformed tool call from free-form text.
 * Returns the tool name and params if a pattern matches, or null.
 */
export function recoverToolCall(
  text: string,
): { name: string; params: Record<string, unknown> } | null {
  for (const pattern of TOOL_CALL_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      const params = pattern.parse(match);
      if (params) {
        return { name: pattern.name, params };
      }
    }
  }
  return null;
}

// ── Context Management ──────────────────────────────────────────────────

/**
 * Truncation strategy: preserve the initial prompt + system preamble
 * and the most recent N turns, dropping intermediate observations.
 *
 * This is the "first-and-recent" strategy from the SHERLOC paper.
 */
export function truncateContext<T extends { role: string; content?: string }>(
  messages: T[],
  preserveFirst: number,
  preserveLast: number,
): T[] {
  if (messages.length <= preserveFirst + preserveLast) {
    return messages;
  }

  const head = messages.slice(0, preserveFirst);
  const tail = messages.slice(-preserveLast);

  // Insert a truncation marker
  const truncationMarker = {
    role: "system",
    content: `[Context truncated: ${messages.length - preserveFirst - preserveLast} intermediate messages removed to stay within context budget. Continue with the most recent observations.]`,
  } as T;

  return [...head, truncationMarker, ...tail];
}

/**
 * Estimate rough message size (characters).
 */
export function estimateMessageSize(msg: { content?: string }): number {
  return (msg.content || "").length;
}

/**
 * Check if context exceeds a threshold and return truncated version if so.
 */
export function manageContext<T extends { role: string; content?: string }>(
  messages: T[],
  maxTotalChars: number = 80_000,
): T[] {
  const totalChars = messages.reduce((sum, m) => sum + estimateMessageSize(m), 0);

  if (totalChars <= maxTotalChars) {
    return messages; // no truncation needed
  }

  // Preserve first 2 messages (system prompt + initial user message)
  // and last 6 turns (recent observations)
  return truncateContext(messages, 2, 6);
}

// ── Response-Length Management ──────────────────────────────────────────

/**
 * Check if a response is approaching the safe limit.
 * Returns a re-prompt message if the response is too long, or null.
 */
export function checkResponseLength(
  responseText: string,
  maxSafeLength: number = 30_000,
): string | null {
  if (responseText.length > maxSafeLength) {
    return (
      `[Self-Recovery] Your response is approaching the output length limit. ` +
      `Please be more concise: reduce your thinking to only the most essential ` +
      `analysis steps and avoid verbose reasoning. Focus on what new evidence ` +
      `you need next.`
    );
  }
  return null;
}

// ── Final-Turn Prompting ────────────────────────────────────────────────

/**
 * Generate the final-turn synthesis prompt.
 * This is injected when the step budget is nearly exhausted.
 */
export function finalTurnPrompt(
  remainingTurns: number,
): string | null {
  if (remainingTurns > 1) {
    return null; // not yet time
  }

  return (
    `[Self-Recovery] You have reached the maximum number of tool calls. ` +
    `You must now reply with a findings and locations block.\n\n` +
    `In findings, provide:\n` +
    `- Location explanation: why each location needs modification\n` +
    `- Root cause: what causes the issue\n` +
    `- Solution idea: how to fix it (without showing code)\n` +
    `- Dependencies: related modules that may be affected\n` +
    `- Testing impact: what tests to update or add\n\n` +
    `In locations, emit every file and line range that needs editing.`
  );
}

/**
 * Inject a turn-increment hint into the system prompt so the model
 * knows this is a multi-turn localization session.
 */
export function sherlocSystemPromptSupplement(maxTurns: number): string {
  return (
    `\n\n` +
    `## Interaction Protocol\n` +
    `1. Read the Problem Description carefully.\n` +
    `2. Your first response must be a tool call, never a final answer.\n` +
    `3. Keep issuing tool calls until you are fully confident you have ` +
    `found every code location that needs modification.\n` +
    `4. Only then reply with a <findings> and <locations> block.\n` +
    `5. You have a maximum of ${maxTurns} tool-call turns. Use them wisely.\n\n` +
    `## Final Output Format\n` +
    `When you are confident, emit:\n` +
    `<findings>\n` +
    `- Location explanation: ...\n` +
    `- Root cause: ...\n` +
    `- Solution idea: ...\n` +
    `- Dependencies: ...\n` +
    `- Testing impact: ...\n` +
    `</findings>\n` +
    `<locations>\n` +
    `- path/to/file.py lines 10-50\n` +
    `- path/to/another.py lines 100-150\n` +
    `</locations>`
  );
}
