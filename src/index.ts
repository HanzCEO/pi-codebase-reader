/**
 * pi-codebase-reader — Smart AST-based file outlining + Explorer subagent.
 *
 * Overrides the built-in `read` tool to return structural outlines for large
 * files in supported languages (TypeScript, JavaScript, Python, Go, Rust, Solidity).
 * Registers the `explorer` subagent for use with EITHER
 * `@tintinweb/pi-subagents` OR `nicobailon/pi-subagents`.
 *
 * SHERLOC Integration:
 * - Registers `repo_tree` (filtered repository tree) and `connected_tree`
 *   (import dependency graph) as pi tools.
 * - The Explorer agent's system prompt includes the SHERLOC bug-localization
 *   protocol with structured diagnostic output format.
 * - Self-recovery mechanisms (loop detection, context management, etc.)
 *   are available for tool-execution wrappers.
 * - Optional `/sherloc-judge` command scores findings via LLM-as-judge.
 *
 * Users install their preferred subagent library:
 *   pi install npm:@tintinweb/pi-subagents
 *   — or —
 *   pi install npm:pi-subagents
 *
 * Commands:
 *   /codebase-reader [on|off] [local|global]
 *   /codebase-reader-model [local|global]
 *   /codebase-reader-settings [global|local]
 *   /codebase-reader-subagent [local|global]
 *   /sherloc-judge
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.js";
import { loadConfig } from "./config.js";
import {
  ensureExplorerAgent,
  isTintinwebSubagentsAvailable,
  isNicobailonSubagentsAvailable,
} from "./explorer-agent.js";
import { registerReadTool } from "./read-tool.js";
import { registerRepotreeTool, registerConnectedTreeTool } from "./sherloc/tools.js";
import type { CodebaseReaderConfig } from "./types.js";

export default function (pi: ExtensionAPI) {
  // ---- Mutable state ----
  let config = loadConfig(process.cwd());
  let enabled = config.general.enabled;

  // ---- Config helpers ----
  function getConfig(): CodebaseReaderConfig {
    return config;
  }

  function reloadConfig(): CodebaseReaderConfig {
    config = loadConfig(process.cwd());
    enabled = config.general.enabled;
    return config;
  }

  function isEnabled(): boolean {
    return enabled;
  }

  function setEnabled(v: boolean): void {
    enabled = v;
  }

  // ---- Explorer agent file (write early so agent def exists) ----
  // In subagent child processes (PI_SUBAGENT_CHILD=1), skip the registration
  // log — the agent file is written by the parent, and the warning is noise.
  const isSubagentChild = process.env.PI_SUBAGENT_CHILD === "1";
  const explorerPath = ensureExplorerAgent({
    model: config.explorer.model,
    thinking: config.explorer.thinking,
    maxTurns: config.explorer.max_turns,
  });

  if (explorerPath && !isSubagentChild) {
    console.warn(
      `[codebase-reader] Explorer agent registered at ${explorerPath}`,
    );
  }

  // ---- Register SHERLOC tools ----
  registerRepotreeTool(pi);
  registerConnectedTreeTool(pi);

  // ---- Session lifecycle ----
  pi.on("session_start", async (_event, ctx) => {
    // Reload config per session
    config = loadConfig(ctx.cwd);
    enabled = config.general.enabled;

    // Ensure explorer agent file exists (path may have changed)
    ensureExplorerAgent({
      model: config.explorer.model,
      thinking: config.explorer.thinking,
      maxTurns: config.explorer.max_turns,
    });
  });

  // Detect subagents on session start (extensions are all loaded by then).
  // Skip detection in subagent child processes — the subagent library is never
  // loaded there (pi-subagents skips init when PI_SUBAGENT_CHILD=1), so the
  // "No subagent library detected" warning would be confusing noise.
  pi.on("session_start", async () => {
    const isSubagentChild = process.env.PI_SUBAGENT_CHILD === "1";
    const tintinweb = isTintinwebSubagentsAvailable();
    const nicobailon = isNicobailonSubagentsAvailable();

    if (tintinweb) {
      console.warn(
        "[codebase-reader] @tintinweb/pi-subagents available — Explorer agent ready (SHERLOC tools: repo_tree, connected_tree)",
      );
    } else if (nicobailon) {
      console.warn(
        "[codebase-reader] pi-subagents (nicobailon) available — Explorer agent ready (SHERLOC tools: repo_tree, connected_tree)",
      );
    } else if (!isSubagentChild) {
      const hint = config.subagent?.library
        ? ` (configured: ${config.subagent.library})`
        : "";
      console.warn(
        `[codebase-reader] No subagent library detected${hint}. ` +
        `Install one:\n` +
        `  pi install npm:@tintinweb/pi-subagents\n` +
        `  — or —\n` +
        `  pi install npm:pi-subagents`,
      );
    }
  });

  // ---- @tintinweb/pi-subagents readiness event ----
  pi.events.on("subagents:ready", () => {
    console.warn(
      "[codebase-reader] @tintinweb/pi-subagents ready — Explorer agent ready",
    );
  });

  // ---- Register the smart read tool ----
  registerReadTool(pi, { isEnabled, getConfig });

  // ---- Register commands ----
  registerCommands(pi, {
    getConfig,
    setEnabled,
    isEnabled,
    reloadConfig,
  });
}
