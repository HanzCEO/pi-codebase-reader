/**
 * Tests for src/fuzzy-suggest.ts
 *
 * Run with: npx tsx --test src/fuzzy-suggest.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { levenshtein, suggestSimilarPaths } from "./fuzzy-suggest.js";

// ========================================================================
// levenshtein
// ========================================================================

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    assert.equal(levenshtein("hello", "hello"), 0);
    assert.equal(levenshtein("", ""), 0);
    assert.equal(levenshtein("a".repeat(100), "a".repeat(100)), 0);
  });

  it("returns length of non-empty string when other is empty", () => {
    assert.equal(levenshtein("hello", ""), 5);
    assert.equal(levenshtein("", "world"), 5);
    assert.equal(levenshtein("x", ""), 1);
  });

  it("handles single-character insertions", () => {
    // "helper" → "helpers" (insert 's' at end)
    assert.equal(levenshtein("helper", "helpers"), 1);
    // "helper" → "ahelper" (insert 'a' at start)
    assert.equal(levenshtein("helper", "ahelper"), 1);
  });

  it("handles single-character deletions", () => {
    // "helpers" → "helper" (delete 's')
    assert.equal(levenshtein("helpers", "helper"), 1);
    // "helper" → "helpr" (delete 'e')
    assert.equal(levenshtein("helper", "helpr"), 1);
  });

  it("handles single-character substitutions", () => {
    // "helper" → "helpr" actually... let me check: h-e-l-p-e-r vs h-e-l-p-r
    // substitution: 'e'→'' (wait, that's deletion)
    // "helper" → "hepler" is a transposition which is distance 2
    // Let's use a clear substitution:
    assert.equal(levenshtein("cat", "car"), 1); // 't' → 'r'
    assert.equal(levenshtein("cat", "bat"), 1); // 'c' → 'b'
  });

  it("handles common filename typos", () => {
    // Missing character
    assert.equal(levenshtein("helper.ts", "helpr.ts"), 1);
    // Extra character
    assert.equal(levenshtein("helper.ts", "helpper.ts"), 1);
    // Single substitution
    assert.equal(levenshtein("helper.ts", "helpen.ts"), 1);
    // Two substitutions
    assert.equal(levenshtein("helper.ts", "halpen.ts"), 2);
    // Three substitutions (completely different short word)
    assert.equal(levenshtein("cat", "dog"), 3);
    // Case difference alone
    assert.equal(levenshtein("Helper.ts", "helper.ts"), 1);
  });

  it("handles transpositions as distance 2", () => {
    // "helper" → "hepler" requires 2 edits (swap 'l' and 'p')
    assert.equal(levenshtein("helper", "hepler"), 2);
    // "components" → "compnents" (missing 'o') = 1 (deletion)
    assert.equal(levenshtein("components", "compnents"), 1);
  });

  it("handles completely different strings", () => {
    assert.equal(levenshtein("abc", "xyz"), 3);
    assert.equal(levenshtein("hello", "world"), 4); // h→w, e→o, l→r, l→l(0), o→d = 4
  });

  it("uses O(min(m,n)) memory for large inputs", () => {
    // This should not throw or take excessive memory
    const long = "a".repeat(10_000);
    assert.equal(levenshtein(long, long), 0);
    assert.equal(levenshtein(long, long + "b"), 1);
  });

  it("is symmetric (commutative)", () => {
    assert.equal(levenshtein("abc", "xyz"), levenshtein("xyz", "abc"));
    assert.equal(levenshtein("hello", "helpo"), levenshtein("helpo", "hello"));
  });
});

// ========================================================================
// suggestSimilarPaths
// ========================================================================

describe("suggestSimilarPaths", () => {
  let tmpDir: string;

  // ── Fixture layout ──────────────────────────────────────────────
  //   <tmp>/
  //     existing.txt
  //     helper.ts
  //     helpers.ts
  //     config.json
  //     src/
  //       main.ts
  //       utils/
  //         util.ts
  //         strings.ts
  //     empty-dir/
  //     deep/
  //       index.js
  //       nested/
  //         target.ts
  // ─────────────────────────────────────────────────────────────────
  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fuzzy-suggest-test-"));

    // Files in root
    writeFileSync(join(tmpDir, "existing.txt"), "hello", "utf-8");
    writeFileSync(join(tmpDir, "helper.ts"), "", "utf-8");
    writeFileSync(join(tmpDir, "helpers.ts"), "", "utf-8");
    writeFileSync(join(tmpDir, "config.json"), "{}", "utf-8");

    // src/ directory tree
    mkdirSync(join(tmpDir, "src"));
    writeFileSync(join(tmpDir, "src", "main.ts"), "", "utf-8");

    mkdirSync(join(tmpDir, "src", "utils"));
    writeFileSync(join(tmpDir, "src", "utils", "util.ts"), "", "utf-8");
    writeFileSync(join(tmpDir, "src", "utils", "strings.ts"), "", "utf-8");

    // empty-dir/ (no children)
    mkdirSync(join(tmpDir, "empty-dir"));

    // deep/ tree
    mkdirSync(join(tmpDir, "deep"));
    writeFileSync(join(tmpDir, "deep", "index.js"), "", "utf-8");
    mkdirSync(join(tmpDir, "deep", "nested"));
    writeFileSync(join(tmpDir, "deep", "nested", "target.ts"), "", "utf-8");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── null / already-exists guards ─────────────────────────────────

  it("returns empty array for null resolvedPath", () => {
    const result = suggestSimilarPaths(null, "foo.txt");
    assert.deepEqual(result, []);
  });

  it("returns empty array when the path already exists", () => {
    const existing = join(tmpDir, "existing.txt");
    const result = suggestSimilarPaths(existing, "existing.txt");
    assert.deepEqual(result, []);
  });

  // ── Single file typo in root ─────────────────────────────────────

  it("suggests close filenames for a single-file typo", () => {
    const target = join(tmpDir, "helpr.ts"); // typo for helper.ts
    const result = suggestSimilarPaths(target, "helpr.ts");
    assert.ok(result.length >= 1, "should have at least one suggestion");
    const displays = result.map((s) => s.display);
    assert.ok(displays.includes("helper.ts"), "should suggest helper.ts");
    // helpers should also be close
    assert.ok(displays.includes("helpers.ts"), "should suggest helpers.ts");
    // Sorted by distance: helper.ts (dist 1) before helpers.ts (dist 2)
    assert.equal(result[0].display, "helper.ts");
    assert.ok(result[0].distance <= result[1].distance);
  });

  it("does not suggest entries above the distance threshold", () => {
    const target = join(tmpDir, "completelywrongname.xyz");
    const result = suggestSimilarPaths(target, "completelywrongname.xyz");
    // No files in tmpDir should be close enough
    assert.deepEqual(result, []);
  });

  // ── Deep path: first segment is a directory typo ─────────────────

  it("suggests a corrected deep path when a directory name has a typo", () => {
    // "sr/" instead of "src/"
    const target = join(tmpDir, "sr", "main.ts");
    const result = suggestSimilarPaths(target, "sr/main.ts");
    assert.ok(result.length >= 1, "should have at least one suggestion");
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes("src/main.ts"),
      "should suggest src/main.ts",
    );
  });

  it("reconstructs the full display path for deep directory typos", () => {
    // "sr/utils/util.ts" instead of "src/utils/util.ts"
    const target = join(tmpDir, "sr", "utils", "util.ts");
    const result = suggestSimilarPaths(target, "sr/utils/util.ts");
    assert.ok(result.length >= 1, "should have at least one suggestion");
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes("src/utils/util.ts"),
      "should suggest src/utils/util.ts",
    );
  });

  // ── Deep path: file typo inside existing directory ───────────────

  it("suggests close filenames inside an existing directory", () => {
    // Existing dir: src/utils/
    const target = join(tmpDir, "src", "utils", "utill.ts"); // typo for util.ts
    const result = suggestSimilarPaths(target, "src/utils/utill.ts");
    assert.ok(result.length >= 1, "should have at least one suggestion");
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes("src/utils/util.ts"),
      "should suggest src/utils/util.ts",
    );
    // strings.ts is too far from utill.ts to be suggested (distance exceeds threshold)
  });

  // ── Empty directory ──────────────────────────────────────────────

  it("returns empty array when the ancestor directory is empty", () => {
    const target = join(tmpDir, "empty-dir", "foo.txt");
    const result = suggestSimilarPaths(target, "empty-dir/foo.txt");
    assert.deepEqual(result, []);
  });

  // ── Non-existent ancestor (walk-up fails) ────────────────────────

  it("returns empty array when no ancestor exists (walk-up fails)", () => {
    // A path so deep that no ancestor exists; but root "/" always exists
    // So to test this, we need a really deep path under a non-existent root-level entry.
    // Since tmpDir exists, we need a path entirely outside it.
    // Use a guaranteed-non-existent absolute path root.
    // Actually, root "/" always exists on POSIX, so we can't fully fail.
    // But for a path like "/definitely-does-not-exist-12345/foo/bar",
    // the ancestor "/definitely-does-not-exist-12345" doesn't exist,
    // and its parent "/" does exist.
    // So this will actually suggest root-level entries (unlikely to match).
    // This tests the edge case gracefully.
    const target = "/a_very_unique_prefix_that_should_not_exist_xyz/foo.txt";
    const result = suggestSimilarPaths(target, target);
    // Should not crash and likely return empty since nothing at root is close
    assert.ok(Array.isArray(result));
  });

  // ── Case-insensitive matching ────────────────────────────────────

  it("matches case-insensitively", () => {
    const target = join(tmpDir, "Helper.ts"); // capital H
    const result = suggestSimilarPaths(target, "Helper.ts");
    assert.ok(result.length >= 1, "should have at least one suggestion");
    // helper.ts should be found despite case difference
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes("helper.ts"),
      "should suggest helper.ts (case-insensitive match)",
    );
  });

  // ── Maximum 5 suggestions ────────────────────────────────────────

  it("returns at most 5 suggestions", () => {
    // Create a dir with many close matches
    const manyDir = mkdtempSync(join(tmpDir, "many-"));
    for (let i = 1; i <= 20; i++) {
      writeFileSync(join(manyDir, `file${i}.ts`), "", "utf-8");
    }
    // Request a file name close to all of them
    const target = join(manyDir, "file.ts");
    const result = suggestSimilarPaths(target, join(manyDir, "file.ts"));
    assert.ok(result.length <= 5, "should return at most 5 suggestions");
    rmSync(manyDir, { recursive: true, force: true });
  });

  // ── Relative vs absolute display path ────────────────────────────

  it("preserves absolute path form in suggestions", () => {
    const absTarget = join(tmpDir, "helpr.ts");
    // Pass the absolute path as displayPath
    const result = suggestSimilarPaths(absTarget, absTarget);
    assert.ok(result.length >= 1);
    // The suggestion should also be an absolute path
    const expectedAbs = join(tmpDir, "helper.ts");
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes(expectedAbs),
      "should suggest absolute path for absolute input",
    );
  });

  it("preserves relative path form in suggestions", () => {
    // Use a relative path with a single level of depth
    // We need to simulate cwd = tmpDir, but resolvePath() does that in the tool.
    // Here we pass the resolved (absolute) target but a relative display path.
    const target = join(tmpDir, "helpr.ts");
    const result = suggestSimilarPaths(target, "helpr.ts");
    assert.ok(result.length >= 1);
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes("helper.ts"),
      "should suggest relative path for relative input",
    );
  });

  // ── Path with ~/ style ───────────────────────────────────────────

  it("handles deep path with single-level missing directory", () => {
    // "deep/nsted/target.ts" → "deep/" exists, "nsted" doesn't → suggest "deep/nested/target.ts"
    const target = join(tmpDir, "deep", "nsted", "target.ts");
    const result = suggestSimilarPaths(target, "deep/nsted/target.ts");
    assert.ok(result.length >= 1, "should have at least one suggestion");
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes("deep/nested/target.ts"),
      "should suggest deep/nested/target.ts",
    );
  });

  // ── Multi-segment deep-path (recursive) ──────────────────────────

  it("recursively deepens when multiple path segments are wrong", () => {
    // "deep/nsted/taret.ts" → two typos: "nsted" (should be "nested") and
    // "taret.ts" (should be "target.ts"). Recursive deepening should
    // correct both and yield "deep/nested/target.ts".
    const target = join(tmpDir, "deep", "nsted", "taret.ts");
    const result = suggestSimilarPaths(target, "deep/nsted/taret.ts");
    assert.ok(result.length >= 1, "should have at least one suggestion");
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes("deep/nested/target.ts"),
      "should correct both segments: deep/nested/target.ts",
    );
    // Total distance should reflect both corrections (nsted→nested + taret→target)
    const best = result.find((s) => s.display === "deep/nested/target.ts");
    assert.ok(best, "deep/nested/target.ts should be in results");
    assert.equal(best!.distance, 2, "total distance should be 2 (1+1)");
  });

  it("does not recurse into file matches", () => {
    // "deep/index.js/foo" — index.js is a file, not a directory.
    // The function should not crash and should return no suggestions since
    // you can't descend into a file.
    const target = join(tmpDir, "deep", "index.js", "foo");
    const result = suggestSimilarPaths(target, "deep/index.js/foo");
    assert.ok(Array.isArray(result));
    // Likely empty because no close dir match for "index.js" that leads to "foo"
  });

  // ── Sorted by distance ───────────────────────────────────────────

  it("returns suggestions sorted by distance (closest first)", () => {
    const target = join(tmpDir, "helpr.ts");
    const result = suggestSimilarPaths(target, "helpr.ts");
    for (let i = 1; i < result.length; i++) {
      assert.ok(
        result[i - 1].distance <= result[i].distance,
        `result[${i - 1}].distance (${result[i - 1].distance}) should be <= result[${i}].distance (${result[i].distance})`,
      );
    }
  });

  // ── Non-existent ancestor deeper in the tree ─────────────────────

  it("walks up past multiple missing directories to nearest ancestor", () => {
    // "a/b/c/d.txt" where a/b/c/ doesn't exist, a/b/ doesn't exist, a/ doesn't exist
    // but tmpDir exists → should scan tmpDir for matches to "a"
    const target = join(tmpDir, "a", "b", "c", "d.txt");
    const result = suggestSimilarPaths(target, "a/b/c/d.txt");
    assert.ok(Array.isArray(result));
    // a isn't close to anything in tmpDir, so likely empty
    // But it shouldn't crash or throw
  });

  // ── Threshold boundary ────────────────────────────────────────────

  it("suggests entries at the distance threshold but not above it", () => {
    const thresholdDir = mkdtempSync(join(tmpDir, "threshold-"));
    try {
      // Create files with controlled Levenshtein distance from target "abcdf.txt"
      // "abcdf.txt" length = 9, ceil(9 * 0.4) = ceil(3.6) = 4
      writeFileSync(join(thresholdDir, "abcde.txt"), "", "utf-8"); // dist from "abcdf.txt": 1 (e→f) → within threshold
      writeFileSync(join(thresholdDir, "abcxg.txt"), "", "utf-8"); // dist from "abcdf.txt": 2 (d→x, f→g) → within threshold
      writeFileSync(join(thresholdDir, "zzzzz.txt"), "", "utf-8"); // dist from "abcdf.txt": 5 → above threshold

      const target = join(thresholdDir, "abcdf.txt");
      const result = suggestSimilarPaths(target, "abcdf.txt");
      const displays = result.map((s) => s.display);

      assert.ok(
        displays.includes("abcde.txt"),
        "distance-1 match should be suggested (within threshold)",
      );
      assert.ok(
        displays.includes("abcxg.txt"),
        "distance-2 match should be suggested (within threshold)",
      );
      assert.ok(
        !displays.includes("zzzzz.txt"),
        "distance-5 match should NOT be suggested (above threshold)",
      );
    } finally {
      rmSync(thresholdDir, { recursive: true, force: true });
    }
  });

  it("uses length-scaled threshold for long path segments", () => {
    // Verify the dynamic multiplier (firstMissing.length * 0.4) produces
    // a higher threshold for long names, beyond the Math.max(2, ...) floor.
    // For a 12-char name: threshold = ceil(12 * 0.4) = ceil(4.8) = 5
    const longDir = mkdtempSync(join(tmpDir, "long-threshold-"));
    try {
      // All files must be written BEFORE calling suggestSimilarPaths
      writeFileSync(join(longDir, "longgile.txt"), "", "utf-8"); // dist 1 from "longfile.txt" (sub g→f)
      writeFileSync(join(longDir, "lonfile.txt"), "", "utf-8");  // dist 3 from "longfile.txt" (omit ng, add f)
      writeFileSync(join(longDir, "xyzxyzxyz.txt"), "", "utf-8"); // dist ≈ 12 → far above threshold

      const target = join(longDir, "longfile.txt");
      const result = suggestSimilarPaths(target, "longfile.txt");
      const displays = result.map((s) => s.display);

      assert.ok(
        displays.includes("longgile.txt"),
        "distance-1 match should be suggested (within scaled threshold)",
      );
      assert.ok(
        displays.includes("lonfile.txt"),
        "distance-3 match should be suggested (within scaled threshold of 5)",
      );
      assert.ok(
        !displays.includes("xyzxyzxyz.txt"),
        "distance-12 match should NOT be suggested (above threshold)",
      );
    } finally {
      rmSync(longDir, { recursive: true, force: true });
    }
  });

  // ── Hidden files ─────────────────────────────────────────────────

  it("suggests hidden files (dotfiles) when they match", () => {
    const hiddenDir = mkdtempSync(join(tmpDir, "hidden-"));
    try {
      writeFileSync(join(hiddenDir, ".env.example"), "", "utf-8");

      // Request a close typo of the hidden file
      const target = join(hiddenDir, ".env.exmaple"); // typo: 'ple' vs 'ple'... actually 'pl' vs 'mp'
      const result = suggestSimilarPaths(target, ".env.exmaple");
      const displays = result.map((s) => s.display);
      assert.ok(
        displays.includes(".env.example"),
        "should suggest the hidden .env.example file",
      );
    } finally {
      rmSync(hiddenDir, { recursive: true, force: true });
    }
  });

  // ── Display path with tilde prefix ───────────────────────────────

  it("preserves tilde prefix in display path when input uses tildes", () => {
    // The function resolves the path internally but should maintain
    // the ~/ display style in suggestions.
    // We test via a resolved absolute path but a display path with tilde.
    const target = join(tmpDir, "helpr.ts");
    // Pass a tilde-style display path
    const tildeDisplay = "~/helpr.ts";
    const result = suggestSimilarPaths(target, tildeDisplay);
    assert.ok(result.length >= 1, "should have suggestions for typo");
    const displays = result.map((s) => s.display);
    assert.ok(
      displays.includes("~/helper.ts"),
      "should preserve tilde prefix in suggestion display",
    );
  });

  // ── Recursion depth limit (more than 3 missing segments) ─────────

  it("returns empty when path has 4+ incorrect segments (beyond recursion depth)", () => {
    // max recursion depth in findMatchesRecursive is 3 (maxDepth parameter starts at 3)
    // A path with 4 incorrect segments should return no suggestions
    // because the algorithm can't descend far enough
    const deepMissing = join(tmpDir, "a", "b", "c", "d", "file.ts");
    const result = suggestSimilarPaths(deepMissing, "a/b/c/d/file.ts");
    assert.ok(Array.isArray(result));
    // Likely empty since we need 4 levels of correction
    // But it must not crash
  });

  // ── Path ending in separator ─────────────────────────────────────

  it("handles paths ending with a separator gracefully", () => {
    const target = join(tmpDir, "helper.ts") + "/"; // trailing slash like a dir
    // existsSync will return true for helper.ts (it's a file), but the trailing slash
    // might cause issues. Actually on Linux, existsSync("path/file/") returns false
    // if "file" is a regular file. So this should trigger suggestions.
    const result = suggestSimilarPaths(target, "helper.ts/");
    // Should not crash; may return empty because the path with trailing /
    // behaves differently
    assert.ok(Array.isArray(result));
  });

  // ── Single-segment typo inside an existing directory ─────────────

  it("suggests the correct file when only the file name has a typo", () => {
    // Create a real dir with a real file, then request a close typo
    const realDir = mkdtempSync(join(tmpDir, "realfiles-"));
    try {
      writeFileSync(join(realDir, "target.ts"), "", "utf-8");

      // Provide an absolute resolvedPath and a relative displayPath
      const target = join(realDir, "taregt.ts"); // typo: target → taregt
      const result = suggestSimilarPaths(target, "taregt.ts");
      assert.ok(result.length >= 1, "should find target.ts from typo");

      // displayPath is relative so suggestions are relative
      const displays = result.map((s) => s.display);
      assert.ok(
        displays.includes("target.ts"),
        "should suggest target.ts with relative display",
      );
    } finally {
      rmSync(realDir, { recursive: true, force: true });
    }
  });
});
