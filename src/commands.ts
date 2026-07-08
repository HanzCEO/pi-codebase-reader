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
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
  matchesKey,
  Key,
} from "@earendil-works/pi-tui";
import {
  type ConfigScope,
  ensureGlobalConfig,
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
    description:
      "Enable or disable smart codebase reading. " +
      "Usage: /codebase-reader [on|off] [local|global]. " +
      "Defaults to global (~/.pi/agent/codebase-reader.toml).",
    handler: async (args, ctx) => {
      ensureGlobalConfig();
      const cwd = ctx.cwd;
      const argStr = args?.trim().toLowerCase() || "";
      const parts = argStr.split(/\s+/);
      const action = parts[0];
      const scopeArg = parts[1];
      let scope: ConfigScope = "global";

      if (scopeArg === "local") {
        scope = "project";
      } else if (scopeArg && scopeArg !== "global") {
        ctx.ui.notify(
          `Unknown scope "${scopeArg}". Use "local" or "global", or omit for global default.`,
          "error",
        );
        return;
      }

      if (action === "on") {
        const config = deps.getConfig();
        config.general.enabled = true;
        saveConfig(cwd, config, scope);
        deps.setEnabled(true);
        deps.reloadConfig();
        const location = scope === "project" ? "local" : "global";
        ctx.ui.notify(
          `${ctx.ui.theme.fg("success", "✓")} Codebase Reader enabled (${location}) — large files now return AST outlines`,
          "info",
        );
      } else if (action === "off") {
        const config = deps.getConfig();
        config.general.enabled = false;
        saveConfig(cwd, config, scope);
        deps.setEnabled(false);
        deps.reloadConfig();
        const location = scope === "project" ? "local" : "global";
        ctx.ui.notify(
          `${ctx.ui.theme.fg("warning", "○")} Codebase Reader disabled (${location}) — files return full content`,
          "info",
        );
      } else {
        const status = deps.isEnabled() ? "on" : "off";
        const hint = scopeArg
          ? ` (${scopeArg})`
          : "";
        ctx.ui.notify(
          `Codebase Reader is currently ${ctx.ui.theme.fg(deps.isEnabled() ? "success" : "warning", status)}${hint}` +
          `\nUse ${ctx.ui.theme.fg("accent", "/codebase-reader on")} to enable or ${ctx.ui.theme.fg("accent", "/codebase-reader off")} to disable` +
          `\nAppend ${ctx.ui.theme.fg("accent", "local")} or ${ctx.ui.theme.fg("accent", "global")} to target a specific scope (default: global)`,
          "info",
        );
      }
    },
  });

  // ---- /codebase-reader-model ----

  pi.registerCommand("codebase-reader-model", {
    description:
      "Select the model used by the Explorer subagent. " +
      "Usage: /codebase-reader-model [local|global]. " +
      "Defaults to global (~/.pi/agent/codebase-reader.toml).",
    handler: async (args, ctx) => {
      ensureGlobalConfig();
      const cwd = ctx.cwd;

      // Parse scope argument
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

      // Deduplicate and sort model IDs
      const modelIds = allModels.map((m) => `${m.provider}/${m.id}`);
      const uniqueModels = [...new Set(modelIds)].sort();

      // Build SelectItems from model IDs
      const items: SelectItem[] = uniqueModels.map((id) => ({
        value: id,
        label: id,
        description: "",
      }));

      // Show a searchable model selector
      const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
        const container = new Container();

        // Top border
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

        // Title
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Select Explorer Model")), 1, 0),
        );

        // Search bar
        let searchQuery = "";
        const searchBar = new Text("", 1, 0);
        const updateSearchBar = () => {
          const label = searchQuery
            ? `Search: ${searchQuery}`
            : "Type to filter models…";
          searchBar.setText(theme.fg(searchQuery ? "text" : "dim", label));
        };
        updateSearchBar();
        container.addChild(searchBar);

        // SelectList with theme
        const selectList = new SelectList(
          items,
          Math.min(items.length, 12),
          {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        );
        selectList.onSelect = (item) => done(item.value);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);

        // Help text
        container.addChild(
          new Text(
            theme.fg(
              "dim",
              "Type to filter • ↑↓ navigate • enter select • esc cancel",
            ),
            1,
            0,
          ),
        );

        // Bottom border
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

        return {
          render: (w) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data) => {
            // Backspace: remove last char from search
            if (matchesKey(data, Key.backspace) || matchesKey(data, Key.ctrl("h"))) {
              if (searchQuery.length > 0) {
                searchQuery = searchQuery.slice(0, -1);
                selectList.setFilter(searchQuery);
                updateSearchBar();
                tui.requestRender();
              }
              return;
            }

            // Ctrl+U: clear search
            if (matchesKey(data, Key.ctrl("u"))) {
              if (searchQuery.length > 0) {
                searchQuery = "";
                selectList.setFilter(searchQuery);
                updateSearchBar();
                tui.requestRender();
              }
              return;
            }

            // If it's a printable character, add to search query
            if (
              data.length === 1 &&
              data.charCodeAt(0) >= 32 &&
              data.charCodeAt(0) <= 126
            ) {
              searchQuery += data;
              selectList.setFilter(searchQuery);
              updateSearchBar();
              tui.requestRender();
              return;
            }

            // Delegate navigation/confirm/cancel to SelectList
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      });

      if (!selected) {
        ctx.ui.notify("Model selection cancelled", "info");
        return;
      }

      // Save to config
      const config = loadConfig(cwd);
      config.explorer.model = selected;
      saveConfig(cwd, config, scope);
      deps.reloadConfig();

      // Update the explorer.md agent file
      updateExplorerAgent({
        model: selected,
        thinking: config.explorer.thinking,
        maxTurns: config.explorer.max_turns,
      });

      const location = scope === "project" ? "local" : "global";
      ctx.ui.notify(
        `${ctx.ui.theme.fg("success", "✓")} Explorer model set to ${ctx.ui.theme.fg("accent", selected)} (${location})`,
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
      ensureGlobalConfig();
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
