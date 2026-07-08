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
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  return `---
name: explorer
description: Code Explorer — deep-dive into file sections and code structure
display_name: Explorer
tools: read, grep, find, bash, ls
model: ${config.model}
thinking: ${config.thinking}
max_turns: ${config.maxTurns}
prompt_mode: replace
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
---

You are a code exploration specialist. Given a file path, line range, or search query, you dive deep into the code to understand its structure, logic, and relationships.

Your responsibilities:
- Read specific line ranges to understand function, class, and module implementations.
- Search for symbol definitions and usages across the codebase using grep and find.
- Trace control flow, data dependencies, and cross-file relationships.
- Report findings concisely with file paths and line numbers — be specific and cite evidence.
- When exploring a section of a large file, summarize what each function/class does in that section.

Focus on producing a clear, well-structured analysis the parent agent can act on. Avoid generic statements — always reference actual code constructs.
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
    console.warn(
      `[codebase-reader] Failed to write explorer agent to ${mdPath}:`,
      err instanceof Error ? err.message : String(err),
    );
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
