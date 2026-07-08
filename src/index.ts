/**
 * pi-codebase-reader — Smart AST-based file outlining + Explorer subagent.
 *
 * Overrides the built-in `read` tool to return structural outlines for large
 * files in supported languages (TypeScript, JavaScript, Python, Go, Rust).
 * Registers the `explorer` subagent with @tintinweb/pi-subagents for deep-dive
 * code exploration.
 *
 * Commands:
 *   /codebase-reader [on|off]
 *   /codebase-reader-model
 *   /codebase-reader-settings
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.js";
import { loadConfig, saveConfig } from "./config.js";
import {
  ensureExplorerAgent,
  isSubagentsAvailable,
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

  // Check for pi-subagents
  if (isSubagentsAvailable()) {
    console.warn("[codebase-reader] pi-subagents detected — Explorer agent available");
  } else {
    console.warn(
      "[codebase-reader] pi-subagents not detected. Install with: pi install npm:@tintinweb/pi-subagents",
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
    if (isSubagentsAvailable()) {
      console.warn("[codebase-reader] pi-subagents available — Explorer agent ready");
    }
  });

  // ---- pi-subagents readiness ----
  pi.events.on("subagents:ready", () => {
    console.warn("[codebase-reader] pi-subagents ready — Explorer agent ready");
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
