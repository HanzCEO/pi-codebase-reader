/**
 * Tests for src/config.ts
 *
 * Tests loadConfig, saveConfig, getConfigRaw, saveConfigRaw with
 * temporary directories to simulate project and global config files.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, saveConfig, getConfigRaw, saveConfigRaw } from "./config.js";
import type { CodebaseReaderConfig } from "./types.js";

// ========================================================================
// Fixture helpers
// ========================================================================

/** Create a minimal project .pi dir with a codebase-reader.toml. */
function writeProjectConfig(dir: string, toml: string): void {
  const piDir = join(dir, ".pi");
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, "codebase-reader.toml"), toml, "utf-8");
}

// ========================================================================
// Config tests
// ========================================================================

describe("config", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "codebase-reader-config-test-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── loadConfig ──────────────────────────────────────────────────────

  describe("loadConfig", () => {
    it("returns full default config when no config file exists", () => {
      const config = loadConfig(tmpDir);
      assert.equal(config.general.enabled, true);
      assert.equal(config.general.threshold_tokens, 10_000);
      assert.equal(config.general.suggest_similar, true);
      assert.equal(config.explorer.model, "anthropic/claude-sonnet-4-20250514");
      assert.equal(config.explorer.thinking, "medium");
      assert.equal(config.explorer.max_turns, 30);
      assert.equal(config.parsing.max_outline_depth, 10);
    });

    it("loads project-level config from .pi/codebase-reader.toml", () => {
      writeProjectConfig(
        tmpDir,
        `[general]
enabled = false
threshold_tokens = 5000
suggest_similar = false

[explorer]
model = "test-model"
thinking = "high"
max_turns = 50

[parsing]
max_outline_depth = 5
`,
      );

      const config = loadConfig(tmpDir);
      assert.equal(config.general.enabled, false);
      assert.equal(config.general.threshold_tokens, 5000);
      assert.equal(config.general.suggest_similar, false);
      assert.equal(config.explorer.model, "test-model");
      assert.equal(config.explorer.thinking, "high");
      assert.equal(config.explorer.max_turns, 50);
      assert.equal(config.parsing.max_outline_depth, 5);
    });

    it("merges partial project config with defaults for missing fields", () => {
      writeProjectConfig(
        tmpDir,
        `[general]
enabled = false
`,
      );

      const config = loadConfig(tmpDir);
      assert.equal(config.general.enabled, false);
      // Fields not in the TOML should fall back to defaults
      assert.equal(config.general.threshold_tokens, 10_000);
      assert.equal(config.general.suggest_similar, true);
      assert.equal(config.explorer.model, "anthropic/claude-sonnet-4-20250514");
      assert.equal(config.explorer.thinking, "medium");
      assert.equal(config.explorer.max_turns, 30);
      assert.equal(config.parsing.max_outline_depth, 10);
    });

    it("returns defaults when TOML is malformed", () => {
      writeProjectConfig(tmpDir, `this is not valid toml {{{`);

      const config = loadConfig(tmpDir);
      // Should not throw; should return defaults
      assert.equal(config.general.enabled, true);
      assert.equal(config.general.threshold_tokens, 10_000);
      assert.equal(config.explorer.model, "anthropic/claude-sonnet-4-20250514");
    });

    it("returns defaults when config file is empty", () => {
      writeProjectConfig(tmpDir, "");

      const config = loadConfig(tmpDir);
      // Parsing an empty TOML returns an empty object, so all fields fall back
      assert.equal(config.general.enabled, true);
    });

    it("returns defaults for completely missing sections", () => {
      writeProjectConfig(
        tmpDir,
        `[irrelevant]
foo = "bar"
`,
      );

      const config = loadConfig(tmpDir);
      assert.equal(config.general.enabled, true);
      assert.equal(config.explorer.model, "anthropic/claude-sonnet-4-20250514");
    });

    it("does not mutate DEFAULT_CONFIG across calls", () => {
      // Create a config, mutate the result, then load again — second load should be clean
      const config1 = loadConfig(tmpDir);
      config1.general.enabled = false;
      config1.explorer.model = "hacked";

      const config2 = loadConfig(tmpDir);
      assert.equal(config2.general.enabled, true, "second load should not be affected by first mutation");
      assert.equal(
        config2.explorer.model,
        "anthropic/claude-sonnet-4-20250514",
        "second load should use original defaults",
      );
    });
  });

  // ── saveConfig ──────────────────────────────────────────────────────

  describe("saveConfig", () => {
    it("writes config to .pi/codebase-reader.toml", () => {
      const config = loadConfig(tmpDir);
      config.general.enabled = false;
      config.general.threshold_tokens = 777;
      config.explorer.model = "custom-model";
      config.explorer.max_turns = 100;
      config.parsing.max_outline_depth = 3;

      saveConfig(tmpDir, config);

      const filePath = join(tmpDir, ".pi", "codebase-reader.toml");
      assert.ok(existsSync(filePath), "config file should be created");

      // Read raw content and verify key fields are present
      const raw = readFileSync(filePath, "utf-8");
      assert.ok(raw.includes("enabled = false"));
      assert.ok(raw.includes("threshold_tokens = 777"));
      assert.ok(raw.includes('model = "custom-model"'));
      assert.ok(raw.includes("max_turns = 100"));
      assert.ok(raw.includes("max_outline_depth = 3"));

      // Load it back through the API to verify round-trip
      const reloaded = loadConfig(tmpDir);
      assert.equal(reloaded.general.enabled, false);
      assert.equal(reloaded.general.threshold_tokens, 777);
      assert.equal(reloaded.explorer.model, "custom-model");
      assert.equal(reloaded.explorer.max_turns, 100);
      assert.equal(reloaded.parsing.max_outline_depth, 3);
    });

    it("overwrites existing config file", () => {
      writeProjectConfig(
        tmpDir,
        `[general]
enabled = false
`,
      );

      const updated = loadConfig(tmpDir);
      updated.general.enabled = true;
      updated.explorer.model = "new-model";
      saveConfig(tmpDir, updated);

      const reloaded = loadConfig(tmpDir);
      assert.equal(reloaded.general.enabled, true);
      assert.equal(reloaded.explorer.model, "new-model");
    });
  });

  // ── getConfigRaw ────────────────────────────────────────────────────

  describe("getConfigRaw", () => {
    it("returns formatted default TOML when no config file exists", () => {
      // Use a clean directory to avoid interference from earlier tests
      const cleanDir = mkdtempSync(join(tmpdir(), "config-raw-clean-"));
      try {
        const raw = getConfigRaw(cleanDir);
        assert.ok(raw.includes('enabled = true'), 'should include enabled = true');
        assert.ok(raw.includes('threshold_tokens = 10000'), 'should include threshold_tokens');
        assert.ok(raw.includes('suggest_similar = true'), 'should include suggest_similar');
        assert.ok(
          raw.includes('model = "anthropic/claude-sonnet-4-20250514"'),
          'should include model',
        );
        assert.ok(raw.includes('max_turns = 30'), 'should include max_turns');
        assert.ok(raw.includes('max_outline_depth = 10'), 'should include max_outline_depth');
      } finally {
        rmSync(cleanDir, { recursive: true, force: true });
      }
    });

    it("returns existing file content when a config file exists", () => {
      writeProjectConfig(
        tmpDir,
        `# user-edited config
[general]
enabled = false
threshold_tokens = 500
`,
      );

      const raw = getConfigRaw(tmpDir);
      assert.ok(raw.includes("# user-edited config"));
      assert.ok(raw.includes("enabled = false"));
      assert.notEqual(raw.indexOf("threshold_tokens = 500"), -1);
    });
  });

  // ── saveConfigRaw ───────────────────────────────────────────────────

  describe("saveConfigRaw", () => {
    it("writes raw TOML to the config file", () => {
      const raw = `[general]\nenabled = false\nthreshold_tokens = 999\n`;
      saveConfigRaw(tmpDir, raw);

      const filePath = join(tmpDir, ".pi", "codebase-reader.toml");
      assert.ok(existsSync(filePath));
      const content = readFileSync(filePath, "utf-8");
      assert.equal(content, raw);

      // Verify it parses correctly after reload
      const config = loadConfig(tmpDir);
      assert.equal(config.general.enabled, false);
      assert.equal(config.general.threshold_tokens, 999);
    });

    it("creates .pi directory if it does not exist", () => {
      const cleanDir = mkdtempSync(join(tmpdir(), "config-raw-clean-"));
      try {
        const raw = `[parsing]\nmax_outline_depth = 7\n`;
        saveConfigRaw(cleanDir, raw);

        assert.ok(existsSync(join(cleanDir, ".pi", "codebase-reader.toml")));
      } finally {
        rmSync(cleanDir, { recursive: true, force: true });
      }
    });
  });
});
