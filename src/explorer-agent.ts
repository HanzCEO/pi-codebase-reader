/**
 * Explorer subagent — registers the `explorer` agent type for use with EITHER
 * `@tintinweb/pi-subagents` OR `nicobailon/pi-subagents`.
 *
 * The agent definition file uses a YAML frontmatter format that is compatible
 * with both subagent libraries:
 *
 * - **@tintinweb/pi-subagents** reads `name` from the filename (`explorer`),
 *   supports `display_name`, `max_turns`, and `prompt_mode`.
 * - **nicobailon/pi-subagents** reads `name` from frontmatter, supports
 *   `systemPromptMode`, `inheritProjectContext`, and `inheritSkills`.
 *
 * Both ignore unknown frontmatter fields, so including fields from both
 * formats makes the agent file work with either library without conflict.
 *
 * The system prompt includes the SHERLOC protocol for structured bug-localization.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExplorerAgentConfig } from "./types.js";

// ── Detection keys ──────────────────────────────────────────────────────

/** @tintinweb/pi-subagents signals availability via this global Symbol. */
const SUBAGENTS_MANAGER_KEY = Symbol.for("pi-subagents:manager");

/**
 * nicobailon/pi-subagents sets a runtime cleanup function on globalThis
 * during its extension initialization.
 */
const NICOBALLON_RUNTIME_KEY = "__piSubagentRuntimeCleanup";

// ── Agent file template ─────────────────────────────────────────────────

/**
 * Explorer agent definition file — YAML frontmatter compatible with both
 * `@tintinweb/pi-subagents` and `nicobailon/pi-subagents`.
 *
 * Fields used by @tintinweb:
 *   display_name, description, tools, model, thinking, max_turns, prompt_mode
 *
 * Fields used by nicobailon:
 *   name, description, tools, model, thinking, systemPromptMode,
 *   inheritProjectContext, inheritSkills
 *
 * Both ignore unknown fields, so we can safely include all of them.
 */
function explorerAgentMd(config: ExplorerAgentConfig): string {
  const readToolName = config.useShortRead ? "short_read" : "read";
  const tools = config.useShortRead
    ? "short_read, read, grep, find, bash, ls, repo_tree, connected_tree"
    : "read, grep, find, bash, ls, repo_tree, connected_tree";

  return `---
name: explorer
description: Explorer — code structure, bug-localization
display_name: Explorer
tools: ${tools}
model: ${config.model}
thinking: ${config.thinking}
max_turns: ${config.maxTurns}
prompt_mode: replace
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
completionGuard: false
---

Code exploration & bug-localization specialist. Dive deep: structure, logic, relationships, root causes.

## Responsibilities
- Read line ranges for function/class/module implementations.
- Search for symbol definitions and usages using the \`grep\` tool directly (NOT via bash).
- Trace control flow, data deps, cross-file relationships.
- Report: file paths + line numbers, cite evidence.
- Large-file sections: summarize each function/class.

## SHERLOC Protocol
Given bug/issue:
1. Read description.
2. First response = tool call (no final answer yet).
3. Tool calls until all edit sites found.
4. Over-inspect vs miss.
5. Emit <findings> + <locations>.

### Output
<findings>
- Location: why modify
- Root cause
- Fix idea (no code)
- Affected modules
- Test impact
</findings>

<locations>
- file:lines
</locations>

## Tools
- **${readToolName}**: File content; AST outline; offset/limit.
- **grep**: Search for patterns across the codebase. Use this DIRECTLY, not via bash.
- **find**: File locator.
- **bash**: Shell commands (use only when grep/find cannot accomplish the task).
- **ls**: Dir listing.
- **repo_tree**: Repository file hierarchy with line counts.
- **connected_tree**: Import dependency graph.

## Critical: Use grep tool, not bash grep
The \`grep\` tool is a dedicated pi tool that returns structured results. Always use it directly:
- ✅ grep(pattern: \"func.*Create\", path: \"core/vm\")
- ❌ bash(command: \"grep -rn 'func.*Create' core/vm\")

Structured analysis for parent. Cite code constructs, paths, lines.
`;
}

// ── Agent file management ───────────────────────────────────────────────

/**
 * Ensure the explorer.md agent definition file exists in the global agents
 * directory so either subagent library discovers it automatically.
 */
export function ensureExplorerAgent(config: ExplorerAgentConfig): string | null {
  const agentsDir = join(getAgentDir(), "agents");

  try {
    mkdirSync(agentsDir, { recursive: true });
  } catch {
    // If we can't create the directory, fall back to project-level
    return null;
  }

  const mdPath = join(agentsDir, "explorer.md");
  const content = explorerAgentMd(config);

  try {
    writeFileSync(mdPath, content, "utf-8");
    return mdPath;
  } catch (err) {
    console.warn(`[codebase-reader] write ${mdPath}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Update the explorer.md file with new config (e.g., model change).
 * Rewrites the whole file so either subagent library picks up the change
 * on next reload.
 */
export function updateExplorerAgent(config: ExplorerAgentConfig): boolean {
  const agentsDir = join(getAgentDir(), "agents");
  const mdPath = join(agentsDir, "explorer.md");

  try {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(mdPath, explorerAgentMd(config), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the explorer.md agent definition file.
 * Only for manual command use (/codebase-reader-explorer uninstall).
 * Automatic uninstall on npm uninstall has been removed in favor of
 * reinstallation on session_start.
 */
export function removeExplorerAgent(): boolean {
  const agentsDir = join(getAgentDir(), "agents");
  const mdPath = join(agentsDir, "explorer.md");

  try {
    if (existsSync(mdPath)) {
      unlinkSync(mdPath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reinstall the explorer agent file.
 * Overwrites the agent definition file to ensure it's always current.
 * Called on session_start/session_shutdown to refresh the definition.
 */
export function reinstallExplorerAgent(config: ExplorerAgentConfig): string | null {
  const agentsDir = join(getAgentDir(), "agents");
  const mdPath = join(agentsDir, "explorer.md");

  try {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(mdPath, explorerAgentMd(config), "utf-8");
    return mdPath;
  } catch (err) {
    console.warn(`[codebase-reader] Failed to write explorer agent:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── Subagent library detection ──────────────────────────────────────────

export type SubagentLibrary = "@tintinweb/pi-subagents" | "pi-subagents" | null;

/**
 * Check if @tintinweb/pi-subagents is loaded by probing its Symbol-based
 * global manager.
 */
export function isTintinwebSubagentsAvailable(): boolean {
  return typeof (globalThis as any)[SUBAGENTS_MANAGER_KEY] !== "undefined";
}

/**
 * Check if nicobailon/pi-subagents is loaded by probing its runtime
 * cleanup function stored on globalThis.
 */
export function isNicobailonSubagentsAvailable(): boolean {
  return typeof (globalThis as any)[NICOBALLON_RUNTIME_KEY] === "function";
}

/**
 * Detect which (if any) subagent library is currently loaded.
 * Returns the detected library identifier or null if none found.
 *
 * Note: at extension init time, other extensions may not have completed
 * initialization yet. This function is most reliable when called from
 * a session_start handler or later.
 */
export function detectSubagentLibrary(): SubagentLibrary {
  if (isTintinwebSubagentsAvailable()) {
    return "@tintinweb/pi-subagents";
  }
  if (isNicobailonSubagentsAvailable()) {
    return "pi-subagents";
  }
  return null;
}

/**
 * Get a human-readable label for the detected subagent library.
 */
export function formatSubagentLibrary(lib: SubagentLibrary): string {
  switch (lib) {
    case "@tintinweb/pi-subagents":
      return "@tintinweb/pi-subagents";
    case "pi-subagents":
      return "pi-subagents (nicobailon)";
    default:
      return "none";
  }
}
