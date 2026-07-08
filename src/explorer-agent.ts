/**
 * Explorer subagent — registers the `explorer` agent type with @tintinweb/pi-subagents.
 *
 * This module handles:
 * 1. Writing the `explorer.md` agent definition to the global agents directory
 * 2. Detecting pi-subagents availability via event bus / Symbol.for
 * 3. Providing a spawn helper to launch explorer subagents via cross-extension RPC
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExplorerAgentConfig } from "./types.js";

const SUBAGENTS_MANAGER_KEY = Symbol.for("pi-subagents:manager");

/** Explorer agent definition template (YAML frontmatter + system prompt). */
function explorerAgentMd(config: ExplorerAgentConfig): string {
  return `---
description: Code Explorer — deep-dive into file sections and code structure
display_name: Explorer
tools: read, grep, find, bash
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

/**
 * Spawn an explorer subagent via pi-subagents cross-extension RPC.
 * Returns the agent ID on success, null on failure.
 *
 * Communicates over the pi.events event bus using the subagents:rpc:* protocol.
 */
export async function spawnExplorerSubagent(
  pi: ExtensionAPI,
  prompt: string,
  options?: {
    description?: string;
    model?: string;
    thinking?: string;
    maxTurns?: number;
    runInBackground?: boolean;
  },
): Promise<string | null> {
  if (!isSubagentsAvailable()) {
    console.warn("[codebase-reader] pi-subagents not available, cannot spawn explorer");
    return null;
  }

  // Use RPC over the event bus
  const requestId = `cr-spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10_000);

    let cleanup = () => {
      // no-op until assigned
    };

    cleanup = () => {
      unsub();
      clearTimeout(timeout);
    };

    const unsub = pi.events.on(
      `subagents:rpc:spawn:reply:${requestId}`,
      (reply: unknown) => {
        cleanup();
        const r = reply as { success: boolean; data?: { id: string }; error?: string };
        if (r.success && r.data) {
          resolve(r.data.id);
        } else {
          console.warn(
            `[codebase-reader] Explorer spawn failed: ${r.error ?? "unknown"}`,
          );
          resolve(null);
        }
      },
    );

    pi.events.emit("subagents:rpc:spawn", {
      requestId,
      type: "explorer",
      prompt,
      options: {
        description: options?.description ?? "Explore code section",
        model: options?.model,
        thinking: options?.thinking,
        max_turns: options?.maxTurns,
        run_in_background: options?.runInBackground ?? true,
      },
    });
  });
}
