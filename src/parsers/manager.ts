/**
 * Tree-sitter parser manager.
 *
 * Lazily initializes the WASM runtime and loads language grammars on demand.
 * All parsers share a single Parser instance, re-configured per language.
 */

import { createRequire } from "node:module";
import { Parser, Language, type Node } from "web-tree-sitter";
import type { SymbolInfo, ImportInfo } from "../types.js";
import { extractSmali, extractSmaliImports } from "./smali.js";
import { extractJava, extractJavaImports } from "./java.js";

// ---- WASM path resolution ----

const _require = createRequire(import.meta.url);

/** Known language grammars with their npm package + WASM file name. */
const GRAMMAR_REGISTRY: Record<
  string,
  { package: string; wasm: string; label: string }
> = {
  javascript: {
    package: "tree-sitter-javascript",
    wasm: "tree-sitter-javascript.wasm",
    label: "JavaScript",
  },
  typescript: {
    package: "tree-sitter-typescript",
    wasm: "tree-sitter-typescript.wasm",
    label: "TypeScript",
  },
  tsx: {
    package: "tree-sitter-typescript",
    wasm: "tree-sitter-tsx.wasm",
    label: "TSX",
  },
  python: {
    package: "tree-sitter-python",
    wasm: "tree-sitter-python.wasm",
    label: "Python",
  },
  go: {
    package: "tree-sitter-go",
    wasm: "tree-sitter-go.wasm",
    label: "Go",
  },
  rust: {
    package: "tree-sitter-rust",
    wasm: "tree-sitter-rust.wasm",
    label: "Rust",
  },
  solidity: {
    package: "tree-sitter-solidity",
    wasm: "tree-sitter-solidity.wasm",
    label: "Solidity",
  },
  smali: {
    package: "tree-sitter-smali",
    wasm: "tree-sitter-smali.wasm",
    label: "Smali",
  },
  java: {
    package: "tree-sitter-java",
    wasm: "tree-sitter-java.wasm",
    label: "Java",
  },
  markdown: {
    package: "markdown",
    wasm: "markdown.wasm",
    label: "Markdown",
  },
};

/** Map file extensions to grammar keys. */
const EXTENSION_MAP: Record<string, string> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".sol": "solidity",
  ".smali": "smali",
  ".java": "java",
  ".md": "markdown",
  ".markdown": "markdown",
};

// ---- Singleton state ----

let initialized = false;
const loadedLanguages = new Map<string, Language>();
let sharedParser: Parser | null = null;

/** Initialize the WASM runtime (once). */
async function ensureInit(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  initialized = true;
  sharedParser = new Parser();
}

/** Load a language grammar by key (cached). */
async function loadLanguage(key: string): Promise<Language> {
  const cached = loadedLanguages.get(key);
  if (cached) return cached;

  const entry = GRAMMAR_REGISTRY[key];
  if (!entry) throw new Error(`Unknown grammar: ${key}`);

  let wasmPath: string;
  try {
    wasmPath = _require.resolve(`${entry.package}/${entry.wasm}`);
  } catch {
    throw new Error(
      `Cannot resolve WASM for "${entry.label}": ${entry.package}/${entry.wasm} not found. ` +
        `Is ${entry.package} installed?`,
    );
  }

  const lang = await Language.load(wasmPath);
  loadedLanguages.set(key, lang);
  return lang;
}

// ---- Public API ----

/** Detect grammar key from a file path's extension. */
export function detectLanguage(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  for (const [ext, key] of Object.entries(EXTENSION_MAP)) {
    if (lower.endsWith(ext)) return key;
  }
  return null;
}

/** Get a human-readable label for a grammar key. */
export function languageLabel(key: string): string {
  return GRAMMAR_REGISTRY[key]?.label ?? key;
}

/** Parse source code with a given grammar, returning SymbolInfo[]. */
export async function parseCode(
  key: string,
  source: string,
): Promise<SymbolInfo[]> {
  // Markdown uses regex-based parsing, not tree-sitter
  if (key === "markdown") {
    return extractMarkdown(source);
  }

  await ensureInit();

  const lang = await loadLanguage(key);
  if (!sharedParser) throw new Error("Parser not initialized");

  sharedParser.setLanguage(lang);
  const tree = sharedParser.parse(source);
  if (!tree) return [];

  return extractSymbols(key, tree.rootNode, source, 0);
}

// ---- Symbol extraction dispatch ----

function extractSymbols(
  key: string,
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  switch (key) {
    case "javascript":
    case "typescript":
    case "tsx":
      return extractJavaScriptLike(node, source, depth);
    case "python":
      return extractPython(node, source, depth);
    case "go":
      return extractGo(node, source, depth);
    case "rust":
      return extractRust(node, source, depth);
    case "solidity":
      return extractSolidity(node, source, depth);
    case "smali":
      return extractSmali(node, source, depth);
    case "java":
      return extractJava(node, source, depth);
    case "markdown":
      return extractMarkdown(source);
    default:
      return [];
  }
}

// ---- Generic helpers ----

/** Get the text of the first named child matching a type. */
function childText(
  node: Node,
  childType: string,
  source: string,
): string | undefined {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === childType) {
      return source.slice(c.startIndex, c.endIndex);
    }
  }
  return undefined;
}

/** Get the first field child's text (field-name-based access). */
function fieldChildText(
  node: Node,
  fieldName: string,
  source: string,
): string | undefined {
  const c = node.childForFieldName(fieldName);
  return c ? source.slice(c.startIndex, c.endIndex) : undefined;
}

// ---- Node line ranges (0-indexed → 1-indexed) ----

function nodeRange(node: Node): [number, number] {
  return [node.startPosition.row + 1, node.endPosition.row + 1];
}

// ========================================================================
// JavaScript / TypeScript / TSX
// ========================================================================

function extractJavaScriptLike(
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const MAX_DEPTH = depth + 10; // track overall depth via recursion param

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    const symbol = extractJSChild(child, source);
    if (!symbol) continue;

    // For class/interface/enum, look inside their bodies
    if (
      symbol.type === "class" ||
      symbol.type === "interface" ||
      symbol.type === "enum"
    ) {
      const bodyNode = findChildByType(child, [
        "class_body",
        "interface_body",
        "enum_body",
        "object_type",
      ]);
      if (bodyNode && depth < MAX_DEPTH) {
        symbol.children = extractJavaScriptLike(bodyNode, source, depth + 1);
      }
    }

    results.push(symbol);
  }

  return results;
}

const JS_SYMBOL_TYPES: Record<string, string> = {
  function_declaration: "function",
  method_definition: "method",
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
  type_alias_declaration: "type",
  abstract_class_declaration: "class",
  lexical_declaration: "variable",
  variable_declaration: "variable",
};

function extractJSChild(
  child: Node,
  source: string,
): SymbolInfo | null {
  const type = child.type;

  // Arrow function assigned to const
  if (
    type === "lexical_declaration" ||
    type === "variable_declaration"
  ) {
    const declarators: SymbolInfo[] = [];
    for (let j = 0; j < child.namedChildCount; j++) {
      const d = child.namedChild(j);
      if (!d || d.type !== "variable_declarator") continue;
      const name = fieldChildText(d, "name", source);
      if (!name) continue;
      const value = d.childForFieldName("value");
      if (value && (value.type === "arrow_function" || value.type === "function")) {
        const [sl, el] = nodeRange(d);
        declarators.push({
          name,
          type: value.type === "arrow_function" ? "arrow_function" : "function",
          startLine: sl,
          endLine: el,
          detail: extractFnDetail(value, source),
        });
      }
    }
    if (declarators.length === 1) return declarators[0];
    if (declarators.length > 1) {
      return {
        name: "",
        type: "variable",
        startLine: declarators[0].startLine,
        endLine: declarators[declarators.length - 1].endLine,
        children: declarators,
      };
    }
    return null;
  }

  // Export statement — unwrap
  if (type === "export_statement") {
    for (let j = 0; j < child.namedChildCount; j++) {
      const inner = child.namedChild(j);
      if (inner) {
        const result = extractJSChild(inner, source);
        if (result) return result;
      }
    }
    return null;
  }

  const symbolType = JS_SYMBOL_TYPES[type];
  if (!symbolType) return null;

  const name =
    fieldChildText(child, "name", source) ||
    childText(child, "property_identifier", source) ||
    childText(child, "type_identifier", source) ||
    "<anonymous>";

  const [sl, el] = nodeRange(child);

  // For functions/methods, try to get the parameters as detail
  let detail: string | undefined;
  if (type === "function_declaration" || type === "method_definition") {
    detail = extractFnDetail(child, source);
  }

  return { name, type: symbolType, startLine: sl, endLine: el, detail };
}

function extractFnDetail(
  node: Node,
  source: string,
): string | undefined {
  const params = node.childForFieldName("parameters");
  if (params) {
    return source.slice(params.startIndex, params.endIndex);
  }
  return undefined;
}

function findChildByType(
  node: Node,
  types: string[],
): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && types.includes(c.type)) return c;
  }
  return null;
}

// ========================================================================
// Python
// ========================================================================

function extractPython(
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const MAX_DEPTH = depth + 10;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    let symbol: SymbolInfo | null = null;

    if (child.type === "class_definition") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "class", startLine: sl, endLine: el };

      // Recurse into body for methods
      const body = child.childForFieldName("body");
      if (body && depth < MAX_DEPTH) {
        symbol.children = extractPython(body, source, depth + 1);
      }
    } else if (child.type === "function_definition") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      const params = child.childForFieldName("parameters");
      const detail = params
        ? source.slice(params.startIndex, params.endIndex)
        : undefined;
      symbol = { name, type: "function", startLine: sl, endLine: el, detail };
    } else if (child.type === "decorated_definition") {
      // Unwrap to the inner definition
      const def = child.namedChild(child.namedChildCount - 1);
      if (def) {
        const inner = extractPythonSingle(def, source);
        if (inner) {
          inner.type = "decorated_" + inner.type;
          symbol = inner;
        }
      }
    }

    if (symbol) results.push(symbol);
  }

  return results;
}

function extractPythonSingle(
  child: Node,
  source: string,
): SymbolInfo | null {
  if (child.type === "class_definition") {
    const name = fieldChildText(child, "name", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    return { name, type: "class", startLine: sl, endLine: el };
  }
  if (child.type === "function_definition") {
    const name = fieldChildText(child, "name", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    const params = child.childForFieldName("parameters");
    const detail = params
      ? source.slice(params.startIndex, params.endIndex)
      : undefined;
    return { name, type: "function", startLine: sl, endLine: el, detail };
  }
  return null;
}

// ========================================================================
// Go
// ========================================================================

function extractGo(
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const MAX_DEPTH = depth + 10;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    let symbol: SymbolInfo | null = null;

    if (child.type === "function_declaration") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "function", startLine: sl, endLine: el };
    } else if (child.type === "method_declaration") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const receiver = child.childForFieldName("receiver");
      const receiverText = receiver
        ? source.slice(receiver.startIndex, receiver.endIndex)
        : "";
      const [sl, el] = nodeRange(child);
      const fullName = receiverText ? `${receiverText}).${name}` : name;
      symbol = { name: fullName, type: "method", startLine: sl, endLine: el };
    } else if (child.type === "type_declaration") {
      // type_declaration wraps type_spec nodes
      const specs: SymbolInfo[] = [];
      for (let j = 0; j < child.namedChildCount; j++) {
        const spec = child.namedChild(j);
        if (!spec || spec.type !== "type_spec") continue;
        const name = fieldChildText(spec, "name", source) || "<anonymous>";
        const [sl, el] = nodeRange(spec);
        const typeNode = spec.childForFieldName("type");
        const kind = typeNode?.type === "struct_type"
          ? "struct"
          : typeNode?.type === "interface_type"
            ? "interface"
            : "type";
        const entry: SymbolInfo = { name, type: kind, startLine: sl, endLine: el };

        // Recurse into struct/interface body
        if (typeNode && depth < MAX_DEPTH) {
          const body = findChildByType(typeNode, [
            "field_declaration_list",
          ]);
          if (body) {
            entry.children = extractGoFields(body, source);
          }
        }

        specs.push(entry);
      }
      if (specs.length === 1) {
        symbol = specs[0];
      } else if (specs.length > 1) {
        symbol = {
          name: "",
          type: "type",
          startLine: specs[0].startLine,
          endLine: specs[specs.length - 1].endLine,
          children: specs,
        };
      }
      if (symbol) results.push(symbol);
      continue;
    } else if (child.type === "const_declaration") {
      const [sl, el] = nodeRange(child);
      const names: string[] = [];
      for (let j = 0; j < child.namedChildCount; j++) {
        const spec = child.namedChild(j);
        if (spec && spec.type === "const_spec") {
          const n = fieldChildText(spec, "name", source);
          if (n) names.push(n);
        }
      }
      symbol = {
        name: names.join(", ") || "const",
        type: "const",
        startLine: sl,
        endLine: el,
      };
    } else if (child.type === "var_declaration") {
      const [sl, el] = nodeRange(child);
      const names: string[] = [];
      for (let j = 0; j < child.namedChildCount; j++) {
        const spec = child.namedChild(j);
        if (spec && spec.type === "var_spec") {
          const n = fieldChildText(spec, "name", source);
          if (n) names.push(n);
        }
      }
      symbol = {
        name: names.join(", ") || "var",
        type: "var",
        startLine: sl,
        endLine: el,
      };
    }

    if (symbol) results.push(symbol);
  }

  return results;
}

function extractGoFields(
  node: Node,
  source: string,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child || child.type !== "field_declaration") continue;

    const name = fieldChildText(child, "name", source);
    if (!name) continue;
    const [sl, el] = nodeRange(child);
    const typeNode = child.childForFieldName("type");
    const typeText = typeNode
      ? source.slice(typeNode.startIndex, typeNode.endIndex)
      : "";
    results.push({
      name,
      type: "field",
      startLine: sl,
      endLine: el,
      detail: typeText,
    });
  }

  return results;
}

// ========================================================================
// Rust
// ========================================================================

function extractRust(
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const MAX_DEPTH = depth + 10;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    let symbol: SymbolInfo | null = null;

    if (child.type === "function_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      const params = child.childForFieldName("parameters");
      const detail = params
        ? source.slice(params.startIndex, params.endIndex)
        : undefined;
      symbol = { name, type: "function", startLine: sl, endLine: el, detail };
    } else if (child.type === "struct_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "struct", startLine: sl, endLine: el };
    } else if (child.type === "enum_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "enum", startLine: sl, endLine: el };
    } else if (child.type === "trait_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "trait", startLine: sl, endLine: el };
    } else if (child.type === "impl_item") {
      const trait = child.childForFieldName("trait");
      const implType = child.childForFieldName("type");
      const traitStr = trait
        ? source.slice(trait.startIndex, trait.endIndex) + " for "
        : "";
      const typeStr = implType
        ? source.slice(implType.startIndex, implType.endIndex)
        : "";
      const [sl, el] = nodeRange(child);
      const name = `impl ${traitStr}${typeStr}`;
      symbol = { name, type: "impl", startLine: sl, endLine: el };

      // Recurse into body for associated functions/methods
      const body = child.childForFieldName("body");
      if (body && depth < MAX_DEPTH) {
        symbol.children = extractRustImplBody(body, source);
      }
    } else if (child.type === "type_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "type", startLine: sl, endLine: el };
    } else if (child.type === "const_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "const", startLine: sl, endLine: el };
    } else if (child.type === "macro_definition") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name: `${name}!`, type: "macro", startLine: sl, endLine: el };
    }

    if (symbol) results.push(symbol);
  }

  return results;
}

function extractRustImplBody(
  node: Node,
  source: string,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    let symbol: SymbolInfo | null = null;

    if (child.type === "function_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      const params = child.childForFieldName("parameters");
      const detail = params
        ? source.slice(params.startIndex, params.endIndex)
        : undefined;
      symbol = { name, type: "method", startLine: sl, endLine: el, detail };
    } else if (child.type === "const_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "const", startLine: sl, endLine: el };
    } else if (child.type === "type_item") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "type", startLine: sl, endLine: el };
    }

    if (symbol) results.push(symbol);
  }

  return results;
}

// ========================================================================
// Solidity
// ========================================================================

function extractSolidity(
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const MAX_DEPTH = depth + 10;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    let symbol: SymbolInfo | null = null;

    if (child.type === "contract_declaration") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);

      // Collect inheritance detail
      const inherits: string[] = [];
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j);
        if (c && c.type === "inheritance_specifier") {
          const ancestor = c.childForFieldName("ancestor");
          if (ancestor) {
            inherits.push(source.slice(ancestor.startIndex, ancestor.endIndex));
          }
        }
      }
      const detail = inherits.length > 0 ? `is ${inherits.join(", ")}` : undefined;

      symbol = { name, type: "contract", startLine: sl, endLine: el, detail };

      // Recurse into contract body
      const body = child.childForFieldName("body");
      if (body && depth < MAX_DEPTH) {
        symbol.children = extractSolidityBody(body, source, depth + 1);
      }
    } else if (child.type === "interface_declaration") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);

      const inherits: string[] = [];
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j);
        if (c && c.type === "inheritance_specifier") {
          const ancestor = c.childForFieldName("ancestor");
          if (ancestor) {
            inherits.push(source.slice(ancestor.startIndex, ancestor.endIndex));
          }
        }
      }
      const detail = inherits.length > 0 ? `is ${inherits.join(", ")}` : undefined;

      symbol = { name, type: "interface", startLine: sl, endLine: el, detail };

      const body = child.childForFieldName("body");
      if (body && depth < MAX_DEPTH) {
        symbol.children = extractSolidityBody(body, source, depth + 1);
      }
    } else if (child.type === "library_declaration") {
      const name = fieldChildText(child, "name", source) || "<anonymous>";
      const [sl, el] = nodeRange(child);
      symbol = { name, type: "library", startLine: sl, endLine: el };

      const body = child.childForFieldName("body");
      if (body && depth < MAX_DEPTH) {
        symbol.children = extractSolidityBody(body, source, depth + 1);
      }
    } else {
      // File-level item
      symbol = extractSolidityItem(child, source);
    }

    if (symbol) results.push(symbol);
  }

  return results;
}

function extractSolidityBody(
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const MAX_DEPTH = depth + 10;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    const symbol = extractSolidityItem(child, source);
    if (!symbol) continue;

    // Recurse into struct and enum bodies for nested members
    if (symbol.type === "struct" && depth < MAX_DEPTH) {
      const bodyNode = child.childForFieldName("body");
      if (bodyNode) {
        symbol.children = [];
        for (let j = 0; j < bodyNode.namedChildCount; j++) {
          const m = bodyNode.namedChild(j);
          if (!m) continue;
          if (m.type === "struct_member") {
            const memberName = fieldChildText(m, "name", source) || "";
            const memberType = m.childForFieldName("type");
            const typeStr = memberType
              ? source.slice(memberType.startIndex, memberType.endIndex)
              : "";
            const [msl, mel] = nodeRange(m);
            symbol.children.push({
              name: memberName,
              type: "field",
              startLine: msl,
              endLine: mel,
              detail: typeStr,
            });
          }
        }
      }
    } else if (symbol.type === "enum" && depth < MAX_DEPTH) {
      const bodyNode = child.childForFieldName("body");
      if (bodyNode) {
        symbol.children = [];
        for (let j = 0; j < bodyNode.namedChildCount; j++) {
          const m = bodyNode.namedChild(j);
          if (!m || m.type !== "enum_value") continue;
          const [msl, mel] = nodeRange(m);
          symbol.children.push({
            name: source.slice(m.startIndex, m.endIndex).trim(),
            type: "enum_value",
            startLine: msl,
            endLine: mel,
          });
        }
      }
    }

    results.push(symbol);
  }

  return results;
}

/** Collect all unnamed `parameter`/`event_parameter`/`error_parameter` named children and return their source ranges joined. */
function solidityParamsText(
  node: Node,
  source: string,
  paramType: string = "parameter",
): string | undefined {
  const parts: string[] = [];
  for (let j = 0; j < node.namedChildCount; j++) {
    const c = node.namedChild(j);
    if (c && c.type === paramType) {
      parts.push(source.slice(c.startIndex, c.endIndex));
    }
  }
  return parts.length > 0 ? `(${parts.join(", ")})` : undefined;
}

function extractSolidityItem(
  child: Node,
  source: string,
): SymbolInfo | null {
  const type = child.type;

  if (type === "function_definition") {
    const name = fieldChildText(child, "name", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    const params = solidityParamsText(child, source, "parameter");

    // Check for return type
    let returnType: string | undefined;
    for (let j = 0; j < child.namedChildCount; j++) {
      const c = child.namedChild(j);
      if (c && c.type === "return_type_definition") {
        returnType = source.slice(c.startIndex, c.endIndex);
        break;
      }
    }

    // Collect qualifiers: visibility, state_mutability, virtual, override, modifiers
    const qualifiers: string[] = [];
    for (let j = 0; j < child.namedChildCount; j++) {
      const c = child.namedChild(j);
      if (!c) continue;
      if (c.type === "visibility" || c.type === "state_mutability") {
        qualifiers.push(source.slice(c.startIndex, c.endIndex));
      } else if (c.type === "virtual") {
        qualifiers.push("virtual");
      } else if (c.type === "override_specifier") {
        qualifiers.push(source.slice(c.startIndex, c.endIndex));
      } else if (c.type === "modifier_invocation") {
        qualifiers.push(source.slice(c.startIndex, c.endIndex));
      }
    }

    const parts: string[] = [];
    if (params) parts.push(params);
    if (qualifiers.length > 0) parts.push(qualifiers.join(" "));
    if (returnType) parts.push(returnType);
    const detail = parts.length > 0 ? parts.join(" ") : undefined;

    return { name, type: "function", startLine: sl, endLine: el, detail };
  }

  if (type === "constructor_definition") {
    const [sl, el] = nodeRange(child);
    const params = solidityParamsText(child, source, "parameter");

    const qualifiers: string[] = [];
    for (let j = 0; j < child.namedChildCount; j++) {
      const c = child.namedChild(j);
      if (!c) continue;
      if (c.type === "visibility" || c.type === "state_mutability") {
        qualifiers.push(source.slice(c.startIndex, c.endIndex));
      } else if (c.type === "modifier_invocation") {
        qualifiers.push(source.slice(c.startIndex, c.endIndex));
      }
    }

    const parts: string[] = [];
    if (params) parts.push(params);
    if (qualifiers.length > 0) parts.push(qualifiers.join(" "));
    const detail = parts.length > 0 ? parts.join(" ") : undefined;

    return { name: "constructor", type: "constructor", startLine: sl, endLine: el, detail };
  }

  if (type === "modifier_definition") {
    const name = fieldChildText(child, "name", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    const detail = solidityParamsText(child, source, "parameter");
    return { name, type: "modifier", startLine: sl, endLine: el, detail };
  }

  if (type === "event_definition") {
    const name = fieldChildText(child, "name", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    return { name, type: "event", startLine: sl, endLine: el };
  }

  if (type === "error_declaration") {
    const name = childText(child, "identifier", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    // Collect error parameters for detail
    const params: string[] = [];
    for (let j = 0; j < child.namedChildCount; j++) {
      const c = child.namedChild(j);
      if (c && c.type === "error_parameter") {
        const typeName = c.childForFieldName("type");
        if (typeName) {
          const typeText = source.slice(typeName.startIndex, typeName.endIndex);
          const paramName = fieldChildText(c, "name", source);
          params.push(paramName ? `${typeText} ${paramName}` : typeText);
        }
      }
    }
    const detail = params.length > 0 ? `(${params.join(", ")})` : undefined;
    return { name, type: "error", startLine: sl, endLine: el, detail };
  }

  if (type === "struct_declaration") {
    const name = childText(child, "identifier", source) || fieldChildText(child, "name", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    return { name, type: "struct", startLine: sl, endLine: el };
  }

  if (type === "enum_declaration") {
    const name = fieldChildText(child, "name", source) || childText(child, "identifier", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    return { name, type: "enum", startLine: sl, endLine: el };
  }

  if (type === "fallback_receive_definition") {
    const [sl, el] = nodeRange(child);

    // Distinguish fallback vs receive by checking first keyword child
    let symbolType = "fallback";
    for (let j = 0; j < child.childCount; j++) {
      const c = child.child(j);
      if (c && c.type === "receive") {
        symbolType = "receive";
        break;
      }
    }

    const qualifiers: string[] = [];
    for (let j = 0; j < child.namedChildCount; j++) {
      const c = child.namedChild(j);
      if (!c) continue;
      if (c.type === "visibility" || c.type === "state_mutability") {
        qualifiers.push(source.slice(c.startIndex, c.endIndex));
      } else if (c.type === "virtual") {
        qualifiers.push("virtual");
      } else if (c.type === "override_specifier") {
        qualifiers.push(source.slice(c.startIndex, c.endIndex));
      } else if (c.type === "modifier_invocation") {
        qualifiers.push(source.slice(c.startIndex, c.endIndex));
      }
    }

    return {
      name: symbolType,
      type: symbolType,
      startLine: sl,
      endLine: el,
      detail: qualifiers.length > 0 ? qualifiers.join(" ") : undefined,
    };
  }

  if (type === "state_variable_declaration") {
    const name = fieldChildText(child, "name", source) || "<anonymous>";
    const [sl, el] = nodeRange(child);
    const varType = child.childForFieldName("type");
    const detail = varType ? source.slice(varType.startIndex, varType.endIndex) : undefined;
    return { name, type: "variable", startLine: sl, endLine: el, detail };
  }

  return null;
}

// ========================================================================
// Import extraction
// ========================================================================

/**
 * Extract import statements from parsed source code.
 * Returns a list of ImportInfo for each import in the file.
 */
export async function parseFileImports(
  key: string,
  source: string,
): Promise<ImportInfo[]> {
  // Markdown uses regex-based parsing, not tree-sitter
  if (key === "markdown") {
    return extractMarkdownLinks(source);
  }

  await ensureInit();

  const lang = await loadLanguage(key);
  if (!sharedParser) throw new Error("Parser not initialized");

  sharedParser.setLanguage(lang);
  const tree = sharedParser.parse(source);
  if (!tree) return [];

  return extractImports(key, tree.rootNode, source);
}

function extractImports(
  key: string,
  node: Node,
  source: string,
): ImportInfo[] {
  switch (key) {
    case "javascript":
    case "typescript":
    case "tsx":
      return extractJSImports(node, source);
    case "python":
      return extractPythonImports(node, source);
    case "go":
      return extractGoImports(node, source);
    case "rust":
      return extractRustImports(node, source);
    case "solidity":
      return extractSolidityImports(node, source);
    case "smali":
      return extractSmaliImports(node, source);
    case "java":
      return extractJavaImports(node, source);
    case "markdown":
      return extractMarkdownLinks(source);
    default:
      return [];
  }
}

// ---- JavaScript / TypeScript / TSX imports ----

function extractJSImports(node: Node, source: string): ImportInfo[] {
  const results: ImportInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    // import { foo } from 'bar';  or  import foo from 'bar';
    if (child.type === "import_statement") {
      const sourceNode = child.childForFieldName("source");
      if (!sourceNode) continue;
      const sourceText = extractStringLiteral(sourceNode, source);
      if (!sourceText) continue;

      const names = extractImportNames(child, source);
      results.push({
        source: sourceText,
        names,
        lineNumber: child.startPosition.row + 1,
      });
    }

    // export { foo } from 'bar';
    if (child.type === "export_statement") {
      const sourceNode = child.childForFieldName("source");
      if (!sourceNode) continue;
      const sourceText = extractStringLiteral(sourceNode, source);
      if (!sourceText) continue;

      const names = extractImportNames(child, source);

      results.push({
        source: sourceText,
        names,
        lineNumber: child.startPosition.row + 1,
      });
    }

    // const x = require('bar');
    if (
      child.type === "lexical_declaration" ||
      child.type === "variable_declaration"
    ) {
      for (let j = 0; j < child.namedChildCount; j++) {
        const decl = child.namedChild(j);
        if (!decl || decl.type !== "variable_declarator") continue;
        const value = decl.childForFieldName("value");
        if (!value || value.type !== "call_expression") continue;
        const func = value.childForFieldName("function");
        if (!func) continue;
        const funcText = source.slice(func.startIndex, func.endIndex);
        if (funcText !== "require") continue;

        const args = value.childForFieldName("arguments");
        if (!args || args.namedChildCount === 0) continue;
        const firstArg = args.namedChild(0);
        if (!firstArg) continue;
        const sourceText = extractStringLiteral(firstArg, source);
        if (!sourceText) continue;

        const name = fieldChildText(decl, "name", source);
        results.push({
          source: sourceText,
          names: name ? [name] : [],
          lineNumber: child.startPosition.row + 1,
        });
      }
    }
  }

  return results;
}

function extractImportNames(node: Node, source: string): string[] {
  const names: string[] = [];

  // import_clause is a named child, NOT a field in tree-sitter grammar
  for (let j = 0; j < node.namedChildCount; j++) {
    const c = node.namedChild(j);
    if (!c) continue;

    if (c.type === "import_clause") {
      extractNamesFromClause(c, source, names);
    }

    // export_statement may have export_clause with export_specifiers
    if (c.type === "export_clause") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const spec = c.namedChild(k);
        if (spec && spec.type === "export_specifier") {
          const name = fieldChildText(spec, "name", source);
          if (name) names.push(name);
        }
      }
    }
  }

  return names;
}

/** Extract imported symbol names from an import_clause node. */
function extractNamesFromClause(clause: Node, source: string, names: string[]): void {
  for (let j = 0; j < clause.namedChildCount; j++) {
    const c = clause.namedChild(j);
    if (!c) continue;

    if (c.type === "namespace_import") {
      const alias = c.childForFieldName("alias");
      if (alias) names.push("* as " + source.slice(alias.startIndex, alias.endIndex));
    } else if (c.type === "named_imports") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const spec = c.namedChild(k);
        if (spec && spec.type === "import_specifier") {
          const name = fieldChildText(spec, "name", source);
          if (name) names.push(name);
        }
      }
    } else {
      // default import (identifier)
      names.push(source.slice(c.startIndex, c.endIndex));
    }
  }
}

// ---- Python imports ----

function extractPythonImports(node: Node, source: string): ImportInfo[] {
  const results: ImportInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    // import foo
    if (child.type === "import_statement") {
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j);
        if (!c) continue;
        if (c.type === "dotted_name") {
          const mod = source.slice(c.startIndex, c.endIndex);
          results.push({
            source: mod,
            names: [],
            lineNumber: child.startPosition.row + 1,
          });
        } else if (c.type === "aliased_import") {
          const name = fieldChildText(c, "name", source);
          const alias = fieldChildText(c, "alias", source);
          if (name) {
            results.push({
              source: name,
              names: alias ? [alias] : [],
              lineNumber: child.startPosition.row + 1,
            });
          }
        }
      }
    }

    // from foo import bar
    if (child.type === "import_from_statement") {
      const moduleNode = child.childForFieldName("module_name");
      const sourceText = moduleNode
        ? source.slice(moduleNode.startIndex, moduleNode.endIndex)
        : "";
      if (!sourceText) continue;

      const names: string[] = [];
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j);
        if (!c) continue;
        if (c.type === "dotted_name") {
          names.push(source.slice(c.startIndex, c.endIndex));
        } else if (c.type === "aliased_import") {
          const name = fieldChildText(c, "name", source);
          if (name) names.push(name);
        } else if (c.type === "wildcard_import") {
          names.push("*");
        }
      }

      results.push({
        source: sourceText,
        names,
        lineNumber: child.startPosition.row + 1,
      });
    }
  }

  return results;
}

// ---- Go imports ----

function extractGoImports(node: Node, source: string): ImportInfo[] {
  const results: ImportInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child || child.type !== "import_declaration") continue;

    // Go's import_declaration wraps: single import_spec, or import_spec_list (grouped)
    for (let j = 0; j < child.namedChildCount; j++) {
      const spec = child.namedChild(j);
      if (!spec) continue;

      // Grouped imports: import_spec_list contains import_spec children
      if (spec.type === "import_spec_list") {
        for (let k = 0; k < spec.namedChildCount; k++) {
          const innerSpec = spec.namedChild(k);
          if (!innerSpec || innerSpec.type !== "import_spec") continue;
          const result = extractGoImportSpec(innerSpec, source);
          if (result) results.push(result);
        }
      } else if (spec.type === "import_spec") {
        const result = extractGoImportSpec(spec, source);
        if (result) results.push(result);
      }
    }
  }

  return results;
}

function extractGoImportSpec(spec: Node, source: string): ImportInfo | null {
  const pathNode = spec.childForFieldName("path");
  if (!pathNode) return null;
  const sourceText = extractStringLiteral(pathNode, source);
  if (!sourceText) return null;

  const name = fieldChildText(spec, "name", source);
  return {
    source: sourceText,
    names: name ? [name] : [],
    lineNumber: spec.startPosition.row + 1,
  };
}

// ---- Rust imports ----

function extractRustImports(node: Node, source: string): ImportInfo[] {
  const results: ImportInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    // use foo::bar;
    if (child.type === "use_declaration") {
      const arg = child.childForFieldName("argument");
      if (!arg) continue;

      const sourceText = source
        .slice(arg.startIndex, arg.endIndex)
        .replace(/\s+/g, " ");
      results.push({
        source: sourceText,
        names: [],
        lineNumber: child.startPosition.row + 1,
      });
    }

    // extern crate foo;
    if (child.type === "extern_crate_declaration") {
      const name = fieldChildText(child, "name", source);
      if (name) {
        results.push({
          source: name,
          names: [],
          lineNumber: child.startPosition.row + 1,
        });
      }
    }
  }

  return results;
}

// ---- Solidity imports ----

function extractSolidityImports(node: Node, source: string): ImportInfo[] {
  const results: ImportInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child || child.type !== "import_directive") continue;

    const sourceNode = child.childForFieldName("source");
    if (!sourceNode) continue;
    const sourceText = extractStringLiteral(sourceNode, source);
    if (!sourceText) continue;

    const names: string[] = [];
    // Check for named imports: import {A, B} from "foo.sol";
    for (let j = 0; j < child.namedChildCount; j++) {
      const c = child.namedChild(j);
      if (!c) continue;
      if (c.type === "import_clause") {
        for (let k = 0; k < c.namedChildCount; k++) {
          const sym = c.namedChild(k);
          if (sym && sym.type === "symbol_alias") {
            const name = fieldChildText(sym, "name", source);
            if (name) names.push(name);
          }
        }
      }
    }

    results.push({
      source: sourceText,
      names,
      lineNumber: child.startPosition.row + 1,
    });
  }

  return results;
}

// ---- Markdown extraction ----

/**
 * Extract structural symbols from Markdown content.
 * Since Markdown doesn't use tree-sitter, we use regex-based parsing.
 * Extracts headings as symbols, with nested structure based on heading levels.
 * Code blocks are nested under their parent heading.
 */
function extractMarkdown(source: string): SymbolInfo[] {
  const lines = source.split("\n");
  const results: SymbolInfo[] = [];
  
  // Track heading hierarchy for nesting
  const stack: SymbolInfo[] = [];
  
  // First pass: extract headings and build hierarchy
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const startLine = i + 1; // 1-indexed
      
      const symbol: SymbolInfo = {
        name: title,
        type: `heading${level}`,
        startLine,
        endLine: lines.length, // Will be updated later
        children: [],
        detail: `#`.repeat(level),
      };
      
      // Find parent: pop stack until we find a heading with lower level
      while (stack.length > 0) {
        const parentLevel = parseInt(stack[stack.length - 1].type?.replace('heading', '') || '0', 10);
        if (parentLevel >= level) {
          stack.pop();
        } else {
          break;
        }
      }
      
      // Add to parent or root
      if (stack.length > 0) {
        stack[stack.length - 1].children!.push(symbol);
      } else {
        results.push(symbol);
      }
      
      stack.push(symbol);
    }
  }
  
  // Update endLine for each heading: it ends just before the next sibling or parent's next sibling
  updateEndLines(results, lines.length);
  
  // Second pass: extract code blocks and nest them under appropriate headings
  const codeBlockRegex = /^```(\w+)\s*$/gm; // Only match opening ``` with a language
  let match;
  while ((match = codeBlockRegex.exec(source)) !== null) {
    const language = match[1];
    const startLine = source.slice(0, match.index).split("\n").length;
    
    // Find closing ```
    const afterMatch = source.slice(match.index + match[0].length);
    const closingIdx = afterMatch.search(/^```\s*$/m);
    let endLine = startLine + 1;
    if (closingIdx !== -1) {
      endLine = startLine + afterMatch.slice(0, closingIdx).split("\n").length + 1;
    }
    
    const codeBlock: SymbolInfo = {
      name: `code_block_${language}`,
      type: "code_block",
      startLine,
      endLine,
      detail: language,
    };
    
    // Find the heading that contains this code block
    const parent = findParentHeading(results, startLine);
    if (parent) {
      parent.children!.push(codeBlock);
    } else {
      results.push(codeBlock);
    }
  }
  
  return results;
}

/** Update endLine for each heading based on next sibling or parent's next sibling. */
function updateEndLines(symbols: SymbolInfo[], totalLines: number): void {
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    
    // Default: ends at file end
    symbol.endLine = totalLines;
    
    // If there's a next sibling, this heading ends just before it
    if (i + 1 < symbols.length) {
      symbol.endLine = symbols[i + 1].startLine - 1;
    }
    
    // Recurse into children
    if (symbol.children && symbol.children.length > 0) {
      updateEndLines(symbol.children, symbol.endLine);
      // The last child's endLine might extend to parent's endLine
      const lastChild = symbol.children[symbol.children.length - 1];
      if (lastChild.endLine < symbol.endLine) {
        lastChild.endLine = symbol.endLine;
      }
    }
  }
}

/** Find the heading that contains the given line number. */
function findParentHeading(symbols: SymbolInfo[], line: number): SymbolInfo | null {
  for (const symbol of symbols) {
    if (symbol.type?.startsWith("heading")) {
      // Check if line is within this heading's range
      if (line >= symbol.startLine && line <= symbol.endLine) {
        // Try to find a more specific child
        if (symbol.children && symbol.children.length > 0) {
          const child = findParentHeading(symbol.children, line);
          if (child) return child;
        }
        return symbol;
      }
    }
  }
  return null;
}

/**
 * Extract links from Markdown content as "imports".
 * Links to local files are considered imports.
 */
function extractMarkdownLinks(source: string): ImportInfo[] {
  const results: ImportInfo[] = [];
  const lines = source.split("\n");
  
  // Match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    
    while ((match = linkRegex.exec(line)) !== null) {
      const linkText = match[1];
      const url = match[2];
      
      // Skip external URLs
      if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
        continue;
      }
      
      results.push({
        source: url,
        names: [linkText],
        lineNumber: i + 1,
      });
    }
  }
  
  // Also extract import-like references: ![alt](image)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    
    while ((match = imageRegex.exec(line)) !== null) {
      const altText = match[1] || "image";
      const url = match[2];
      
      // Skip external URLs
      if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
        continue;
      }
      
      results.push({
        source: url,
        names: [altText],
        lineNumber: i + 1,
      });
    }
  }
  
  return results;
}

// ---- Shared helpers ----

/** Extract a string literal's value (strip surrounding quotes). */
function extractStringLiteral(node: Node, source: string): string | null {
  const text = source.slice(node.startIndex, node.endIndex);
  // Handle single, double, and backtick quotes
  const match = text.match(/^['"`](.*)['"`]$/s);
  return match ? match[1] : text;
}

// ---- Re-export ImportInfo for backward compatibility ----

export type { ImportInfo };

