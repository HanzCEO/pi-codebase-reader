/**
 * Integration tests for Sass (indented syntax) parsing via the vendored
 * tree-sitter-sass grammar (bajrangCoder/tree-sitter-sass).
 *
 * Verifies that parseCode extracts the correct symbol hierarchy from .sass
 * files (whitespace-significant syntax) and that parseFileImports recovers
 * @use/@forward/@import module paths.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { parseCode, parseFileImports } from "./manager.js";
import type { SymbolInfo } from "../types.js";

/** Sample indented-syntax Sass exercising the major constructs. */
const SAMPLE_SASS = `@use "tokens"
@forward "config"
@import "theme"

$primary: #333
$spacing: 4px !default

@mixin flex-center
  display: flex
  align-items: center

@mixin themed($map, $key)
  color: map.get($map, $key)

@function double($n)
  @return $n * 2

%placeholder
  margin: 0

.btn
  color: $primary
  @include flex-center

  &:hover
    color: red

.foo
  @extend %placeholder

@media (min-width: 768px)
  .sidebar
    width: 200px

@keyframes slide
  from
    opacity: 0
  to
    opacity: 1
`;

/** Run parseCode and return top-level symbols keyed by name for assertions. */
function indexByName(symbols: SymbolInfo[]): Map<string, SymbolInfo> {
  const map = new Map<string, SymbolInfo>();
  for (const s of symbols) {
    map.set(s.name, s);
  }
  return map;
}

describe("Sass (indented syntax) parser integration", () => {
  let symbols: SymbolInfo[];

  before(async () => {
    symbols = await parseCode("sass", SAMPLE_SASS);
  });

  it("extracts top-level variables", () => {
    const byName = indexByName(symbols);
    assert.ok(byName.has("$primary"), "variable $primary not found");
    assert.ok(byName.has("$spacing"), "variable $spacing not found");
    assert.equal(byName.get("$primary")?.type, "variable");
    // !default must not break the declaration symbol.
    assert.equal(byName.get("$spacing")?.type, "variable");
  });

  it("extracts mixins with parameter detail", () => {
    const byName = indexByName(symbols);
    const flex = byName.get("flex-center");
    assert.ok(flex, "mixin flex-center not found");
    assert.equal(flex!.type, "mixin");

    const themed = byName.get("themed");
    assert.ok(themed, "mixin themed not found");
    assert.equal(themed!.type, "mixin");
    assert.ok(
      themed!.detail === "($map, $key)",
      `expected mixin params, got: ${themed!.detail}`,
    );
  });

  it("extracts functions with parameter detail", () => {
    const byName = indexByName(symbols);
    const double = byName.get("double");
    assert.ok(double, "function double not found");
    assert.equal(double!.type, "function");
    assert.ok(
      double!.detail === "($n)",
      `expected function params, got: ${double!.detail}`,
    );
  });

  it("types placeholder selectors as placeholder and rulesets as ruleset", () => {
    const byName = indexByName(symbols);
    const placeholder = byName.get("%placeholder");
    assert.ok(placeholder, "placeholder %placeholder not found");
    assert.equal(placeholder!.type, "placeholder");

    const btn = byName.get(".btn");
    assert.ok(btn, "ruleset .btn not found");
    assert.equal(btn!.type, "ruleset");
  });

  it("extracts nested children of rule sets (includes + nested rules)", () => {
    const btn = indexByName(symbols).get(".btn")!;
    assert.ok(btn.children, ".btn should have children");
    const childNames = btn.children!.map((c) => c.name);

    assert.ok(
      childNames.includes("@include flex-center"),
      `missing @include, got: ${childNames.join(", ")}`,
    );
    assert.ok(
      childNames.includes("&:hover"),
      `missing nested &:hover, got: ${childNames.join(", ")}`,
    );

    const include = btn.children!.find((c) => c.name === "@include flex-center")!;
    assert.equal(include.type, "include");
    const nested = btn.children!.find((c) => c.name === "&:hover")!;
    assert.equal(nested.type, "ruleset");
  });

  it("extracts @extend %placeholder", () => {
    const foo = indexByName(symbols).get(".foo")!;
    assert.ok(foo.children, ".foo should have children");
    const extend = foo.children!.find((c) => c.name === "@extend %placeholder");
    assert.ok(extend, "@extend %placeholder not found");
    assert.equal(extend!.type, "extend");
  });

  it("extracts @media as an at-rule container with nested rules", () => {
    const media = symbols.find((s) => s.type === "at-rule");
    assert.ok(media, "@media at-rule not found");
    assert.ok(
      media!.name.startsWith("@media"),
      `expected name to start with @media, got: ${media!.name}`,
    );
    assert.ok(media!.children, "@media should have children");
    assert.ok(
      media!.children!.some((c) => c.name === ".sidebar" && c.type === "ruleset"),
      "@media should contain nested .sidebar ruleset",
    );
  });

  it("extracts @keyframes with step children", () => {
    const kf = symbols.find((s) => s.type === "keyframes");
    assert.ok(kf, "@keyframes not found");
    assert.ok(kf!.name.startsWith("@keyframes"), `got: ${kf!.name}`);
    assert.ok(kf!.children, "@keyframes should have children");
    const steps = kf!.children!.map((c) => c.name);
    assert.ok(steps.includes("from"), `missing from step, got: ${steps.join(", ")}`);
    assert.ok(steps.includes("to"), `missing to step, got: ${steps.join(", ")}`);
  });
});

describe("Sass import extraction", () => {
  it("extracts @use, @forward, @import paths from the indented dialect", async () => {
    const imports = await parseFileImports("sass", SAMPLE_SASS);
    const sources = imports.map((i) => i.source);

    assert.ok(sources.includes("tokens"), `missing @use tokens, got: ${sources}`);
    assert.ok(sources.includes("config"), `missing @forward config, got: ${sources}`);
    assert.ok(sources.includes("theme"), `missing @import theme, got: ${sources}`);
  });

  it("reports line numbers of import statements", async () => {
    const imports = await parseFileImports("sass", SAMPLE_SASS);
    const use = imports.find((i) => i.source === "tokens");
    assert.ok(use, "tokens import missing");
    assert.equal(use!.lineNumber, 1);
  });
});
