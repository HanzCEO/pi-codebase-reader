/**
 * Tests for src/sherloc/connected-tree.ts
 *
 * Uses temp directories with mock source files. Since tree-sitter parsing
 * requires WASM grammars, the real import-graph building may not work in
 * test environments without them. Tests focus on:
 *   - formatFileConnectedTree / formatRepoConnectedTree formatting
 *   - File resolution logic (via the module's exported helpers)
 *   - Handling of edge cases in the graph builders
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

// ========================================================================
// Formatting tests (pure, no FS needed)
// ========================================================================

describe("formatFileConnectedTree", () => {
  it("reports no data for unknown file in empty graph", async () => {
    const { formatFileConnectedTree } = await import("./connected-tree.js");
    const graph = new Map();
    const result = formatFileConnectedTree(graph, "nonexistent.py", "/repo");
    assert.ok(result.includes("No import data"), "should indicate no data");
  });

  it("shows imports and reverse imports for a file", async () => {
    const { formatFileConnectedTree } = await import("./connected-tree.js");
    const graph = new Map([
      ["/repo/src/main.py", { filePath: "/repo/src/main.py", imports: ["/repo/src/utils.py"], importedBy: [] }],
      ["/repo/src/utils.py", { filePath: "/repo/src/utils.py", imports: [], importedBy: ["/repo/src/main.py"] }],
    ]);

    const result = formatFileConnectedTree(graph, "src/main.py", "/repo");
    assert.ok(result.includes("Connected tree for:"), "should have header");
    assert.ok(result.includes("src/main.py"), "should mention file");
    assert.ok(result.includes("Imports:"), "should have imports section");
    assert.ok(result.includes("src/utils.py"), "should show imported file");
    assert.ok(result.includes("Imported by: (none)"), "should show no reverse deps");
  });

  it("displays reverse imports", async () => {
    const { formatFileConnectedTree } = await import("./connected-tree.js");
    const graph = new Map([
      ["/repo/lib/helpers.py", { filePath: "/repo/lib/helpers.py", imports: [], importedBy: ["/repo/main.py", "/repo/test.py"] }],
      ["/repo/main.py", { filePath: "/repo/main.py", imports: ["/repo/lib/helpers.py"], importedBy: [] }],
      ["/repo/test.py", { filePath: "/repo/test.py", imports: ["/repo/lib/helpers.py"], importedBy: [] }],
    ]);

    const result = formatFileConnectedTree(graph, "lib/helpers.py", "/repo");
    assert.ok(result.includes("Imported by:"), "should have reverse section");
    assert.ok(result.includes("main.py"), "should show first importer");
    assert.ok(result.includes("test.py"), "should show second importer");
  });
});

describe("formatRepoConnectedTree", () => {
  it("shows overview for empty graph", async () => {
    const { formatRepoConnectedTree } = await import("./connected-tree.js");
    const graph = new Map();
    const result = formatRepoConnectedTree(graph, "/repo");
    assert.ok(result.includes("No import relationships"), "should indicate empty");
  });

  it("shows top imported files sorted by reverse-dep count", async () => {
    const { formatRepoConnectedTree } = await import("./connected-tree.js");
    const graph = new Map([
      ["/repo/utils.py", { filePath: "/repo/utils.py", imports: ["/repo/config.py"], importedBy: ["/repo/a.py", "/repo/b.py", "/repo/c.py"] }],
      ["/repo/config.py", { filePath: "/repo/config.py", imports: [], importedBy: ["/repo/utils.py", "/repo/main.py"] }],
      ["/repo/main.py", { filePath: "/repo/main.py", imports: ["/repo/utils.py", "/repo/config.py"], importedBy: [] }],
      ["/repo/a.py", { filePath: "/repo/a.py", imports: ["/repo/utils.py"], importedBy: [] }],
      ["/repo/b.py", { filePath: "/repo/b.py", imports: ["/repo/utils.py"], importedBy: [] }],
      ["/repo/c.py", { filePath: "/repo/c.py", imports: ["/repo/utils.py"], importedBy: [] }],
    ]);

    const result = formatRepoConnectedTree(graph, "/repo");
    assert.ok(result.includes("Repository import overview"), "should have header");
    assert.ok(result.includes("reverse-dependencies"), "should mention reverse deps");
    assert.ok(result.includes("utils.py"), "top imported file");
    assert.ok(result.includes("6"), "should show total count");
    assert.ok(result.includes("Total parseable files"), "should have total");
  });
});

// ========================================================================
// File collection helpers (via collectSourceFiles in temp dirs)
// ========================================================================

describe("collectSourceFiles (via buildImportGraph)", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sherloc-test-"));
    // Create source files with different extensions
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    mkdirSync(join(tmpDir, "node_modules", "some-lib"), { recursive: true });
    mkdirSync(join(tmpDir, ".git"), { recursive: true });

    writeFileSync(join(tmpDir, "src", "main.ts"), 'import { helper } from "./helper";\n');
    writeFileSync(join(tmpDir, "src", "helper.ts"), 'export function helper() { return 42; }\n');
    writeFileSync(join(tmpDir, "src", "utils.py"), "import os\nfrom .config import DB\n");
    writeFileSync(join(tmpDir, "README.md"), "# Project\n");
    writeFileSync(join(tmpDir, "node_modules", "some-lib", "index.js"), "module.exports = {};\n");
    writeFileSync(join(tmpDir, ".git", "config"), "[core]\n");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips node_modules and .git directories", async () => {
    const { buildImportGraph } = await import("./connected-tree.js");
    const graph = await buildImportGraph(tmpDir);

    // Should not include files under node_modules or .git
    for (const filePath of graph.keys()) {
      assert.ok(!filePath.includes("node_modules"), "should exclude node_modules");
      assert.ok(!filePath.includes(".git"), "should exclude .git");
    }
  });

  it("discovers supported source files", async () => {
    const { buildImportGraph } = await import("./connected-tree.js");
    const graph = await buildImportGraph(tmpDir);

    // Should find at least the .ts and .py files we created
    const foundTss = Array.from(graph.keys()).filter((p) => p.endsWith(".ts"));
    const foundPys = Array.from(graph.keys()).filter((p) => p.endsWith(".py"));
    assert.ok(foundTss.length >= 2, "should find .ts files");
    assert.ok(foundPys.length >= 1, "should find .py files");
  });
});

// ========================================================================
// Error handling
// ========================================================================

describe("buildImportGraph error handling", () => {
  it("handles non-existent directory gracefully", async () => {
    const { buildImportGraph } = await import("./connected-tree.js");
    const graph = await buildImportGraph("/nonexistent/path");
    assert.ok(graph instanceof Map, "should return a Map");
    assert.equal(graph.size, 0, "should be empty");
  });

  it("handles empty directory", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "sherloc-empty-"));
    try {
      const { buildImportGraph } = await import("./connected-tree.js");
      const graph = await buildImportGraph(tmpDir);
      assert.ok(graph instanceof Map, "should return a Map");
      assert.equal(graph.size, 0, "should be empty for empty directory");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
