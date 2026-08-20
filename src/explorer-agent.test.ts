/**
 * Tests for src/explorer-agent.ts
 *
 * Uses the real @earendil-works/pi-coding-agent (installed as peer dependency)
 * and cleans up created files after the test.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  ensureExplorerAgent,
  updateExplorerAgent,
  removeExplorerAgent,
  reinstallExplorerAgent,
  isTintinwebSubagentsAvailable,
  isNicobailonSubagentsAvailable,
  detectSubagentLibrary,
  formatSubagentLibrary,
} from "./explorer-agent.js";

describe("explorer-agent", () => {
  after(() => {
    // Clean up the explorer.md file created during tests
    const agentsDir = join(getAgentDir(), "agents");
    const mdPath = join(agentsDir, "explorer.md");
    if (existsSync(mdPath)) {
      rmSync(mdPath, { force: true });
    }
  });

  // ── ensureExplorerAgent ─────────────────────────────────────────────

  describe("ensureExplorerAgent", () => {
    it("creates explorer.md file with correct YAML frontmatter", () => {
      const resultPath = ensureExplorerAgent({
        model: "test-model",
        thinking: "high",
        maxTurns: 50,
      });

      assert.ok(resultPath, "should return a non-null path");
      assert.ok(existsSync(resultPath!), "the explorer.md file should exist");

      const content = readFileSync(resultPath!, "utf-8");

      // Fields for @tintinweb/pi-subagents
      assert.ok(
        content.includes("display_name: Explorer"),
        "frontmatter should contain display_name",
      );
      assert.ok(
        content.includes("max_turns: 50"),
        "frontmatter should contain max_turns",
      );
      assert.ok(
        content.includes("prompt_mode: replace"),
        "frontmatter should contain prompt_mode",
      );

      // Fields for nicobailon/pi-subagents
      assert.ok(
        content.includes("name: explorer"),
        "frontmatter should contain name",
      );
      assert.ok(
        content.includes("systemPromptMode: replace"),
        "frontmatter should contain systemPromptMode",
      );
      assert.ok(
        content.includes("inheritProjectContext: true"),
        "frontmatter should contain inheritProjectContext",
      );
      assert.ok(
        content.includes("inheritSkills: false"),
        "frontmatter should contain inheritSkills",
      );

      // Common fields
      assert.ok(
        content.includes("model: test-model"),
        "frontmatter should contain model",
      );
      assert.ok(
        content.includes("thinking: high"),
        "frontmatter should contain thinking",
      );
      assert.ok(
        content.includes("description:"),
        "frontmatter should contain description",
      );

      // System prompt body
      assert.ok(
        content.includes("Code exploration & bug-localization specialist"),
        "system prompt should describe the role",
      );
      assert.ok(
        content.includes("Read line ranges"),
        "system prompt should list responsibilities",
      );
    });

    it("embeds the model, thinking, and maxTurns in YAML frontmatter exactly", () => {
      const customConfig = {
        model: "anthropic/claude-opus-4-20250514",
        thinking: "high",
        maxTurns: 100,
      };

      const resultPath = ensureExplorerAgent(customConfig);
      assert.ok(resultPath);

      const content = readFileSync(resultPath!, "utf-8");
      assert.ok(content.includes(`model: ${customConfig.model}`));
      assert.ok(content.includes(`thinking: ${customConfig.thinking}`));
      assert.ok(content.includes(`max_turns: ${customConfig.maxTurns}`));
    });
  });

  // ── updateExplorerAgent ─────────────────────────────────────────────

  describe("updateExplorerAgent", () => {
    it("updates an existing explorer.md with new config", () => {
      // First create with initial config
      ensureExplorerAgent({
        model: "initial-model",
        thinking: "low",
        maxTurns: 5,
      });

      // Then update with new config
      const updated = updateExplorerAgent({
        model: "updated-model",
        thinking: "high",
        maxTurns: 99,
      });

      assert.equal(updated, true, "update should return true on success");

      const agentsDir = join(getAgentDir(), "agents");
      const mdPath = join(agentsDir, "explorer.md");
      assert.ok(existsSync(mdPath), "explorer.md should still exist");

      const content = readFileSync(mdPath, "utf-8");
      assert.ok(
        content.includes("model: updated-model"),
        "should contain updated model",
      );
      assert.ok(
        content.includes("thinking: high"),
        "should contain updated thinking",
      );
      assert.ok(
        content.includes("max_turns: 99"),
        "should contain updated max_turns",
      );
      assert.ok(
        !content.includes("initial-model"),
        "should NOT contain the old model name",
      );
    });
  });

  // ── isTintinwebSubagentsAvailable ──────────────────────────────────

  describe("isTintinwebSubagentsAvailable", () => {
    it("returns false when the subagents symbol is not set", () => {
      const subagentsKey = Symbol.for("pi-subagents:manager");
      const previous = (globalThis as any)[subagentsKey];
      delete (globalThis as any)[subagentsKey];

      const result = isTintinwebSubagentsAvailable();
      assert.equal(result, false, "should be false when symbol is absent");

      // Restore
      (globalThis as any)[subagentsKey] = previous;
    });

    it("returns true when the subagents symbol is set to a truthy value", () => {
      const subagentsKey = Symbol.for("pi-subagents:manager");

      (globalThis as any)[subagentsKey] = { version: "1.0.0" };

      const result = isTintinwebSubagentsAvailable();
      assert.equal(result, true, "should be true when symbol is present");

      // Clean up
      delete (globalThis as any)[subagentsKey];
    });

    it("returns false when the symbol is set to undefined", () => {
      const subagentsKey = Symbol.for("pi-subagents:manager");

      (globalThis as any)[subagentsKey] = undefined;

      const result = isTintinwebSubagentsAvailable();
      assert.equal(result, false, "undefined is not available");

      delete (globalThis as any)[subagentsKey];
    });
  });

  // ── isNicobailonSubagentsAvailable ─────────────────────────────────

  describe("isNicobailonSubagentsAvailable", () => {
    const registryKey = "__piSubagentRuntimeRegistry";

    it("returns false when the runtime registry is not set", () => {
      const previous = (globalThis as any)[registryKey];
      delete (globalThis as any)[registryKey];

      const result = isNicobailonSubagentsAvailable();
      assert.equal(result, false, "should be false when key is absent");

      // Restore
      (globalThis as any)[registryKey] = previous;
    });

    it("returns false when the runtime registry is set to a non-registry object", () => {
      (globalThis as any)[registryKey] = { version: "1.0.0" };

      const result = isNicobailonSubagentsAvailable();
      assert.equal(result, false, "should be false when key is not a registry");

      delete (globalThis as any)[registryKey];
    });

    it("returns false when the runtime registry is set to a plain function (old format)", () => {
      (globalThis as any)[registryKey] = () => {};

      const result = isNicobailonSubagentsAvailable();
      assert.equal(result, false, "should be false when key is a function");

      delete (globalThis as any)[registryKey];
    });

    it("returns true when the runtime registry has the expected shape", () => {
      (globalThis as any)[registryKey] = {
        bySessionManager: new WeakMap(),
        activeEntries: new Set(),
      };

      const result = isNicobailonSubagentsAvailable();
      assert.equal(result, true, "should be true when registry is present");

      delete (globalThis as any)[registryKey];
    });
  });

  // ── detectSubagentLibrary ──────────────────────────────────────────

  describe("detectSubagentLibrary", () => {
    const symbolKey = Symbol.for("pi-subagents:manager");
    const nicobailonKey = "__piSubagentRuntimeRegistry";
    const nicoRegistry = () => ({
      bySessionManager: new WeakMap(),
      activeEntries: new Set(),
    });

    it("returns '@tintinweb/pi-subagents' when tintinweb symbol is set", () => {
      // Set tintinweb, clear nicobailon
      (globalThis as any)[symbolKey] = { version: "1.0.0" };
      const prevNico = (globalThis as any)[nicobailonKey];
      delete (globalThis as any)[nicobailonKey];

      const result = detectSubagentLibrary();
      assert.equal(result, "@tintinweb/pi-subagents");

      delete (globalThis as any)[symbolKey];
      (globalThis as any)[nicobailonKey] = prevNico;
    });

    it("returns 'pi-subagents' when nicobailon runtime registry is present", () => {
      // Clear tintinweb, set nicobailon
      const prevSym = (globalThis as any)[symbolKey];
      delete (globalThis as any)[symbolKey];
      (globalThis as any)[nicobailonKey] = nicoRegistry();

      const result = detectSubagentLibrary();
      assert.equal(result, "pi-subagents");

      (globalThis as any)[symbolKey] = prevSym;
      delete (globalThis as any)[nicobailonKey];
    });

    it("returns null when neither library is detected", () => {
      const prevSym = (globalThis as any)[symbolKey];
      const prevNico = (globalThis as any)[nicobailonKey];
      delete (globalThis as any)[symbolKey];
      delete (globalThis as any)[nicobailonKey];

      const result = detectSubagentLibrary();
      assert.equal(result, null);

      (globalThis as any)[symbolKey] = prevSym;
      (globalThis as any)[nicobailonKey] = prevNico;
    });

    it("prioritizes tintinweb over nicobailon when both are detected", () => {
      (globalThis as any)[symbolKey] = { version: "1.0.0" };
      (globalThis as any)[nicobailonKey] = nicoRegistry();

      const result = detectSubagentLibrary();
      assert.equal(result, "@tintinweb/pi-subagents",
        "should prefer tintinweb when both are present");

      delete (globalThis as any)[symbolKey];
      delete (globalThis as any)[nicobailonKey];
    });
  });

  // ── formatSubagentLibrary ──────────────────────────────────────────

  describe("formatSubagentLibrary", () => {
    it("formats '@tintinweb/pi-subagents' correctly", () => {
      assert.equal(
        formatSubagentLibrary("@tintinweb/pi-subagents"),
        "@tintinweb/pi-subagents",
      );
    });

    it("formats 'pi-subagents' correctly", () => {
      assert.equal(
        formatSubagentLibrary("pi-subagents"),
        "pi-subagents (nicobailon)",
      );
    });

    it("formats null as 'none'", () => {
      assert.equal(formatSubagentLibrary(null), "none");
    });
  });

  // ── removeExplorerAgent ──────────────────────────────────────────────

  describe("removeExplorerAgent", () => {
    it("removes the explorer.md file", () => {
      // First create the file
      ensureExplorerAgent({
        model: "test-model",
        thinking: "high",
        maxTurns: 50,
      });

      const agentsDir = join(getAgentDir(), "agents");
      const mdPath = join(agentsDir, "explorer.md");
      assert.ok(existsSync(mdPath), "file should exist before removal");

      const result = removeExplorerAgent();
      assert.equal(result, true, "should return true on success");
      assert.ok(!existsSync(mdPath), "file should be removed");
    });

    it("returns true even when file doesn't exist", () => {
      const agentsDir = join(getAgentDir(), "agents");
      const mdPath = join(agentsDir, "explorer.md");
      if (existsSync(mdPath)) {
        rmSync(mdPath, { force: true });
      }

      const result = removeExplorerAgent();
      assert.equal(result, true, "should return true even if file doesn't exist");
    });
  });

  // ── reinstallExplorerAgent ──────────────────────────────────────────

  describe("reinstallExplorerAgent", () => {
    it("removes and recreates the explorer.md file", () => {
      // First create the file with old config
      ensureExplorerAgent({
        model: "old-model",
        thinking: "low",
        maxTurns: 30,
      });

      const agentsDir = join(getAgentDir(), "agents");
      const mdPath = join(agentsDir, "explorer.md");
      assert.ok(existsSync(mdPath), "file should exist before reinstall");

      // Verify old content
      const oldContent = readFileSync(mdPath, "utf-8");
      assert.ok(oldContent.includes("model: old-model"), "should have old model");

      // Reinstall with new config
      const result = reinstallExplorerAgent({
        model: "new-model",
        thinking: "high",
        maxTurns: 100,
      });

      assert.ok(result, "should return a non-null path");
      assert.ok(existsSync(result!), "file should exist after reinstall");

      // Verify new content
      const newContent = readFileSync(result!, "utf-8");
      assert.ok(newContent.includes("model: new-model"), "should have new model");
      assert.ok(!newContent.includes("model: old-model"), "should not have old model");
    });
  });
});
