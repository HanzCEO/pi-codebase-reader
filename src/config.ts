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

/** Resolve the config file path: project first, global fallback. */
function resolveConfigPath(cwd: string): { path: string; isProject: boolean } {
  const projectPath = join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
  if (existsSync(projectPath)) return { path: projectPath, isProject: true };

  const globalPath = join(getAgentDir(), CONFIG_FILENAME);
  if (existsSync(globalPath)) return { path: globalPath, isProject: false };

  // Default to project path (will create when saving)
  return { path: projectPath, isProject: true };
}

/** Load the config, falling back to defaults for missing fields. */
export function loadConfig(cwd: string): CodebaseReaderConfig {
  const { path } = resolveConfigPath(cwd);

  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = parseToml(raw) as Record<string, unknown>;

    const config: CodebaseReaderConfig = {
      general: {
        enabled:
          (parsed.general as Record<string, unknown>)?.enabled as boolean ??
          DEFAULT_CONFIG.general.enabled,
        threshold_tokens:
          (parsed.general as Record<string, unknown>)?.threshold_tokens as number ??
          DEFAULT_CONFIG.general.threshold_tokens,
      },
      explorer: {
        model:
          (parsed.explorer as Record<string, unknown>)?.model as string ??
          DEFAULT_CONFIG.explorer.model,
        thinking:
          (parsed.explorer as Record<string, unknown>)?.thinking as string ??
          DEFAULT_CONFIG.explorer.thinking,
        max_turns:
          (parsed.explorer as Record<string, unknown>)?.max_turns as number ??
          DEFAULT_CONFIG.explorer.max_turns,
      },
      parsing: {
        max_outline_depth:
          (parsed.parsing as Record<string, unknown>)?.max_outline_depth as number ??
          DEFAULT_CONFIG.parsing.max_outline_depth,
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

/** Save the config to file (always writes to project path). */
export function saveConfig(cwd: string, config: CodebaseReaderConfig): void {
  const projectPath = join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);

  const obj = {
    general: {
      enabled: config.general.enabled,
      threshold_tokens: config.general.threshold_tokens,
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

  try {
    mkdirSync(dirname(projectPath), { recursive: true });
    writeFileSync(projectPath, stringifyToml(obj), "utf-8");
  } catch (err) {
    console.warn(
      `[codebase-reader] Failed to save config to ${projectPath}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Get the config TOML as a raw string (for editing). */
export function getConfigRaw(cwd: string): string {
  const { path } = resolveConfigPath(cwd);
  if (existsSync(path)) {
    return readFileSync(path, "utf-8");
  }
  // Return formatted defaults
  return stringifyToml({
    general: { enabled: true, threshold_tokens: 10_000 },
    explorer: {
      model: "anthropic/claude-sonnet-4-20250514",
      thinking: "medium",
      max_turns: 30,
    },
    parsing: { max_outline_depth: 10 },
  });
}

/** Write the config TOML from a raw string (saving after edit). */
export function saveConfigRaw(cwd: string, raw: string): void {
  const projectPath = join(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
  try {
    mkdirSync(dirname(projectPath), { recursive: true });
    writeFileSync(projectPath, raw, "utf-8");
  } catch (err) {
    console.warn(
      `[codebase-reader] Failed to write config to ${projectPath}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
