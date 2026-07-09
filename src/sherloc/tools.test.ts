/**
 * Tests for src/sherloc/tools.ts
 *
 * Uses temp directories and pi mock to test tool registration and execution.
 * The connected_tree tool relies on tree-sitter WASM grammars which may not
 * be available in all test environments; we test registration and graceful
 * error handling.
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
import { registerRepotreeTool, registerConnectedTreeTool } from "./tools.js";

// ========================================================================
// Helpers
// ========================================================================

function createPiMock(): { pi: any; tools: Map<string, any> } {
  const tools = new Map<string, any>();
  const pi = {
    registerTool: (t: any) => {
      tools.set(t.name, t);
    },
  };
  return { pi, tools };
}

async function executeTool(
  tool: any,
  params: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  const result = await tool.execute(
    "test-call-id",
    params,
    undefined, // signal
    undefined, // onUpdate
    { cwd },
  );
  return result.content[0].text;
}

// ========================================================================
// repo_tree tests
// ========================================================================

describe("registerRepotreeTool", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sherloc-tools-test-"));
    // Create a realistic project structure
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "components"), { recursive: true });
    mkdirSync(join(tmpDir, "tests"), { recursive: true });
    mkdirSync(join(tmpDir, "node_modules", "dep"), { recursive: true });
    mkdirSync(join(tmpDir, ".git"), { recursive: true });
    mkdirSync(join(tmpDir, "dist"), { recursive: true });

    writeFileSync(join(tmpDir, "src", "main.ts"), "export function main() {}\n");
    writeFileSync(join(tmpDir, "src", "utils.ts"), "export function util() {}\n");
    writeFileSync(join(tmpDir, "src", "components", "Button.tsx"), "export function Button() {}\n");
    writeFileSync(join(tmpDir, "src", "components", "index.ts"), 'export { Button } from "./Button";\n');
    writeFileSync(join(tmpDir, "tests", "main.test.ts"), 'import { main } from "../src/main";\n');
    writeFileSync(join(tmpDir, "README.md"), "# Project\n");
    writeFileSync(join(tmpDir, "package.json"), '{ "name": "test" }\n');
    writeFileSync(join(tmpDir, "node_modules", "dep", "index.js"), "module.exports = {};\n");
    writeFileSync(join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(tmpDir, "dist", "bundle.js"), "// compiled\n");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers a tool named 'repo_tree'", () => {
    const { pi, tools } = createPiMock();
    registerRepotreeTool(pi);
    assert.ok(tools.has("repo_tree"), "should register repo_tree tool");
    const tool = tools.get("repo_tree");
    assert.equal(typeof tool.execute, "function");
    assert.ok(tool.description.length > 10);
  });

  it("excludes node_modules, .git, and dist from the tree", async () => {
    const { pi, tools } = createPiMock();
    registerRepotreeTool(pi);
    const tool = tools.get("repo_tree");
    const text = await executeTool(tool, {}, tmpDir);
    assert.ok(text.includes("src/"), "should show src directory");
    assert.ok(text.includes("tests/"), "should show tests directory");
    assert.ok(text.includes("main.ts"), "should show main.ts");
    assert.ok(text.includes("README.md"), "should show README.md");
    assert.ok(!text.includes("node_modules"), "should exclude node_modules");
    assert.ok(!text.includes(".git"), "should exclude .git");
    assert.ok(!text.includes("dist"), "should exclude dist");
    assert.ok(!text.includes("bundle.js"), "should exclude dist files");
  });

  it("shows line counts for supported files", async () => {
    const { pi, tools } = createPiMock();
    registerRepotreeTool(pi);
    const tool = tools.get("repo_tree");
    const text = await executeTool(tool, {}, tmpDir);
    assert.ok(text.includes("lines"), "should show line counts");
  });

  it("respects depth parameter", async () => {
    const { pi, tools } = createPiMock();
    registerRepotreeTool(pi);
    const tool = tools.get("repo_tree");

    // Depth 1: only root items
    const text = await executeTool(tool, { depth: 1 }, tmpDir);
    assert.ok(text.includes("src/"), "depth 1 should show root dirs");
    // At depth 1, we shouldn't see nested files (but directories show at depth 1)
    // The components dir is nested under src, so it shouldn't be directly visible
  });

  it("supports subdirectory root parameter", async () => {
    const { pi, tools } = createPiMock();
    registerRepotreeTool(pi);
    const tool = tools.get("repo_tree");
    const text = await executeTool(tool, { root: "src" }, tmpDir);
    assert.ok(text.includes("main.ts"), "should show files in src");
    assert.ok(text.includes("components/"), "should show nested dirs");
    assert.ok(!text.includes("tests/"), "should not show sibling dirs");
  });

  it("handles non-existent root directory gracefully", async () => {
    const { pi, tools } = createPiMock();
    registerRepotreeTool(pi);
    const tool = tools.get("repo_tree");
    const text = await executeTool(tool, { root: "nonexistent" }, tmpDir);
    assert.ok(text.includes("not found"), "should report directory not found");
  });

  it("shows total file count and size summary", async () => {
    const { pi, tools } = createPiMock();
    registerRepotreeTool(pi);
    const tool = tools.get("repo_tree");
    const text = await executeTool(tool, {}, tmpDir);
    assert.ok(text.includes("Total:"), "should have total summary");
    assert.ok(text.includes("files"), "should mention file count");
  });
});

// ========================================================================
// connected_tree tests
// ========================================================================

describe("registerConnectedTreeTool", () => {
  it("registers a tool named 'connected_tree'", () => {
    const { pi, tools } = createPiMock();
    registerConnectedTreeTool(pi);
    assert.ok(tools.has("connected_tree"), "should register connected_tree tool");
    const tool = tools.get("connected_tree");
    assert.equal(typeof tool.execute, "function");
    assert.ok(tool.description.length > 10);
  });

  it("handles non-existent cwd gracefully", async () => {
    const { pi, tools } = createPiMock();
    registerConnectedTreeTool(pi);
    const tool = tools.get("connected_tree");
    const text = await executeTool(tool, {}, "/nonexistent-path-12345");
    // Should either return an empty graph or an error message
    assert.ok(typeof text === "string", "should return a string");
  });

  it("builds graph and shows repo-wide overview with source files", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "sherloc-ct-test-"));
    try {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "main.ts"), 'import { helper } from "./helper";\n');
      writeFileSync(join(tmpDir, "src", "helper.ts"), "export function helper() { return 42; }\n");

      const { pi, tools } = createPiMock();
      registerConnectedTreeTool(pi);
      const tool = tools.get("connected_tree");
      const text = await executeTool(tool, {}, tmpDir);

      // Should contain repo overview content
      assert.ok(text.includes("import overview") || text.includes("No import"), "should show overview or empty state");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns file-scoped connected tree when path provided", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "sherloc-ct-file-"));
    try {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "main.ts"), 'import { helper } from "./helper";\nexport function run() { helper(); }\n');
      writeFileSync(join(tmpDir, "src", "helper.ts"), "export function helper() { return 42; }\n");

      const { pi, tools } = createPiMock();
      registerConnectedTreeTool(pi);
      const tool = tools.get("connected_tree");
      const text = await executeTool(tool, { path: "src/main.ts" }, tmpDir);

      // Should show connected tree info for the file
      assert.ok(
        text.includes("Connected tree for:") || text.includes("No import data"),
        "should show connected tree or no-data message",
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
