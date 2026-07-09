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
import {
  updateExplorerAgent,
  isTintinwebSubagentsAvailable,
  isNicobailonSubagentsAvailable,
  detectSubagentLibrary,
  formatSubagentLibrary,
} from "./explorer-agent.js";
import type { CodebaseReaderConfig } from "./types.js";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// ---- Fuzzy search utilities ----

/**
 * Score how well `query` matches `target` using fuzzy matching.
 *
 * All characters of `query` must appear **in order** somewhere in `target`
 * (case-insensitive). Returns a numeric score where **lower is better**,
 * or `null` when there is no match.
 *
 * Scoring tiers (best → worst):
 *   0    Exact match
 *   1    Query is a prefix
 *   2+   Query is a contiguous substring (score = position of substring + 2)
 *   10+  Non-contiguous fuzzy match with gap penalties
 */
function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0; // empty matches everything

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact match → best possible score
  if (t === q) return 0;

  // Prefix match
  if (t.startsWith(q)) return 1;

  // Contiguous substring match
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) return subIdx + 2;

  // Non-contiguous fuzzy match: every character of q must appear in order
  let qi = 0;
  let score = 0;
  let lastMatchPos = -2; // so the first match's consecutive bonus doesn't trigger

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Consecutive matches lower the score (bonus)
      if (ti === lastMatchPos + 1) {
        score -= 1;
      } else {
        // Penalty for gap since last match
        score += ti - lastMatchPos;
      }
      qi++;
      lastMatchPos = ti;
    }
  }

  // Not all query characters were found in order
  if (qi < q.length) return null;

  // Small penalty for trailing characters after last match
  score += t.length - lastMatchPos;

  // Baseline so fuzzy scores are always > substring scores
  return score + 10;
}

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

      // Build SelectItems from model IDs (full unfiltered list)
      const allItems: SelectItem[] = uniqueModels.map((id) => ({
        value: id,
        label: id,
        description: "",
      }));

      /**
       * Apply fuzzy filter to the SelectList and re-render.
       * Replaces SelectList's prefix-only setFilter with proper fuzzy scoring.
       */
      function applyFuzzyFilter(
        sl: SelectList,
        query: string,
        items: SelectItem[],
        requestRender: () => void,
      ): void {
        if (!query) {
          // Empty query: restore full list
          (sl as any).items = items;
          (sl as any).filteredItems = items;
          (sl as any).selectedIndex = 0;
          requestRender();
          return;
        }

        // Score each item, filter out non-matches, sort best-first
        const scored = items
          .map((item) => ({ item, score: fuzzyScore(query, item.value) }))
          .filter((x): x is { item: SelectItem; score: number } => x.score !== null)
          .sort((a, b) => a.score - b.score);

        const matched = scored.map((x) => x.item);
        (sl as any).items = matched;
        (sl as any).filteredItems = matched;
        (sl as any).selectedIndex = 0;
        requestRender();
      }

      // Show a fuzzy-searchable model selector
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

        // SelectList with theme (initially shows all items)
        const selectList = new SelectList(
          allItems,
          Math.min(allItems.length, 12),
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
                updateSearchBar();
                applyFuzzyFilter(selectList, searchQuery, allItems, () =>
                  tui.requestRender(),
                );
              }
              return;
            }

            // Ctrl+U: clear search
            if (matchesKey(data, Key.ctrl("u"))) {
              if (searchQuery.length > 0) {
                searchQuery = "";
                updateSearchBar();
                applyFuzzyFilter(selectList, searchQuery, allItems, () =>
                  tui.requestRender(),
                );
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
              updateSearchBar();
              applyFuzzyFilter(selectList, searchQuery, allItems, () =>
                tui.requestRender(),
              );
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

  // ---- /codebase-reader-subagent ----

  pi.registerCommand("codebase-reader-subagent", {
    description:
      "Show detected subagent library status and configure which library is used. " +
      "Usage: /codebase-reader-subagent [@tintinweb/pi-subagents|pi-subagents|auto] [local|global]. " +
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

      // Detect both libraries
      const tintinwebNow = isTintinwebSubagentsAvailable();
      const nicobailonNow = isNicobailonSubagentsAvailable();

      if (!action) {
        // Show status report
        const config = deps.getConfig();
        const configured = config.subagent?.library || "auto";
        const detected = detectSubagentLibrary();
        const lines: string[] = [
          `${ctx.ui.theme.fg("accent", ctx.ui.theme.bold("Subagent Library Status"))}`,
          `${ctx.ui.theme.fg("dim", "Configured:")} ${configured}`,
          `${ctx.ui.theme.fg("dim", "Detected:")}   ${formatSubagentLibrary(detected)}`,
        ];
        if (tintinwebNow) {
          lines.push(
            `${ctx.ui.theme.fg("success", "✓")} @tintinweb/pi-subagents is loaded and active`,
          );
        }
        if (nicobailonNow) {
          lines.push(
            `${ctx.ui.theme.fg("success", "✓")} pi-subagents (nicobailon) is loaded and active`,
          );
        }
        if (!tintinwebNow && !nicobailonNow) {
          lines.push(
            `${ctx.ui.theme.fg("warning", "○")} No subagent library detected`,
          );
          lines.push(
            `${ctx.ui.theme.fg("dim", "Install one:")}\n  pi install npm:@tintinweb/pi-subagents\n  pi install npm:pi-subagents`,
          );
        }
        lines.push(
          `${ctx.ui.theme.fg("dim", `${ctx.ui.theme.fg("accent", "/codebase-reader-subagent <library> [local|global]")} to configure preference`)}`,
        );
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      // Set library preference
      let library: string;
      if (action === "auto") {
        library = "";
      } else if (action === "@tintinweb/pi-subagents") {
        library = "@tintinweb/pi-subagents";
      } else if (action === "pi-subagents") {
        library = "pi-subagents";
      } else {
        ctx.ui.notify(
          `Unknown library "${action}". Use "@tintinweb/pi-subagents", "pi-subagents", or "auto".`,
          "error",
        );
        return;
      }

      // Save
      const config = deps.getConfig();
      config.subagent = { library };
      saveConfig(cwd, config, scope);
      deps.reloadConfig();

      const location = scope === "project" ? "local" : "global";
      const label = library
        ? `set to ${ctx.ui.theme.fg("accent", library)}`
        : "set to auto-detect";
      ctx.ui.notify(
        `${ctx.ui.theme.fg("success", "✓")} Subagent library ${label} (${location})`,
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

  // ---- /sherloc-judge ----

  pi.registerCommand("sherloc-judge", {
    description:
      "Score SHERLOC diagnostic findings using LLM-as-judge. " +
      "Usage: /sherloc-judge <finding-json-path> [problem-statement] [gt-patch-path]. " +
      "Optional — run after the Explorer agent produces findings to assess quality.",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/);
      if (parts.length < 1 || !parts[0]) {
        ctx.ui.notify(
          "Usage: /sherloc-judge <finding-json-path> [problem-statement] [gt-patch-path]\n" +
          "The finding JSON file should contain: finding (object with locationExplanation, rootCause, solutionIdea, dependencies, testingImpact) and locations (array of {filePath, startLine, endLine}).",
          "error",
        );
        return;
      }

      const cwd = ctx.cwd;

      // Read finding JSON
      const findingPath = resolve(cwd, parts[0]);
      let raw: string;
      try {
        raw = readFileSync(findingPath, "utf-8");
      } catch (err) {
        ctx.ui.notify(
          `Failed to read finding file: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        return;
      }

      let findingData: {
        finding: { locationExplanation: string; rootCause: string; solutionIdea: string; dependencies: string; testingImpact: string };
        locations: Array<{ filePath: string; startLine: number; endLine: number }>;
        problemStatement?: string;
      };
      try {
        findingData = JSON.parse(raw);
      } catch {
        ctx.ui.notify(
          "Invalid JSON in finding file.",
          "error",
        );
        return;
      }

      const problemStatement =
        parts.slice(1).join(" ") || findingData.problemStatement || "(not provided)";

      // Read ground truth patch if provided
      let gtPatch: string | undefined;
      if (parts[2]) {
        const gtPath = resolve(cwd, parts[2]);
        try {
          gtPatch = readFileSync(gtPath, "utf-8");
        } catch {
          gtPatch = undefined;
        }
      }

      // Build judge prompt
      const { buildJudgePrompt, parseJudgeResponse, computeComposite, formatJudgeResult, passesQualityFilter } =
        await import("./sherloc/quality-judge.js");

      const prompt = buildJudgePrompt({
        problemStatement,
        gtPatch,
        finding: findingData.finding,
        locations: findingData.locations,
      });

      ctx.ui.notify(
        "Scoring finding with LLM judge...",
        "info",
      );

      // For now, we output the judge prompt and tell the user how to use it
      // The actual LLM scoring call depends on the pi runtime's model availability
      ctx.ui.notify(
        `Judge prompt prepared (${prompt.length} chars).\n\n` +
        `To score, pipe this prompt to an LLM and parse the JSON response.\n\n` +
        `Finding data:\n` +
        `  Root cause: ${findingData.finding.rootCause.slice(0, 100)}...\n` +
        `  Solution idea: ${findingData.finding.solutionIdea.slice(0, 100)}...\n` +
        `  Locations: ${findingData.locations.length} location(s)\n`,
        "info",
      );
    },
  });
}

