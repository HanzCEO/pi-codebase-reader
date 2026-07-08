/**
 * Explorer subagent — registers the `explorer` agent type with @tintinweb/pi-subagents.
 *
 * This module handles:
 * 1. Writing the `explorer.md` agent definition to the global agents directory
 * 2. Detecting pi-subagents availability via Symbol.for
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExplorerAgentConfig } from "./types.js";

const SUBAGENTS_MANAGER_KEY = Symbol.for("pi-subagents:manager");

/** Explorer agent definition template (YAML frontmatter + system prompt). */
function explorerAgentMd(config: ExplorerAgentConfig): string {
  return `---
description: Code Explorer — deep-dive into file sections and code structure
display_name: Explorer
tools: read, grep, find, bash, ls
model: ${config.model}
thinking: ${config.thinking}
max_turns: ${config.maxTurns}
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

/**
 * Ensure the explorer.md agent definition file exists in the global agents
 * directory so pi-subagents discovers it automatically.
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
 * Rewrites the whole file so pi-subagents picks up the change on next reload.
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
 * Check if pi-subagents is loaded by probing its Symbol-based global manager.
 */
export function isSubagentsAvailable(): boolean {
  return typeof (globalThis as any)[SUBAGENTS_MANAGER_KEY] !== "undefined";
}


