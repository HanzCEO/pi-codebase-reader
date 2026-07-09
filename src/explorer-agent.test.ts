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
        content.includes("code exploration and bug-localization specialist"),
        "system prompt should describe the role",
      );
      assert.ok(
        content.includes("Read specific line ranges"),
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
    it("returns false when the runtime key is not set", () => {
      const key = "__piSubagentRuntimeCleanup";
      const previous = (globalThis as any)[key];
      delete (globalThis as any)[key];

      const result = isNicobailonSubagentsAvailable();
      assert.equal(result, false, "should be false when key is absent");

      // Restore
      (globalThis as any)[key] = previous;
    });

    it("returns false when the runtime key is set to a non-function", () => {
      const key = "__piSubagentRuntimeCleanup";

      (globalThis as any)[key] = { version: "1.0.0" };

      const result = isNicobailonSubagentsAvailable();
      assert.equal(result, false, "should be false when key is not a function");

      delete (globalThis as any)[key];
    });

    it("returns true when the runtime key is set to a function", () => {
      const key = "__piSubagentRuntimeCleanup";

      (globalThis as any)[key] = () => {};

      const result = isNicobailonSubagentsAvailable();
      assert.equal(result, true, "should be true when key is a function");

      delete (globalThis as any)[key];
    });
  });

  // ── detectSubagentLibrary ──────────────────────────────────────────

  describe("detectSubagentLibrary", () => {
    it("returns '@tintinweb/pi-subagents' when tintinweb symbol is set", () => {
      const symbolKey = Symbol.for("pi-subagents:manager");
      const nicobailonKey = "__piSubagentRuntimeCleanup";

      // Set tintinweb, clear nicobailon
      (globalThis as any)[symbolKey] = { version: "1.0.0" };
      const prevNico = (globalThis as any)[nicobailonKey];
      delete (globalThis as any)[nicobailonKey];

      const result = detectSubagentLibrary();
      assert.equal(result, "@tintinweb/pi-subagents");

      delete (globalThis as any)[symbolKey];
      (globalThis as any)[nicobailonKey] = prevNico;
    });

    it("returns 'pi-subagents' when nicobailon runtime key is a function", () => {
      const symbolKey = Symbol.for("pi-subagents:manager");
      const nicobailonKey = "__piSubagentRuntimeCleanup";

      // Clear tintinweb, set nicobailon
      const prevSym = (globalThis as any)[symbolKey];
      delete (globalThis as any)[symbolKey];
      (globalThis as any)[nicobailonKey] = () => {};

      const result = detectSubagentLibrary();
      assert.equal(result, "pi-subagents");

      (globalThis as any)[symbolKey] = prevSym;
      delete (globalThis as any)[nicobailonKey];
    });

    it("returns null when neither library is detected", () => {
      const symbolKey = Symbol.for("pi-subagents:manager");
      const nicobailonKey = "__piSubagentRuntimeCleanup";

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
      const symbolKey = Symbol.for("pi-subagents:manager");
      const nicobailonKey = "__piSubagentRuntimeCleanup";

      (globalThis as any)[symbolKey] = { version: "1.0.0" };
      (globalThis as any)[nicobailonKey] = () => {};

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
});
