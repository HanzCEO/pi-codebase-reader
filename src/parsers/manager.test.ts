/**
 * Tests for src/parsers/manager.ts
 *
 * Tests for detectLanguage and languageLabel — pure function tests.
 * The tree-sitter parseCode / extractSymbols functions require WASM
 * grammar files and are tested via integration tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, languageLabel } from "./manager.js";

// ========================================================================
// detectLanguage
// ========================================================================

describe("detectLanguage", () => {
  // ── JavaScript variants ───────────────────────────────────────────

  it("detects JavaScript for .js files", () => {
    assert.equal(detectLanguage("file.js"), "javascript");
  });

  it("detects JavaScript for .mjs files (ES modules)", () => {
    assert.equal(detectLanguage("file.mjs"), "javascript");
  });

  it("detects JavaScript for .cjs files (CommonJS)", () => {
    assert.equal(detectLanguage("file.cjs"), "javascript");
  });

  it("detects JavaScript for .jsx files (React JSX)", () => {
    assert.equal(detectLanguage("component.jsx"), "javascript");
  });

  // ── TypeScript variants ───────────────────────────────────────────

  it("detects TypeScript for .ts files", () => {
    assert.equal(detectLanguage("file.ts"), "typescript");
  });

  it("detects TypeScript for .mts files", () => {
    assert.equal(detectLanguage("file.mts"), "typescript");
  });

  it("detects TypeScript for .cts files", () => {
    assert.equal(detectLanguage("file.cts"), "typescript");
  });

  it("detects TSX for .tsx files", () => {
    assert.equal(detectLanguage("component.tsx"), "tsx");
  });

  // ── Other supported languages ─────────────────────────────────────

  it("detects Python for .py files", () => {
    assert.equal(detectLanguage("script.py"), "python");
  });

  it("detects Go for .go files", () => {
    assert.equal(detectLanguage("main.go"), "go");
  });

  it("detects Rust for .rs files", () => {
    assert.equal(detectLanguage("lib.rs"), "rust");
  });

  it("detects Solidity for .sol files", () => {
    assert.equal(detectLanguage("contract.sol"), "solidity");
  });

  // ── Case insensitivity ────────────────────────────────────────────

  it("detects case-insensitively for uppercase extensions", () => {
    assert.equal(detectLanguage("FILE.TS"), "typescript");
    assert.equal(detectLanguage("Script.PY"), "python");
    assert.equal(detectLanguage("Main.GO"), "go");
    assert.equal(detectLanguage("Lib.RS"), "rust");
    assert.equal(detectLanguage("Contract.SOL"), "solidity");
  });

  it("detects case-insensitively for mixed-case extensions", () => {
    assert.equal(detectLanguage("Component.Tsx"), "tsx");
    assert.equal(detectLanguage("file.Js"), "javascript");
  });

  // ── Markdown ────────────────────────────────────────────────────────

  it("detects markdown for .md files", () => {
    assert.equal(detectLanguage("README.md"), "markdown");
  });

  it("detects markdown for .markdown files", () => {
    assert.equal(detectLanguage("docs.markdown"), "markdown");
  });

  // ── Unknown / unsupported ─────────────────────────────────────────

  it("returns null for CSS files", () => {
    assert.equal(detectLanguage("styles.css"), null);
  });

  it("returns null for HTML files", () => {
    assert.equal(detectLanguage("index.html"), null);
  });

  it("returns null for JSON files", () => {
    assert.equal(detectLanguage("package.json"), null);
  });

  it("returns null for files without extensions", () => {
    assert.equal(detectLanguage("Makefile"), null);
    assert.equal(detectLanguage("docker-compose"), null);
  });

  it("returns null for YAML files", () => {
    assert.equal(detectLanguage("config.yaml"), null);
    assert.equal(detectLanguage("config.yml"), null);
  });

  // ── Paths with directory components ───────────────────────────────

  it("detects language in deeply nested paths", () => {
    assert.equal(
      detectLanguage("/home/user/project/src/main.ts"),
      "typescript",
    );
    assert.equal(
      detectLanguage("src/utils/helper.js"),
      "javascript",
    );
    assert.equal(
      detectLanguage("app/services/handler.py"),
      "python",
    );
  });

  it("detects language in paths with multiple dots", () => {
    assert.equal(detectLanguage("some.test.file.ts"), "typescript");
    assert.equal(detectLanguage("component.spec.tsx"), "tsx");
    assert.equal(detectLanguage("my.module.test.js"), "javascript");
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  it("returns null for empty file path", () => {
    assert.equal(detectLanguage(""), null);
  });

  it("returns null for paths ending with a dot", () => {
    assert.equal(detectLanguage("file."), null);
    assert.equal(detectLanguage("dir/file."), null);
  });

  it("detects language for paths that are only an extension", () => {
    // ".ts" ends with ".ts" → matches typescript
    assert.equal(detectLanguage(".ts"), "typescript");
    assert.equal(detectLanguage(".py"), "python");
  });
});

// ========================================================================
// languageLabel
// ========================================================================

describe("languageLabel", () => {
  it("returns 'JavaScript' for 'javascript' key", () => {
    assert.equal(languageLabel("javascript"), "JavaScript");
  });

  it("returns 'TypeScript' for 'typescript' key", () => {
    assert.equal(languageLabel("typescript"), "TypeScript");
  });

  it("returns 'TSX' for 'tsx' key", () => {
    assert.equal(languageLabel("tsx"), "TSX");
  });

  it("returns 'Python' for 'python' key", () => {
    assert.equal(languageLabel("python"), "Python");
  });

  it("returns 'Go' for 'go' key", () => {
    assert.equal(languageLabel("go"), "Go");
  });

  it("returns 'Rust' for 'rust' key", () => {
    assert.equal(languageLabel("rust"), "Rust");
  });

  it("returns 'Solidity' for 'solidity' key", () => {
    assert.equal(languageLabel("solidity"), "Solidity");
  });

  it("returns the key itself for unknown keys", () => {
    assert.equal(languageLabel("unknown"), "unknown");
    assert.equal(languageLabel("csharp"), "csharp");
  });

  it("returns the key itself for empty string", () => {
    assert.equal(languageLabel(""), "");
  });
});
