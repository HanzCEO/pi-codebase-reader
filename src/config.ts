/**
 * TOML-based configuration management for pi-codebase-reader.
 *
 * Loads from project-level `.pi/codebase-reader.toml` first,
 * falls back to global `~/.pi/agent/codebase-reader.toml`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { CodebaseReaderConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

const CONFIG_FILENAME = "codebase-reader.toml";

export type ConfigScope = "project" | "global";

/**
 * Resolve the config file path.
 * When scope is 'global': always use the global agent directory path.
 * When scope is 'project': always use the project-level `.pi/` path.
 * When scope is omitted: project first, global fallback.
 */
function resolveConfigPath(
  cwd: string,
  scope?: ConfigScope,
): { path: string; isProject: boolean } {
  if (scope === "global") {
    return { path: join(getAgentDir(), CONFIG_FILENAME), isProject: false };
  }
  if (scope === "project") {
    return { path: join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME), isProject: true };
  }

  // Default: project first, global fallback
  const projectPath = join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
  if (existsSync(projectPath)) return { path: projectPath, isProject: true };

  const globalPath = join(getAgentDir(), CONFIG_FILENAME);
  if (existsSync(globalPath)) return { path: globalPath, isProject: false };

  return { path: projectPath, isProject: true };
}

/** Load the config, falling back to defaults for missing fields. */
export function loadConfig(cwd: string): CodebaseReaderConfig {
  const { path } = resolveConfigPath(cwd);

  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = parseToml(raw) as Record<string, unknown>;

    const generalSection = parsed.general as Record<string, unknown> | undefined;
    const explorerSection = parsed.explorer as Record<string, unknown> | undefined;
    const parsingSection = parsed.parsing as Record<string, unknown> | undefined;
    const subagentSection = parsed.subagent as Record<string, unknown> | undefined;

    const config: CodebaseReaderConfig = {
      general: {
        enabled:
          (generalSection?.enabled as boolean) ??
          DEFAULT_CONFIG.general.enabled,
        threshold_tokens:
          (generalSection?.threshold_tokens as number) ??
          DEFAULT_CONFIG.general.threshold_tokens,
        suggest_similar:
          (generalSection?.suggest_similar as boolean) ??
          DEFAULT_CONFIG.general.suggest_similar,
      },
      explorer: {
        model:
          (explorerSection?.model as string) ??
          DEFAULT_CONFIG.explorer.model,
        thinking:
          (explorerSection?.thinking as string) ??
          DEFAULT_CONFIG.explorer.thinking,
        max_turns:
          (explorerSection?.max_turns as number) ??
          DEFAULT_CONFIG.explorer.max_turns,
      },
      parsing: {
        max_outline_depth:
          (parsingSection?.max_outline_depth as number) ??
          DEFAULT_CONFIG.parsing.max_outline_depth,
      },
      subagent: {
        library:
          (subagentSection?.library as string) ??
          DEFAULT_CONFIG.subagent?.library ?? "",
      },
    };

    return config;
  } catch (err) {
    console.warn(
      `[codebase-reader] Failed to parse config at ${path}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ...DEFAULT_CONFIG };
  }
}

/** Save the config to file. Defaults to global scope (~/.pi/agent/). */
export function saveConfig(cwd: string, config: CodebaseReaderConfig, scope: ConfigScope = "global"): void {
  const { path, isProject } = resolveConfigPath(cwd, scope);

  const obj: Record<string, unknown> = {
    general: {
      enabled: config.general.enabled,
      threshold_tokens: config.general.threshold_tokens,
      suggest_similar: config.general.suggest_similar,
    },
    explorer: {
      model: config.explorer.model,
      thinking: config.explorer.thinking,
      max_turns: config.explorer.max_turns,
    },
    parsing: {
      max_outline_depth: config.parsing.max_outline_depth,
    },
  };

  // Only write subagent section if explicitly set
  if (config.subagent?.library) {
    obj.subagent = {
      library: config.subagent.library,
    };
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringifyToml(obj), "utf-8");
  } catch (err) {
    const label = isProject ? "project" : "global";
    console.warn(
      `[codebase-reader] Failed to save config to ${label} path ${path}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Deep-merge a single section's defaults into a parsed TOML object.
 * Only adds keys that are missing — never overwrites existing user values.
 * Returns true if any keys were added.
 */
function mergeSectionDefaults(
  parsed: Record<string, unknown>,
  section: string,
  defaults: Record<string, unknown>,
): boolean {
  const existing = parsed[section];
  if (!existing || typeof existing !== "object") {
    // Entire section is missing — add all defaults
    parsed[section] = { ...defaults };
    return true;
  }

  const sectionObj = existing as Record<string, unknown>;
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in sectionObj)) {
      sectionObj[key] = value;
      changed = true;
    }
  }
  return changed;
}

/** Configuration sections and their defaults for merge lookups. */
const CONFIG_SECTIONS: Record<string, Record<string, unknown>> = {
  general: DEFAULT_CONFIG.general as unknown as Record<string, unknown>,
  explorer: DEFAULT_CONFIG.explorer as unknown as Record<string, unknown>,
  parsing: DEFAULT_CONFIG.parsing as unknown as Record<string, unknown>,
  subagent: DEFAULT_CONFIG.subagent as unknown as Record<string, unknown>,
};

/**
 * Ensure the global TOML config file at ~/.pi/agent/codebase-reader.toml
 * contains all default keys. Creates the file from scratch if missing;
 * otherwise reads it and merges in any missing default keys, preserving
 * any user-defined values already on disk.
 */
export function ensureGlobalConfig(): void {
  const globalPath = join(getAgentDir(), CONFIG_FILENAME);

  // No file at all — create from scratch with full defaults
  if (!existsSync(globalPath)) {
    try {
      mkdirSync(getAgentDir(), { recursive: true });
      writeFileSync(globalPath, stringifyToml(DEFAULT_CONFIG), "utf-8");
    } catch (err) {
      console.warn(
        `[codebase-reader] Failed to create global config at ${globalPath}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return;
  }

  // File exists — merge any missing default keys
  try {
    const raw = readFileSync(globalPath, "utf-8");
    const parsed = parseToml(raw) as Record<string, unknown>;

    let needsWrite = false;
    for (const [section, defaults] of Object.entries(CONFIG_SECTIONS)) {
      if (mergeSectionDefaults(parsed, section, defaults)) {
        needsWrite = true;
      }
    }

    if (needsWrite) {
      writeFileSync(globalPath, stringifyToml(parsed), "utf-8");
    }
  } catch (err) {
    // Malformed TOML — don't touch the user's file, just warn.
    // loadConfig() already handles this gracefully by returning in-memory defaults.
    console.warn(
      `[codebase-reader] Global config at ${globalPath} has invalid TOML, leaving untouched:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Get the config TOML as a raw string (for editing). */
export function getConfigRaw(cwd: string, scope?: ConfigScope): string {
  const { path } = resolveConfigPath(cwd, scope);
  if (existsSync(path)) {
    return readFileSync(path, "utf-8");
  }
  // Return formatted defaults
  return stringifyToml({
    general: { enabled: true, threshold_tokens: 10_000, suggest_similar: true },
    explorer: {
      model: "anthropic/claude-sonnet-4-20250514",
      thinking: "medium",
      max_turns: 30,
    },
    parsing: { max_outline_depth: 10 },
  });
}

/** Write the config TOML from a raw string (saving after edit). */
export function saveConfigRaw(cwd: string, raw: string, scope?: ConfigScope): void {
  const { path } = resolveConfigPath(cwd, scope);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, raw, "utf-8");
  } catch (err) {
    console.warn(
      `[codebase-reader] Failed to write config to ${path}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
