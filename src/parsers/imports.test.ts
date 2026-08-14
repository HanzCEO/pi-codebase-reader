/**
 * Tests for import extraction in parsers/index.ts
 *
 * Tests the extractFileImports function with synthetic source code snippets.
 * Tree-sitter WASM grammars must be available for these tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractFileImports } from "./index.js";

// ========================================================================
// JavaScript / TypeScript imports
// ========================================================================

describe("extractFileImports — JavaScript/TypeScript", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "import-test-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts named imports from ES module syntax", async () => {
    const code = 'import { foo, bar } from "./helpers";\n';
    const filePath = join(tmpDir, "test.ts");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1, "should find at least one import");
    const imp = imports[0];
    assert.equal(imp.source, "./helpers");
    assert.ok(imp.names.includes("foo"), "should include 'foo'");
    assert.ok(imp.names.includes("bar"), "should include 'bar'");
    assert.equal(imp.lineNumber, 1);
  });

  it("extracts default imports", async () => {
    const code = 'import React from "react";\n';
    const filePath = join(tmpDir, "test.tsx");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1);
    assert.equal(imports[0].source, "react");
  });

  it("extracts namespace imports", async () => {
    const code = 'import * as utils from "./utils";\n';
    const filePath = join(tmpDir, "test.ts");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1);
    assert.equal(imports[0].source, "./utils");
  });

  it("extracts require() calls", async () => {
    const code = 'const fs = require("fs");\n';
    const filePath = join(tmpDir, "test.js");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1);
    assert.equal(imports[0].source, "fs");
  });

  it("extracts re-exports (export ... from)", async () => {
    const code = 'export { helper } from "./helper";\n';
    const filePath = join(tmpDir, "test.ts");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1, "should extract re-export");
    assert.equal(imports[0].source, "./helper");
  });

  it("handles files with no imports", async () => {
    const code = "export const x = 42;\n";
    const filePath = join(tmpDir, "empty.ts");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.equal(imports.length, 0, "should return empty array");
  });
});

// ========================================================================
// Python imports
// ========================================================================

describe("extractFileImports — Python", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "import-py-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts simple import statements", async () => {
    const code = "import os\nimport sys\n";
    const filePath = join(tmpDir, "test.py");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 2, "should find both imports");
    const sources = imports.map((i) => i.source);
    assert.ok(sources.includes("os"), "should import os");
    assert.ok(sources.includes("sys"), "should import sys");
  });

  it("extracts from-import statements", async () => {
    const code = "from django.db import models\nfrom .config import (\n    DB,\n    CACHE,\n)\n";
    const filePath = join(tmpDir, "test.py");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    const sources = imports.map((i) => i.source);
    assert.ok(sources.includes("django.db"), "should find django.db");
    assert.ok(sources.includes(".config"), "should find relative import");
  });

  it("handles aliased imports", async () => {
    const code = "import numpy as np\n";
    const filePath = join(tmpDir, "test.py");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1);
    assert.equal(imports[0].source, "numpy");
  });
});

// ========================================================================
// Go imports
// ========================================================================

describe("extractFileImports — Go", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "import-go-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts single imports", async () => {
    const code = 'import "fmt"\n';
    const filePath = join(tmpDir, "main.go");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1);
    assert.equal(imports[0].source, "fmt");
  });

  it("extracts grouped imports", async () => {
    const code = 'import (\n\t"fmt"\n\t"os"\n)\n';
    const filePath = join(tmpDir, "main.go");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 2);
  });
});

// ========================================================================
// Rust imports
// ========================================================================

describe("extractFileImports — Rust", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "import-rs-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts use declarations", async () => {
    const code = "use std::collections::HashMap;\n";
    const filePath = join(tmpDir, "main.rs");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1);
    assert.ok(imports[0].source.includes("std::collections::HashMap"), "should extract module path");
  });
});

// ========================================================================
// Solidity imports
// ========================================================================

describe("extractFileImports — Solidity", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "import-sol-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts simple imports", async () => {
    const code = 'import "./Ownable.sol";\n';
    const filePath = join(tmpDir, "MyContract.sol");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.ok(imports.length >= 1);
    assert.equal(imports[0].source, "./Ownable.sol");
  });
});

// ========================================================================
// SCSS imports
// ========================================================================

describe("extractFileImports — SCSS", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "import-scss-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts @use, @forward, and @import statements", async () => {
    const code = [
      '@use "buttons";',
      '@use "sass:math" as math;',
      '@forward "config";',
      '@import "theme";',
      "",
      "$primary: #333;",
      ".btn { color: $primary; }",
    ].join("\n");
    const filePath = join(tmpDir, "styles.scss");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    const sources = imports.map((i) => i.source);

    assert.ok(
      sources.includes("buttons"),
      `expected @use buttons, got: ${sources.join(", ")}`,
    );
    assert.ok(
      sources.includes("sass:math"),
      `expected @use sass:math (alias case), got: ${sources.join(", ")}`,
    );
    assert.ok(
      sources.includes("config"),
      `expected @forward config, got: ${sources.join(", ")}`,
    );
    assert.ok(
      sources.includes("theme"),
      `expected @import theme, got: ${sources.join(", ")}`,
    );
  });

  it("extracts .sass files with the indented-syntax grammar", async () => {
    const code = [
      '@use "_variables"',
      "",
      "$color: blue",
      "",
      ".foo",
      "  color: $color",
    ].join("\n");
    const filePath = join(tmpDir, "index.sass");
    // .sass uses indentation syntax (no braces/semicolons); the dedicated
    // indented-syntax grammar handles the @use directive.
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    const sources = imports.map((i) => i.source);
    assert.ok(
      sources.includes("_variables"),
      `expected @use _variables, got: ${sources.join(", ")}`,
    );
  });

  it("reports line numbers of import statements", async () => {
    const code = [
      "// comment",
      '@use "grid";',
      '@import "reset";',
    ].join("\n");
    const filePath = join(tmpDir, "lines.scss");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    const grid = imports.find((i) => i.source === "grid");
    assert.ok(grid, "@use grid missing");
    assert.equal(grid!.lineNumber, 2);
    const reset = imports.find((i) => i.source === "reset");
    assert.ok(reset, "@import reset missing");
    assert.equal(reset!.lineNumber, 3);
  });
});

// ========================================================================
// Unsupported languages
// ========================================================================

describe("extractFileImports — unsupported languages", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "import-unsup-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for unsupported file extension", async () => {
    const code = '#include <stdio.h>\n';
    const filePath = join(tmpDir, "main.c");
    writeFileSync(filePath, code, "utf-8");

    const imports = await extractFileImports(filePath, code);
    assert.deepEqual(imports, [], "should return empty for unsupported language");
  });

  it("returns empty array for non-existent file", async () => {
    const imports = await extractFileImports("/nonexistent/file.xyz", "");
    assert.deepEqual(imports, []);
  });
});
