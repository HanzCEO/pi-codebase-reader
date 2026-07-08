/**
 * pi-codebase-reader — Smart AST-based file outlining + Explorer subagent.
 *
 * Overrides the built-in `read` tool to return structural outlines for large
 * files in supported languages (TypeScript, JavaScript, Python, Go, Rust).
 * Registers the `explorer` subagent for use with EITHER
 * `@tintinweb/pi-subagents` OR `nicobailon/pi-subagents`.
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
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.js";
import { loadConfig, saveConfig } from "./config.js";
import {
  ensureExplorerAgent,
  isTintinwebSubagentsAvailable,
  isNicobailonSubagentsAvailable,
  detectSubagentLibrary,
  formatSubagentLibrary,
  type SubagentLibrary,
} from "./explorer-agent.js";
import { registerReadTool } from "./read-tool.js";
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

  // ---- Explorer agent initialization ----
  const explorerPath = ensureExplorerAgent({
    model: config.explorer.model,
    thinking: config.explorer.thinking,
    maxTurns: config.explorer.max_turns,
  });

  if (explorerPath) {
    console.warn(
      `[codebase-reader] Explorer agent registered at ${explorerPath}`,
    );
  }

  // ---- Detect subagent libraries ----
  const tintinwebAvailable = isTintinwebSubagentsAvailable();
  const nicobailonAvailable = isNicobailonSubagentsAvailable();
  const detectedLib = config.subagent?.library
    ? (config.subagent.library as SubagentLibrary)
    : detectSubagentLibrary();

  if (tintinwebAvailable) {
    console.warn(
      "[codebase-reader] @tintinweb/pi-subagents detected — Explorer agent available via Agent tool",
    );
  } else if (nicobailonAvailable) {
    console.warn(
      "[codebase-reader] pi-subagents (nicobailon) detected — Explorer agent available via subagent tool",
    );
  } else {
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

  // Re-check subagents on session start (they may have been loaded after us)
  pi.on("session_start", async () => {
    const tintinweb = isTintinwebSubagentsAvailable();
    const nicobailon = isNicobailonSubagentsAvailable();

    if (tintinweb) {
      console.warn(
        "[codebase-reader] @tintinweb/pi-subagents available — Explorer agent ready",
      );
    } else if (nicobailon) {
      console.warn(
        "[codebase-reader] pi-subagents (nicobailon) available — Explorer agent ready",
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
