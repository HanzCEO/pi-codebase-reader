/**
 * Tests for src/read-tool.ts
 *
 * Tests the registered `read` tool behavior by providing a minimal pi mock.
 * No tree-sitter WASM required — parse failures degrade gracefully to
 * outline headers or unsupported-language previews.
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
import { registerReadTool } from "./read-tool.js";
import type { SmartReadDeps } from "./read-tool.js";
import { DEFAULT_CONFIG } from "./types.js";

// ========================================================================
// Helpers
// ========================================================================

/** Call the registered tool's execute with a path and optional params. */
async function executeRead(
  tool: any,
  path: string,
  cwd: string,
  offset?: number,
  limit?: number,
  ranges?: Array<{ offset: number; limit: number }>,
): Promise<string> {
  const params: Record<string, unknown> = { path };
  if (offset !== undefined) params.offset = offset;
  if (limit !== undefined) params.limit = limit;
  if (ranges !== undefined) params.ranges = ranges;

  const result = await tool.execute(
    "test-call-id",
    params,
    undefined, // signal
    undefined, // onUpdate
    { cwd },  // ctx
  );
  return result.content[0].text;
}

// ========================================================================
// Tests
// ========================================================================

describe("registerReadTool", () => {
  let tmpDir: string;
  let tool: any;

  const defaults = { ...DEFAULT_CONFIG };

  function createTool(enabled: boolean, suggestSimilar = true) {
    const deps: SmartReadDeps = {
      isEnabled: () => enabled,
      getConfig: () => ({
        ...defaults,
        general: { ...defaults.general, enabled, suggest_similar: suggestSimilar },
      }),
    };

    let registered: any;
    const pi = { registerTool: (t: any) => { registered = t; } };
    registerReadTool(pi as any, deps);
    return registered;
  }

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "read-tool-test-"));

    // Small files (≤ 200 lines → full content)
    writeFileSync(join(tmpDir, "small.ts"), "const x: number = 1;\nconst y: string = 'hello';\n", "utf-8");
    writeFileSync(join(tmpDir, "small.md"), "# Readme\n\nHello world.\n", "utf-8");

    // Large files (> 200 lines → outline or preview)
    const largeTsLines: string[] = [];
    for (let i = 1; i <= 250; i++) {
      largeTsLines.push(`function fn${i}() { return ${i}; }`);
    }
    writeFileSync(join(tmpDir, "large.ts"), largeTsLines.join("\n"), "utf-8");

    const largeCssLines: string[] = [];
    for (let i = 1; i <= 250; i++) {
      largeCssLines.push(`Line number ${i}`);
    }
    writeFileSync(join(tmpDir, "large.css"), largeCssLines.join("\n"), "utf-8");

    // Empty file
    writeFileSync(join(tmpDir, "empty.ts"), "", "utf-8");

    // Single-line file
    writeFileSync(join(tmpDir, "single.ts"), 'export const VERSION = "1.0";\n', "utf-8");

    // Directory with mixed content
    mkdirSync(join(tmpDir, "adir"));
    writeFileSync(join(tmpDir, "adir", "a.ts"), "", "utf-8");
    writeFileSync(join(tmpDir, "adir", "b.ts"), "", "utf-8");

    mkdirSync(join(tmpDir, "zdir"));
    writeFileSync(join(tmpDir, "zdir", "z.ts"), "", "utf-8");

    writeFileSync(join(tmpDir, "aaa.txt"), "alpha\n", "utf-8");
    writeFileSync(join(tmpDir, "bbb.txt"), "beta\n", "utf-8");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Tool registration ─────────────────────────────────────────────

  it("registers a tool named 'read' with metadata", () => {
    const t = createTool(true);
    assert.equal(t.name, "read");
    assert.equal(typeof t.label, "string");
    assert.equal(typeof t.description, "string");
    assert.ok(t.description.length > 10);
    assert.equal(typeof t.execute, "function");
  });

  // ── Small file (full content) ─────────────────────────────────────

  it("returns full content for a small file when enabled", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "small.ts"), tmpDir);
    assert.ok(text.includes("small.ts"), "should include file name in header");
    assert.ok(text.includes("const x: number = 1;"), "should include full content");
    assert.ok(text.includes("const y: string = 'hello'"), "should include all lines");
  });

  it("returns full content for a small unsupported-language file", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "small.md"), tmpDir);
    assert.ok(text.includes("small.md"), "should include file name");
    assert.ok(text.includes("Hello world"), "should include content");
    // Verify it is full content, NOT a preview:
    assert.ok(text.includes("📄"), "should include the full-content emoji header");
    assert.ok(
      !text.includes("│"),
      "should NOT include line-number prefixes (would indicate preview)",
    );
    assert.ok(
      !text.includes("(unsupported language)"),
      "should NOT include the unsupported-language annotation",
    );
  });

  // ── Large file (outline vs preview) ───────────────────────────────

  it("returns an outline for a large supported-language file", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "large.ts"), tmpDir);
    // Should contain the file label and line/token info
    assert.ok(
      text.includes("large.ts"),
      "outline should reference the file path",
    );
    assert.ok(
      text.includes("lines"),
      "outline header should mention line count",
    );
    // If parsing works, we see function symbols; otherwise empty-symbol notice
    // The outline should be structural (contain tree connectors) not raw source
    assert.ok(
      text.includes("├──") || text.includes("└──") || text.includes("(no parseable symbols"),
      "outline should contain tree structure or empty-symbol notice",
    );
  });

  it("returns a preview for a large unsupported-language file", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "large.css"), tmpDir);
    assert.ok(
      text.includes("large.css") && text.includes("lines"),
      "preview should include file name and line count",
    );
    // Should show first lines and last lines
    assert.ok(
      text.includes("Line number 1"),
      "preview should show first lines",
    );
    assert.ok(
      text.includes("Line number 250"),
      "preview should show the last line",
    );
    assert.ok(
      text.includes("unsupported language"),
      "preview should note the language is unsupported",
    );
  });

  it("does not show raw source body for large unsupported files", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "large.md"), tmpDir);
    // Line 50 (middle content) should not appear in the preview
    assert.ok(
      !text.includes("Line number 50"),
      "middle lines should not appear in the preview",
    );
  });

  // ── Disabled mode ─────────────────────────────────────────────────

  it("returns full content for large files when disabled", async () => {
    tool = createTool(false);
    const text = await executeRead(tool, join(tmpDir, "large.ts"), tmpDir);
    // Should contain raw source line 150 (which would be hidden in outline mode)
    assert.ok(
      text.includes("function fn150()"),
      "disabled mode should show raw source, not outline",
    );
    // Verify it is raw source, NOT an outline:
    assert.ok(
      text.includes("{ return 150; }"),
      "should include raw source body, not just the symbol signature",
    );
    assert.ok(
      !text.includes("[150:150]"),
      "should NOT include outline range annotations",
    );
  });

  // ── Empty file ────────────────────────────────────────────────────

  it("handles empty files gracefully", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "empty.ts"), tmpDir);
    assert.ok(text.includes("empty.ts"), "should reference the file");
    // Should either show content (even if empty) or handle gracefully
    assert.ok(typeof text === "string");
  });

  // ── Missing file ──────────────────────────────────────────────────

  it("returns 'File not found' with suggestions for a typo path", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "smal.ts"), tmpDir);
    assert.ok(
      text.includes("File not found"),
      "should indicate file not found",
    );
    assert.ok(
      text.includes("Did you mean?"),
      "should ask 'Did you mean?' when suggestions are available",
    );
    assert.ok(
      text.includes("small.ts"),
      "should include the closest file name as suggestion",
    );
  });

  it("returns 'File not found' without suggestions when suggest_similar is false", async () => {
    tool = createTool(true, false);
    const text = await executeRead(tool, join(tmpDir, "smal.ts"), tmpDir);
    assert.ok(
      text.includes("File not found"),
      "should indicate file not found",
    );
    assert.ok(
      !text.includes("Did you mean?"),
      "should NOT suggest similar files when disabled",
    );
  });

  // ── Directory listing ─────────────────────────────────────────────

  it("lists directory contents sorted with directories first", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, tmpDir, tmpDir);

    // Should show header with entry count
    const basename = tmpDir.split("/").pop() || tmpDir;
    assert.ok(
      text.includes(`${basename}/`),
      "directory header should include the dir name",
    );

    // Directories should come before files in listing
    // In the listing: adir/ and zdir/ should appear before aaa.txt and bbb.txt
    const adirIdx = text.indexOf("adir/");
    const zdirIdx = text.indexOf("zdir/");
    const aaaIdx = text.indexOf("aaa.txt");
    const bbbIdx = text.indexOf("bbb.txt");

    assert.ok(adirIdx >= 0, "adir/ should be in listing");
    assert.ok(zdirIdx >= 0, "zdir/ should be in listing");
    assert.ok(aaaIdx >= 0, "aaa.txt should be in listing");
    assert.ok(bbbIdx >= 0, "bbb.txt should be in listing");

    // Directories appear before files
    assert.ok(adirIdx < aaaIdx, "directory 'adir/' should appear before file 'aaa.txt'");
  });

  it("shows 'dir' type and '--' size for directories in listing", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, tmpDir, tmpDir);
    // Directory entry should have 'dir' type and '--' size
    const adirLine = text.split("\n").find((l: string) => l.includes("adir/"));
    assert.ok(adirLine, "adir/ line should exist");
    assert.ok(adirLine!.includes("dir"), "directory entries should marked as 'dir'");
    assert.ok(adirLine!.includes("--"), "directory entries should show '--' for size");
  });

  // ── Offset / limit (section drill-down) ───────────────────────────

  it("reads specific line range when offset and limit are provided", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "large.ts"), tmpDir, 50, 5);
    assert.ok(
      text.includes("lines 50-54") || text.includes("lines 50-54"),
      "should indicate the line range in the response",
    );
    assert.ok(
      text.includes("function fn50()"),
      "should include line 50 content",
    );
    assert.ok(
      text.includes("function fn54()"),
      "should include line 54 content",
    );
    assert.ok(
      !text.includes("function fn55()"),
      "should NOT include line 55 (outside range)",
    );
  });

  it("handles offset without limit (reads to end of file)", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "large.ts"), tmpDir, 248);
    assert.ok(
      text.includes("function fn248()"),
      "should include line 248",
    );
    assert.ok(
      text.includes("function fn250()"),
      "should include last line",
    );
  });

  it("handles limit without offset (starts from line 1)", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "large.ts"), tmpDir, undefined, 3);
    assert.ok(
      text.includes("function fn1()"),
      "should include first line",
    );
    assert.ok(
      text.includes("function fn3()"),
      "should include third line",
    );
    assert.ok(
      !text.includes("function fn4()"),
      "should NOT include line 4",
    );
  });

  it("handles offset beyond file length gracefully", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "large.ts"), tmpDir, 999);
    // Should show the last line or indicate empty range
    assert.ok(typeof text === "string", "should not throw");
    assert.ok(
      text.includes("large.ts"),
      "should still reference the file",
    );
  });

  // ── Multi-range reads ───────────────────────────────────────────────

  it("reads multiple non-contiguous ranges in one call", async () => {
    tool = createTool(true);
    const text = await executeRead(
      tool,
      join(tmpDir, "large.ts"),
      tmpDir,
      undefined,
      undefined,
      [
        { offset: 10, limit: 3 },
        { offset: 50, limit: 3 },
        { offset: 100, limit: 3 },
      ],
    );
    assert.ok(
      text.includes("function fn10()"),
      "should include first range",
    );
    assert.ok(
      text.includes("function fn50()"),
      "should include second range",
    );
    assert.ok(
      text.includes("function fn100()"),
      "should include third range",
    );
    assert.ok(
      text.includes("function fn12()"),
      "should include end of first range",
    );
    assert.ok(
      text.includes("function fn52()"),
      "should include end of second range",
    );
    assert.ok(
      text.includes("function fn102()"),
      "should include end of third range",
    );
  });

  it("merges adjacent ranges automatically", async () => {
    tool = createTool(true);
    const text = await executeRead(
      tool,
      join(tmpDir, "large.ts"),
      tmpDir,
      undefined,
      undefined,
      [
        { offset: 20, limit: 5 },
        { offset: 24, limit: 5 },  // Overlaps with first range
      ],
    );
    // Should show merged range 20-28
    assert.ok(
      text.includes("function fn20()"),
      "should include start of merged range",
    );
    assert.ok(
      text.includes("function fn28()"),
      "should include end of merged range",
    );
    assert.ok(
      text.includes("merged"),
      "should indicate ranges were merged",
    );
  });

  it("handles empty ranges array by falling back to outline", async () => {
    tool = createTool(true);
    const text = await executeRead(
      tool,
      join(tmpDir, "large.ts"),
      tmpDir,
      undefined,
      undefined,
      [],
    );
    // Empty ranges array falls back to normal outline behavior
    assert.ok(
      text.includes("large.ts"),
      "should show file outline",
    );
    assert.ok(
      text.includes("lines"),
      "should show line count",
    );
  });

  // ── Error handling ────────────────────────────────────────────────

  it("returns error message when file cannot be read", async () => {
    tool = createTool(true);
    const nonExistent = join(tmpDir, "does-not-exist.ts");
    const text = await executeRead(tool, nonExistent, tmpDir);
    assert.ok(
      text.includes("File not found"),
      "should report file not found",
    );
  });

  // ── Single-line file behaviour ─────────────────────────────────────

  it("returns full content for a single-line file", async () => {
    tool = createTool(true);
    const text = await executeRead(tool, join(tmpDir, "single.ts"), tmpDir);
    assert.ok(text.includes('VERSION = "1.0"'), "should include the single line of content");
  });

  // ── .pi/skills bypass ──────────────────────────────────────────────

  it("returns full content for files matching .pi/skills (no special treatment)", async () => {
    tool = createTool(true);
    // Create a large file in .pi/skills that would normally get outlined
    const skillsDir = join(tmpDir, ".pi", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const largeSkillLines: string[] = [];
    for (let i = 1; i <= 250; i++) {
      largeSkillLines.push(`export function skill${i}() { return ${i}; }`);
    }
    writeFileSync(join(skillsDir, "my-skill.ts"), largeSkillLines.join("\n"), "utf-8");

    const text = await executeRead(tool, join(skillsDir, "my-skill.ts"), tmpDir);
    // Should return full content, NOT an outline
    assert.ok(
      text.includes("skill150()"),
      ".pi/skills files should return full content, not outline",
    );
    assert.ok(
      text.includes("{ return 150; }"),
      ".pi/skills files should include raw source body",
    );
    assert.ok(
      !text.includes("├──") && !text.includes("└──"),
      ".pi/skills files should NOT have tree outline structure",
    );
  });
});
