/**
 * Tests for src/outline.ts
 *
 * Pure function tests for generateOutline — no mocking needed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateOutline } from "./outline.js";
import type { SymbolInfo } from "./types.js";

// ---- Helper ----

function sym(
  name: string,
  type: string,
  startLine: number,
  endLine: number,
  children?: SymbolInfo[],
  detail?: string,
): SymbolInfo {
  return { name, type, startLine, endLine, children, detail };
}

// ========================================================================
// generateOutline
// ========================================================================

describe("generateOutline", () => {
  const commonOptions = {
    thresholdTokens: 10_000,
    maxDepth: 10,
    totalLines: 100,
    totalTokens: 5000,
    filePath: "test.ts",
    languageName: "TypeScript",
  };

  // ── Empty symbol list ─────────────────────────────────────────────

  it("returns outline with header and 'no parseable symbols' for empty input", () => {
    const result = generateOutline([], commonOptions);
    assert.ok(
      result.outline.includes("test.ts (TypeScript) — 100 lines, ~5.0K tokens"),
      "header should include file path, language, line count, and token count",
    );
    assert.ok(
      result.outline.includes("(no parseable symbols"),
      "should indicate no symbols were found",
    );
    // For empty symbols the outline trivially fits at maxDepth, so depth === options.maxDepth
    assert.equal(result.depth, commonOptions.maxDepth, "empty outline fits at max depth");
    assert.ok(result.tokens > 0, "should report non-zero tokens");
  });

  // ── Flat symbol list ──────────────────────────────────────────────

  it("renders flat top-level symbols correctly", () => {
    const symbols = [
      sym("foo", "function", 1, 10),
      sym("bar", "function", 12, 20),
      sym("Baz", "class", 22, 50),
    ];
    const result = generateOutline(symbols, commonOptions);
    const lines = result.outline.split("\n");
    assert.ok(lines.some((l) => l.includes("function foo") && l.includes("[1:10]")));
    assert.ok(lines.some((l) => l.includes("function bar") && l.includes("[12:20]")));
    assert.ok(lines.some((l) => l.includes("class Baz") && l.includes("[22:50]")));
  });

  // ── Nested children ───────────────────────────────────────────────

  it("renders nested children for class symbols", () => {
    const symbols = [
      sym("MyClass", "class", 1, 30, [
        sym("constructor", "method", 2, 10),
        sym("doStuff", "method", 12, 28),
      ]),
    ];
    const result = generateOutline(symbols, commonOptions);
    assert.ok(result.outline.includes("class MyClass"));
    assert.ok(result.outline.includes("method constructor"));
    assert.ok(result.outline.includes("method doStuff"));

    // Children should be indented deeper than parent
    const lines = result.outline.split("\n");
    const classLine = lines.find((l) => l.includes("class MyClass"));
    const childLine = lines.find((l) => l.includes("method constructor"));
    assert.ok(classLine, "class line must exist");
    assert.ok(childLine, "child line must exist");
    if (classLine && childLine) {
      assert.ok(
        childLine.replace(/[│├└─\s]/g, "").length <
          classLine.replace(/[│├└─\s]/g, "").length,
        "child should be indented further than parent",
      );
    }
  });

  // ── Child count in parent ──────────────────────────────────────────

  it("includes child count in parent symbols that have children", () => {
    const symbols = [
      sym("Multi", "class", 1, 20, [
        sym("a", "method", 2, 5),
        sym("b", "method", 7, 10),
      ]),
    ];
    const result = generateOutline(symbols, commonOptions);
    assert.ok(result.outline.includes("(2 children)"));
  });

  // ── Depth limit with nested items hint ────────────────────────────

  it("shows nested items hint when maxDepth limits expansion", () => {
    // Need grandchildren to trigger "nested items" hint at depth 1
    const grandchildren = [
      sym("methodA", "method", 3, 5),
      sym("methodB", "method", 7, 10),
    ];
    const child = sym("Inner", "class", 2, 20, grandchildren);
    const symbols = [sym("Top", "class", 1, 30, [child])];

    // With maxDepth=1, Top's direct children are expanded (depth 0 < 1),
    // but grandchildren (depth 1) hit the limit and show a hint.
    const result = generateOutline(symbols, {
      ...commonOptions,
      maxDepth: 1,
    });

    assert.ok(
      result.outline.includes("(2 nested items)"),
      "should hint at hidden grandchildren when depth limit reached",
    );
    // The child "Inner" should still be present (it's depth 1)
    assert.ok(
      result.outline.includes("class Inner"),
      "should expand one level of children",
    );
    assert.ok(
      !result.outline.includes("method methodA"),
      "should NOT expand grandchildren at depth limit",
    );
  });

  // ── Function details (parameters) ──────────────────────────────────

  it("includes function detail (parameters) in the symbol line", () => {
    const symbols = [
      sym("greet", "function", 1, 3, undefined, "(name: string)"),
    ];
    const result = generateOutline(symbols, commonOptions);
    assert.ok(
      result.outline.includes("function greet(name: string) [1:3]"),
    );
  });

  // ── Detail truncation ─────────────────────────────────────────────

  it("truncates details longer than 60 characters", () => {
    const longDetail = "(" + "longParam".repeat(10) + ")";
    const symbols = [
      sym("longFn", "function", 1, 3, undefined, longDetail),
    ];
    const result = generateOutline(symbols, commonOptions);
    const line = result.outline.split("\n").find((l) => l.includes("function longFn"));
    assert.ok(line, "symbol should appear in outline");
    // The detail should be truncated with "..."
    assert.ok(line!.includes("..."), "long detail should be truncated with ellipsis");
    // The original full detail should NOT appear in full
    assert.ok(!line!.includes("longParam".repeat(10)), "full long detail should be truncated");
  });

  // ── Token threshold at zero ────────────────────────────────────────

  it("returns depth 1 when thresholdTokens is 0", () => {
    const symbols = [
      sym("A", "function", 1, 5),
      sym("B", "function", 7, 10),
    ];
    const result = generateOutline(symbols, {
      ...commonOptions,
      thresholdTokens: 0,
    });
    assert.equal(result.depth, 1, "must fall back to depth 1");
    assert.ok(result.outline.length > 0, "outline must have content");
  });

  // ── maxDepth of 0 (edge case) ─────────────────────────────────────

  it("handles maxDepth = 0 gracefully (falls to depth 1)", () => {
    const symbols = [
      sym("Root", "class", 1, 10, [
        sym("inner", "method", 2, 8),
      ]),
    ];
    const result = generateOutline(symbols, {
      ...commonOptions,
      maxDepth: 0,
    });
    assert.equal(result.depth, 1, "should fall back to depth 1");
    // Should show the top-level symbol
    assert.ok(result.outline.includes("class Root"));
  });

  // ── Adaptive depth reduction ──────────────────────────────────────

  it("reduces depth when outline exceeds token threshold", () => {
    // Create symbols with grandchildren to show the depth reduction effect
    const manySymbols: SymbolInfo[] = [];
    for (let i = 0; i < 30; i++) {
      manySymbols.push(
        sym(
          `item${i}`,
          "function",
          i * 2 + 1,
          i * 2 + 2,
          [
            sym(`inner${i}`, "method", i * 2 + 1, i * 2 + 2, [
              sym(`deep${i}`, "variable", i * 2 + 1, i * 2 + 2),
            ]),
          ],
          `(param${i}: string)`,
        ),
      );
    }

    const result = generateOutline(manySymbols, {
      ...commonOptions,
      thresholdTokens: 15, // very low — forces depth to 1
      totalTokens: 100,
    });

    assert.equal(result.depth, 1, "low threshold should force depth to 1");
    assert.ok(result.outline.length > 0, "outline should still be rendered");
    // At depth 1, children (one level) ARE expanded, but grandchildren are not
    assert.ok(
      result.outline.includes("method inner"),
      "one level of children should still be expanded at depth 1",
    );
    assert.ok(
      !result.outline.includes("variable deep"),
      "grandchildren should not be expanded at depth 1",
    );
  });

  // ── Language name in header ────────────────────────────────────────

  it("omits language name when languageName is undefined", () => {
    const result = generateOutline([], {
      ...commonOptions,
      languageName: undefined,
    });
    assert.ok(
      result.outline.includes("test.ts — 100 lines"),
      "header without language should omit parentheses",
    );
    assert.ok(
      !result.outline.includes("(undefined)"),
      "should not show 'undefined' as language",
    );
  });

  // ── File label extraction ─────────────────────────────────────────

  it("extracts file label from path with nested directories", () => {
    const result = generateOutline([], {
      ...commonOptions,
      filePath: "src/utils/helper.ts",
    });
    assert.ok(
      result.outline.includes("helper.ts"),
      "should use basename, not full path",
    );
  });

  it("uses full filePath as label when there is no separator", () => {
    const result = generateOutline([], {
      ...commonOptions,
      filePath: "Makefile",
    });
    assert.ok(
      result.outline.includes("Makefile"),
      "should use the whole path when no / present",
    );
  });

  // ── Multiple top-level symbols with children ──────────────────────

  it("renders multiple top-level items each with their own children", () => {
    const symbols = [
      sym("ClassA", "class", 1, 20, [
        sym("a1", "method", 2, 10),
      ]),
      sym("ClassB", "class", 22, 40, [
        sym("b1", "method", 23, 30),
        sym("b2", "method", 32, 38),
      ]),
    ];
    const result = generateOutline(symbols, commonOptions);
    assert.ok(result.outline.includes("class ClassA"));
    assert.ok(result.outline.includes("method a1"));
    assert.ok(result.outline.includes("class ClassB"));
    assert.ok(result.outline.includes("method b1"));
    assert.ok(result.outline.includes("method b2"));
  });
});
