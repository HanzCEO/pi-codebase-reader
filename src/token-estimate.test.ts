/**
 * Tests for src/token-estimate.ts
 *
 * Pure function tests — no mocking needed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateCodeTokens,
  estimateOutlineTokens,
  formatTokenCount,
} from "./token-estimate.js";

// ========================================================================
// estimateCodeTokens
// ========================================================================

describe("estimateCodeTokens", () => {
  it("returns 0 for empty string", () => {
    assert.equal(estimateCodeTokens(""), 0);
  });

  it("estimates tokens at ~4 chars per token (rounded up)", () => {
    // "hello" is 5 chars → ceil(5/4) = 2
    assert.equal(estimateCodeTokens("hello"), 2);
    // "abcd" is 4 chars → ceil(4/4) = 1
    assert.equal(estimateCodeTokens("abcd"), 1);
    // "abcde" is 5 chars → ceil(5/4) = 2
    assert.equal(estimateCodeTokens("abcde"), 2);
  });

  it("handles multiline source code", () => {
    const code = `function hello() {\n  return "world";\n}`;
    // 38 chars / 4 = 9.5 → ceil = 10
    assert.equal(estimateCodeTokens(code), 10);
  });

  it("handles very long strings", () => {
    const long = "x".repeat(10_000);
    assert.equal(estimateCodeTokens(long), 2500);
  });

  it("handles single characters", () => {
    assert.equal(estimateCodeTokens("a"), 1);
    assert.equal(estimateCodeTokens(""), 0);
  });

  it("handles whitespace-only strings", () => {
    assert.equal(estimateCodeTokens("   "), 1);
    assert.equal(estimateCodeTokens("\n\n\n\n"), 1);
  });

  it("handles unicode characters", () => {
    // "🚀🔥" is 8 bytes (2 code points * 4 bytes each in UTF-8),
    // but JavaScript .length counts UTF-16 code units
    // "🚀".length = 2 (surrogate pair), "🔥".length = 2
    // Total: 4 code units → ceil(4/4) = 1
    assert.equal(estimateCodeTokens("🚀🔥"), 1);
  });

  it("scales linearly with input length", () => {
    const small = "a".repeat(100);
    const large = "a".repeat(10_000);
    assert.equal(estimateCodeTokens(large), estimateCodeTokens(small) * 100);
  });
});

// ========================================================================
// estimateOutlineTokens
// ========================================================================

describe("estimateOutlineTokens", () => {
  it("returns 0 for empty string", () => {
    assert.equal(estimateOutlineTokens(""), 0);
  });

  it("estimates tokens at ~3 chars per token for outlines (rounded up)", () => {
    // "abc" is 3 chars → ceil(3/3) = 1
    assert.equal(estimateOutlineTokens("abc"), 1);
    // "abcd" is 4 chars → ceil(4/3) = 2
    assert.equal(estimateOutlineTokens("abcd"), 2);
  });

  it("handles typical multi-line outline text", () => {
    const outline = [
      "file.ts (TypeScript) — 100 lines, ~1.5K tokens",
      "├── class MyClass (3 children) [1:30]",
      "│   ├── method constructor [2:10]",
      "│   └── method doStuff [12:28]",
    ].join("\n");
    const estimated = estimateOutlineTokens(outline);
    assert.ok(estimated > 0, "should estimate non-zero tokens for a real outline");
  });

  it("handles single-character inputs", () => {
    assert.equal(estimateOutlineTokens("x"), 1);
  });
});

// ========================================================================
// formatTokenCount
// ========================================================================

describe("formatTokenCount", () => {
  it("formats numbers below 1000 as-is", () => {
    assert.equal(formatTokenCount(0), "0");
    assert.equal(formatTokenCount(1), "1");
    assert.equal(formatTokenCount(500), "500");
    assert.equal(formatTokenCount(999), "999");
  });

  it("formats exactly 1000 as '1.0K'", () => {
    assert.equal(formatTokenCount(1000), "1.0K");
  });

  it("formats between 1000 and 10000 with one decimal place", () => {
    assert.equal(formatTokenCount(1500), "1.5K");
    assert.equal(formatTokenCount(2500), "2.5K");
    assert.equal(formatTokenCount(9999), "10.0K");
  });

  it("formats between 10000 and 999999 with no decimal place", () => {
    assert.equal(formatTokenCount(10_000), "10K");
    assert.equal(formatTokenCount(100_500), "101K");
    // 999000 >= 10000 so toFixed(0) → "999", appended "K"
    assert.equal(formatTokenCount(999_000), "999K");
  });

  it("formats exactly 1000000 as '1.0M'", () => {
    assert.equal(formatTokenCount(1_000_000), "1.0M");
  });

  it("formats millions with one decimal place", () => {
    assert.equal(formatTokenCount(2_500_000), "2.5M");
    assert.equal(formatTokenCount(10_000_000), "10.0M");
    assert.equal(formatTokenCount(999_999_999), "1000.0M");
  });

  it("handles edge case of 999999", () => {
    // 999999 / 1000 = 999.999 → `toFixed(1)` → "1000.0" → strip → "1000.0K"
    // Actually current code: `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}K`
    // For 999999: tokens >= 10000 is true, so toFixed(0) → "1000" → "1000K"
    assert.equal(formatTokenCount(999_999), "1000K");
  });

  it("handles very large numbers", () => {
    assert.equal(formatTokenCount(50_000_000), "50.0M");
  });
});
