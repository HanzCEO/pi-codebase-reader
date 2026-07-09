/**
 * Tests for src/sherloc/self-recovery.ts
 *
 * Pure function tests — no mocking needed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectLoop,
  recordToolCall,
  resetToolCallHistory,
  recoverToolCall,
  truncateContext,
  manageContext,
  checkResponseLength,
  finalTurnPrompt,
  sherlocSystemPromptSupplement,
} from "./self-recovery.js";
import type { RecoveryState } from "./types.js";

function makeState(overrides?: Partial<RecoveryState>): RecoveryState {
  return {
    toolCallHistory: [],
    loopThreshold: 3,
    maxTurns: 20,
    turnCount: 0,
    ...overrides,
  };
}

// ========================================================================
// detectLoop
// ========================================================================

describe("detectLoop", () => {
  it("returns null when history is empty", () => {
    const state = makeState();
    assert.equal(detectLoop(state, "view_file", { path: "foo.py" }), null);
  });

  it("returns null when below threshold", () => {
    const state = makeState({
      toolCallHistory: [
        { name: "view_file", params: { path: "foo.py" } },
        { name: "view_file", params: { path: "foo.py" } },
      ],
    });
    assert.equal(detectLoop(state, "view_file", { path: "foo.py" }), null);
  });

  it("warns when threshold is reached", () => {
    const state = makeState({
      loopThreshold: 3,
      toolCallHistory: [
        { name: "view_file", params: { path: "foo.py" } },
        { name: "view_file", params: { path: "foo.py" } },
        { name: "view_file", params: { path: "foo.py" } },
      ],
    });
    const msg = detectLoop(state, "view_file", { path: "foo.py" });
    assert.ok(msg, "should return a warning message");
    assert.ok(msg!.includes("Loop detected"), "message should mention loop");
    assert.ok(msg!.includes("view_file"), "message should name the tool");
  });

  it("does not warn when params differ", () => {
    const state = makeState({
      toolCallHistory: [
        { name: "view_file", params: { path: "foo.py" } },
        { name: "view_file", params: { path: "bar.py" } },
        { name: "view_file", params: { path: "foo.py" } },
      ],
    });
    assert.equal(detectLoop(state, "view_file", { path: "foo.py" }), null);
  });

  it("only counts consecutive identical calls", () => {
    const state = makeState({
      toolCallHistory: [
        { name: "view_file", params: { path: "a.py" } },
        { name: "view_file", params: { path: "a.py" } },
        { name: "codebase_search", params: { query: "foo" } },
        { name: "view_file", params: { path: "a.py" } },
      ],
    });
    // Only 1 consecutive identical (the last one), so no loop
    assert.equal(detectLoop(state, "view_file", { path: "a.py" }), null);
  });
});

// ========================================================================
// recordToolCall / resetToolCallHistory
// ========================================================================

describe("recordToolCall and resetToolCallHistory", () => {
  it("records a tool call in history", () => {
    const state = makeState();
    recordToolCall(state, "view_file", { path: "x.py" });
    assert.equal(state.toolCallHistory.length, 1);
    assert.equal(state.toolCallHistory[0].name, "view_file");
  });

  it("bounds history to 20 entries", () => {
    const state = makeState();
    for (let i = 0; i < 25; i++) {
      recordToolCall(state, "view_file", { path: `f${i}.py` });
    }
    assert.equal(state.toolCallHistory.length, 20);
    assert.equal(state.toolCallHistory[0].params.path, "f5.py");
  });

  it("resets history", () => {
    const state = makeState({
      toolCallHistory: [
        { name: "view_file", params: { path: "a.py" } },
        { name: "view_file", params: { path: "b.py" } },
      ],
    });
    resetToolCallHistory(state);
    assert.deepEqual(state.toolCallHistory, []);
  });
});

// ========================================================================
// recoverToolCall
// ========================================================================

describe("recoverToolCall", () => {
  it("recovers view_file(path) pattern", () => {
    const result = recoverToolCall('view_file("src/main.py")');
    assert.ok(result, "should recover");
    assert.equal(result!.name, "view_file");
    assert.equal(result!.params.path, "src/main.py");
  });

  it("recovers view_file with line range", () => {
    const result = recoverToolCall('view_file("src/main.py", 10, 50)');
    assert.ok(result);
    assert.equal(result!.name, "view_file");
    assert.equal(result!.params.path, "src/main.py");
    assert.equal(result!.params.offset, 10);
    assert.equal(result!.params.limit, 50);
  });

  it("recovers 'View file: path' pattern", () => {
    const result = recoverToolCall("View file: src/main.py");
    assert.ok(result);
    assert.equal(result!.name, "view_file");
    assert.equal(result!.params.path, "src/main.py");
  });

  it("recovers 'View file path lines 10-50' pattern", () => {
    const result = recoverToolCall("View file: src/main.py lines 10-50");
    assert.ok(result);
    assert.equal(result!.params.path, "src/main.py");
    assert.equal(result!.params.offset, 10);
    assert.equal(result!.params.limit, 41);
  });

  it("recovers codebase_search query pattern", () => {
    const result = recoverToolCall('codebase_search("def handle")');
    assert.ok(result);
    assert.equal(result!.name, "codebase_search");
    assert.equal(result!.params.query, "def handle");
  });

  it("recovers 'search for' pattern", () => {
    const result = recoverToolCall('search for "def handle" in codebase');
    assert.ok(result);
    assert.equal(result!.name, "codebase_search");
    assert.equal(result!.params.query, "def handle");
  });

  it("recovers repo_tree pattern", () => {
    const result = recoverToolCall("repo_tree()");
    assert.ok(result);
    assert.equal(result!.name, "repo_tree");
  });

  it("recovers 'show repo tree' pattern", () => {
    const result = recoverToolCall("show the repo tree");
    assert.ok(result);
    assert.equal(result!.name, "repo_tree");
  });

  it("recovers connected_tree with path", () => {
    const result = recoverToolCall('connected_tree("src/main.py")');
    assert.ok(result);
    assert.equal(result!.name, "connected_tree");
    assert.equal(result!.params.path, "src/main.py");
  });

  it("recovers 'connected_tree for path' pattern", () => {
    const result = recoverToolCall("connected_tree for src/main.py");
    assert.ok(result);
    assert.equal(result!.name, "connected_tree");
    assert.equal(result!.params.path, "src/main.py");
  });

  it("returns null for unrelated text", () => {
    const result = recoverToolCall("I think the issue is in base.py");
    assert.equal(result, null);
  });
});

// ========================================================================
// truncateContext
// ========================================================================

describe("truncateContext", () => {
  const msgs = [
    { role: "system", content: "You are a localization assistant" },
    { role: "user", content: "Bug: ordering fails" },
    { role: "assistant", content: "I should check base.py" },
    { role: "tool", content: "File content: ..." },
    { role: "assistant", content: "Now check the model" },
    { role: "tool", content: "More file content..." },
    { role: "assistant", content: "Found it in query.py" },
  ];

  it("returns same array when within limits", () => {
    // preserveFirst(3) + preserveLast(4) = 7 >= 7 messages → no truncation
    const result = truncateContext(msgs, 3, 4);
    assert.equal(result.length, msgs.length);
  });

  it("truncates middle messages when over limit", () => {
    // preserveFirst(2) + preserveLast(2) = 4 < 7 messages → truncates to 5 (2 head + 1 marker + 2 tail)
    const result = truncateContext(msgs, 2, 2);
    assert.equal(result.length, 5);
  });

  it("inserts truncation marker when truncating", () => {
    // Force truncation: preserve 2 first, 2 last → total 5 but we have 7
    const result = truncateContext(msgs, 2, 2);
    // head(2) + marker(1) + tail(2) = 5
    assert.equal(result.length, 5);
    assert.ok(
      result[2].content!.includes("[Context truncated"),
      "should have truncation marker",
    );
    // First two preserved
    assert.equal(result[0].role, "system");
    assert.equal(result[1].role, "user");
    // Last two preserved
    assert.equal(result[result.length - 2].role, "tool");
    assert.equal(result[result.length - 1].role, "assistant");
  });
});

// ========================================================================
// manageContext
// ========================================================================

describe("manageContext", () => {
  it("returns same messages when under char threshold", () => {
    const msgs = [
      { role: "system", content: "short" },
      { role: "user", content: "short" },
    ];
    const result = manageContext(msgs, 10_000);
    assert.equal(result.length, 2);
  });

  it("truncates when over char threshold", () => {
    // Create enough messages so that preserveFirst(2) + preserveLast(6) < total
    const msgs = [
      { role: "system", content: "You are a localization assistant" },
      { role: "user", content: "Bug report" },
      { role: "assistant", content: "X".repeat(30_000) },
      { role: "tool", content: "Y".repeat(30_000) },
      { role: "assistant", content: "Z".repeat(30_000) },
      { role: "tool", content: "W".repeat(30_000) },
      { role: "assistant", content: "V".repeat(30_000) },
      { role: "tool", content: "U".repeat(30_000) },
      { role: "assistant", content: "T".repeat(30_000) },
      { role: "tool", content: "S".repeat(30_000) },
      { role: "assistant", content: "Final" },
    ];
    // Total = ~270K chars, threshold = 100 → must truncate
    const result = manageContext(msgs, 100);
    assert.ok(
      result.some((m) => m.content?.includes("[Context truncated")),
      "should include truncation marker when truncated",
    );
    assert.ok(result.length < msgs.length, "truncation should reduce message count");
  });
});

// ========================================================================
// checkResponseLength
// ========================================================================

describe("checkResponseLength", () => {
  it("returns null for short responses", () => {
    assert.equal(checkResponseLength("short text"), null);
  });

  it("warns for very long responses", () => {
    const long = "x".repeat(40_000);
    const msg = checkResponseLength(long, 500);
    assert.ok(msg, "should warn about long response");
    assert.ok(msg!.includes("concise"), "should suggest conciseness");
  });

  it("uses default maxSafeLength when not specified", () => {
    const long = "x".repeat(35_000);
    const msg = checkResponseLength(long);
    assert.ok(msg, "should warn when over default 30k");
  });
});

// ========================================================================
// finalTurnPrompt
// ========================================================================

describe("finalTurnPrompt", () => {
  it("returns null when more than 1 turn remains", () => {
    assert.equal(finalTurnPrompt(5), null);
    assert.equal(finalTurnPrompt(2), null);
  });

  it("returns synthesis prompt when 1 turn remains", () => {
    const msg = finalTurnPrompt(1);
    assert.ok(msg, "should return a prompt");
    assert.ok(msg!.includes("maximum number of tool calls"), "should mention limit");
    assert.ok(msg!.includes("Location explanation"), "should mention finding fields");
    assert.ok(msg!.includes("Root cause"), "should mention root cause");
    assert.ok(msg!.includes("Solution idea"), "should mention solution idea");
  });

  it("returns prompt for 0 remaining turns", () => {
    const msg = finalTurnPrompt(0);
    assert.ok(msg);
    assert.ok(msg!.includes("findings"), "should mention 'findings'");
    assert.ok(msg!.includes("locations"), "should mention 'locations'");
  });
});

// ========================================================================
// sherlocSystemPromptSupplement
// ========================================================================

describe("sherlocSystemPromptSupplement", () => {
  it("includes maxTurns in the prompt", () => {
    const prompt = sherlocSystemPromptSupplement(20);
    assert.ok(prompt.includes("20"), "should mention max turns");
    assert.ok(prompt.includes("Interaction Protocol"), "should have protocol header");
  });

  it("describes the final output format", () => {
    const prompt = sherlocSystemPromptSupplement(10);
    assert.ok(prompt.includes("<findings>"), "should mention findings tag");
    assert.ok(prompt.includes("<locations>"), "should mention locations tag");
  });

  it("mandates tool calls before final answer", () => {
    const prompt = sherlocSystemPromptSupplement(10);
    assert.ok(
      prompt.includes("first response must be a tool call"),
      "should require tool-first approach",
    );
  });
});
