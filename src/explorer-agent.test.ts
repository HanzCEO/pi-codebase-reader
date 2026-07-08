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
  isSubagentsAvailable,
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

      // YAML frontmatter
      assert.ok(
        content.includes("model: test-model"),
        "frontmatter should contain model",
      );
      assert.ok(
        content.includes("thinking: high"),
        "frontmatter should contain thinking",
      );
      assert.ok(
        content.includes("max_turns: 50"),
        "frontmatter should contain max_turns",
      );
      assert.ok(
        content.includes("display_name: Explorer"),
        "frontmatter should contain display_name",
      );
      assert.ok(
        content.includes("description:"),
        "frontmatter should contain description",
      );

      // System prompt body
      assert.ok(
        content.includes("code exploration specialist"),
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

  // ── isSubagentsAvailable ────────────────────────────────────────────

  describe("isSubagentsAvailable", () => {
    it("returns false when the subagents symbol is not set", () => {
      const subagentsKey = Symbol.for("pi-subagents:manager");
      const previous = (globalThis as any)[subagentsKey];
      delete (globalThis as any)[subagentsKey];

      const result = isSubagentsAvailable();
      assert.equal(result, false, "should be false when symbol is absent");

      // Restore
      (globalThis as any)[subagentsKey] = previous;
    });

    it("returns true when the subagents symbol is set to a truthy value", () => {
      const subagentsKey = Symbol.for("pi-subagents:manager");

      (globalThis as any)[subagentsKey] = { version: "1.0.0" };

      const result = isSubagentsAvailable();
      assert.equal(result, true, "should be true when symbol is present");

      // Clean up
      delete (globalThis as any)[subagentsKey];
    });

    it("returns false when the symbol is set to undefined", () => {
      const subagentsKey = Symbol.for("pi-subagents:manager");

      (globalThis as any)[subagentsKey] = undefined;

      const result = isSubagentsAvailable();
      assert.equal(result, false, "undefined is not available");

      delete (globalThis as any)[subagentsKey];
    });
  });
});
