/**
 * Truth tests for Markdown parsing.
 *
 * These tests define the EXPECTED behavior of the markdown parser.
 * The code must satisfy these tests - not the other way around.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCode, parseFileImports } from "./manager.js";
import type { SymbolInfo } from "../types.js";

/** Sample Markdown document with various structures. */
const SAMPLE_MARKDOWN = [
  "# Main Title",
  "",
  "This is a paragraph with a [link](./other.md) to another file.",
  "",
  "## Section One",
  "",
  "Some content here.",
  "",
  "### Subsection 1.1",
  "",
  "More detailed content.",
  "",
  "### Subsection 1.2",
  "",
  "Even more content.",
  "",
  "## Section Two",
  "",
  "Content in section two.",
  "",
  "```javascript",
  "const x = 42;",
  "```",
  "",
  "## Images",
  "",
  "Here's an image: ![diagram](./images/diagram.png)",
  "",
  "## External Links",
  "",
  "Check out [GitHub](https://github.com) for more info.",
].join("\n");

describe("Markdown parser — heading extraction", () => {
  it("extracts h1 headings as top-level symbols", async () => {
    const symbols = await parseCode("markdown", SAMPLE_MARKDOWN);
    assert.equal(symbols.length, 1, "Should have exactly one top-level symbol (h1)");
    assert.equal(symbols[0].name, "Main Title", "Top-level symbol should be 'Main Title'");
    assert.equal(symbols[0].type, "heading1", "Type should be 'heading1'");
  });

  it("nests h2 headings under h1", async () => {
    const symbols = await parseCode("markdown", SAMPLE_MARKDOWN);
    const mainTitle = symbols[0];

    assert.ok(mainTitle.children, "Main Title should have children");
    assert.equal(mainTitle.children!.length, 4, "Main Title should have 4 children (4 h2 sections)");

    const childNames = mainTitle.children!.map((c) => c.name);
    assert.deepEqual(
      childNames,
      ["Section One", "Section Two", "Images", "External Links"],
      "h2 sections should be children of h1 in order",
    );
  });

  it("assigns correct type and detail for each heading level", async () => {
    const symbols = await parseCode("markdown", SAMPLE_MARKDOWN);
    const mainTitle = symbols[0];

    assert.equal(mainTitle.type, "heading1");
    assert.equal(mainTitle.detail, "#");

    const sectionOne = mainTitle.children![0];
    assert.equal(sectionOne.type, "heading2");
    assert.equal(sectionOne.detail, "##");
  });

  it("nests h3 headings under h2", async () => {
    const symbols = await parseCode("markdown", SAMPLE_MARKDOWN);
    const sectionOne = symbols[0].children![0];

    assert.equal(sectionOne.name, "Section One");
    assert.ok(sectionOne.children, "Section One should have children");
    assert.equal(sectionOne.children!.length, 2, "Section One should have 2 h3 children");

    const childNames = sectionOne.children!.map((c) => c.name);
    assert.deepEqual(childNames, ["Subsection 1.1", "Subsection 1.2"]);
  });

  it("returns correct line numbers", async () => {
    const symbols = await parseCode("markdown", SAMPLE_MARKDOWN);
    const mainTitle = symbols[0];

    assert.equal(mainTitle.startLine, 1, "Main Title starts at line 1");
    assert.equal(mainTitle.endLine, 31, "Main Title ends at last line");
  });
});

describe("Markdown parser — code blocks", () => {
  it("extracts code blocks as symbols", async () => {
    const symbols = await parseCode("markdown", SAMPLE_MARKDOWN);
    const mainTitle = symbols[0];

    // Code blocks should be nested under the heading (find them recursively)
    const codeBlocks = findSymbolsByType([mainTitle], "code_block");
    assert.equal(codeBlocks.length, 1, "Should find one code block");
    assert.equal(codeBlocks[0].detail, "javascript", "Code block language should be 'javascript'");
  });
});

describe("Markdown parser — edge cases", () => {
  it("returns empty array for empty document", async () => {
    const symbols = await parseCode("markdown", "");
    assert.deepEqual(symbols, []);
  });

  it("returns empty array for document with no headings", async () => {
    const symbols = await parseCode("markdown", "Just some text\nwith no headings");
    assert.deepEqual(symbols, []);
  });

  it("rejects headings without space after #", async () => {
    const symbols = await parseCode("markdown", "#NoSpace\n\n##AlsoNoSpace");
    assert.deepEqual(symbols, [], "Headings without space should not be parsed");
  });

  it("handles deeply nested headings (h1 through h6)", async () => {
    const deepMarkdown = [
      "# Level 1",
      "## Level 2",
      "### Level 3",
      "#### Level 4",
      "##### Level 5",
      "###### Level 6",
    ].join("\n");

    const symbols = await parseCode("markdown", deepMarkdown);
    assert.equal(symbols.length, 1, "One top-level h1");

    // Navigate the chain: h1 -> h2 -> h3 -> h4 -> h5 -> h6
    let current = symbols[0];
    for (let level = 2; level <= 6; level++) {
      assert.ok(current.children, `Level ${level - 1} should have children`);
      assert.equal(current.children!.length, 1, `Level ${level - 1} should have one child`);
      current = current.children![0];
      assert.equal(current.name, `Level ${level}`);
      assert.equal(current.type, `heading${level}`);
    }
  });
});

describe("Markdown link extraction", () => {
  it("extracts local file links as imports", async () => {
    const imports = await parseFileImports("markdown", SAMPLE_MARKDOWN);

    const localLinks = imports.filter((i) => !i.source.startsWith("http"));
    assert.ok(localLinks.length > 0, "Should find local links");

    const otherMdLink = localLinks.find((i) => i.source === "./other.md");
    assert.ok(otherMdLink, "Should find link to ./other.md");
    assert.deepEqual(otherMdLink!.names, ["link"]);
  });

  it("extracts image references as imports", async () => {
    const imports = await parseFileImports("markdown", SAMPLE_MARKDOWN);

    const imageLink = imports.find((i) => i.source === "./images/diagram.png");
    assert.ok(imageLink, "Should find image reference");
    assert.deepEqual(imageLink!.names, ["diagram"]);
  });

  it("excludes external URLs", async () => {
    const imports = await parseFileImports("markdown", SAMPLE_MARKDOWN);

    const externalLinks = imports.filter((i) => i.source.startsWith("http"));
    assert.equal(externalLinks.length, 0, "External URLs should not be imports");
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

/** Find all symbols of a given type anywhere in the hierarchy. */
function findSymbolsByType(symbols: SymbolInfo[], type: string): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  for (const s of symbols) {
    if (s.type === type) results.push(s);
    if (s.children) results.push(...findSymbolsByType(s.children, type));
  }
  return results;
}
