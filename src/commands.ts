/**
 * Command handlers for pi-codebase-reader.
 *
 * Commands:
 *   /codebase-reader [on|off]       — Enable or disable smart reading
 *   /codebase-reader-model           — Open model selector for the explorer subagent
 *   /codebase-reader-settings        — Edit the TOML config file
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  type ConfigScope,
  getConfigRaw,
  loadConfig,
  saveConfig,
  saveConfigRaw,
} from "./config.js";
import { updateExplorerAgent } from "./explorer-agent.js";
import type { CodebaseReaderConfig } from "./types.js";

export interface CommandDeps {
  getConfig: () => CodebaseReaderConfig;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  reloadConfig: () => CodebaseReaderConfig;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
  // ---- /codebase-reader [on|off] ----

  pi.registerCommand("codebase-reader", {
    description: "Enable or disable smart codebase reading. Usage: /codebase-reader [on|off]",
    handler: async (args, ctx) => {
      const arg = args?.trim().toLowerCase();
      const cwd = ctx.cwd;

      if (arg === "on") {
        const config = deps.getConfig();
        config.general.enabled = true;
        saveConfig(cwd, config);
        deps.setEnabled(true);
        deps.reloadConfig();
        ctx.ui.notify(
          `${ctx.ui.theme.fg("success", "✓")} Codebase Reader enabled — large files now return AST outlines`,
          "info",
        );
      } else if (arg === "off") {
        const config = deps.getConfig();
        config.general.enabled = false;
        saveConfig(cwd, config);
        deps.setEnabled(false);
        deps.reloadConfig();
        ctx.ui.notify(
          `${ctx.ui.theme.fg("warning", "○")} Codebase Reader disabled — files return full content`,
          "info",
        );
      } else {
        const status = deps.isEnabled() ? "on" : "off";
        ctx.ui.notify(
          `Codebase Reader is currently ${ctx.ui.theme.fg(deps.isEnabled() ? "success" : "warning", status)}` +
          `\nUse ${ctx.ui.theme.fg("accent", "/codebase-reader on")} to enable or ${ctx.ui.theme.fg("accent", "/codebase-reader off")} to disable`,
          "info",
        );
      }
    },
  });

  // ---- /codebase-reader-model ----

  pi.registerCommand("codebase-reader-model", {
    description: "Select the model used by the Explorer subagent",
    handler: async (_args, ctx) => {
      const cwd = ctx.cwd;

      // Get available models from the registry
      const registry = ctx.modelRegistry;
      if (!registry) {
        ctx.ui.notify("Model registry not available", "error");
        return;
      }

      // Build a list of models (provider/model format)
      const allModels = registry.getAll();
      if (!allModels || allModels.length === 0) {
        ctx.ui.notify("No models available in the registry", "error");
        return;
      }

      // Present a selection dialog
      const modelIds = allModels.map((m) => `${m.provider}/${m.id}`);
      // Deduplicate
      const uniqueModels = [...new Set(modelIds)];

      const selected = await ctx.ui.select(
        "Select model for Explorer subagent:",
        uniqueModels,
      );

      if (!selected || typeof selected !== "string") {
        ctx.ui.notify("Model selection cancelled", "info");
        return;
      }

      // Save to config
      const config = loadConfig(cwd);
      config.explorer.model = selected;
      saveConfig(cwd, config);
      deps.reloadConfig();

      // Update the explorer.md agent file
      updateExplorerAgent({
        model: selected,
        thinking: config.explorer.thinking,
        maxTurns: config.explorer.max_turns,
      });

      ctx.ui.notify(
        `${ctx.ui.theme.fg("success", "✓")} Explorer model set to ${ctx.ui.theme.fg("accent", selected)}`,
        "info",
      );
    },
  });

  // ---- /codebase-reader-settings ----

  pi.registerCommand("codebase-reader-settings", {
    description:
      "Edit the codebase-reader TOML configuration file. " +
      "Usage: /codebase-reader-settings [global|local]. " +
      "Defaults to global (~/.pi/agent/codebase-reader.toml).",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const arg = args?.trim().toLowerCase();
      let scope: ConfigScope;

      if (arg === "local") {
        scope = "project";
      } else if (arg === "global" || !arg) {
        scope = "global";
      } else {
        ctx.ui.notify(
          `Unknown argument "${arg}". Use "global" or "local", or omit for global default.`,
          "error",
        );
        return;
      }

      const raw = getConfigRaw(cwd, scope);

      // Open the editor
      const edited = await ctx.ui.editor(
        `Edit codebase-reader configuration (${scope === "project" ? "local" : "global"} .toml):`,
        raw,
      );

      if (edited === undefined || edited === null) {
        ctx.ui.notify("Settings edit cancelled", "info");
        return;
      }

      // Save and reload
      try {
        saveConfigRaw(cwd, edited, scope);
        deps.reloadConfig();

        // Update explorer agent with potentially changed model/thinking/max_turns
        const config = loadConfig(cwd);
        updateExplorerAgent({
          model: config.explorer.model,
          thinking: config.explorer.thinking,
          maxTurns: config.explorer.max_turns,
        });

        const location =
          scope === "project"
            ? ".pi/codebase-reader.toml"
            : "~/.pi/agent/codebase-reader.toml";
        ctx.ui.notify(
          `${ctx.ui.theme.fg("success", "✓")} Settings saved to ${location}`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(
          `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
