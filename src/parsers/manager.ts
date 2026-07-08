/**
 * Tree-sitter parser manager.
 *
 * Lazily initializes the WASM runtime and loads language grammars on demand.
 * All parsers share a single Parser instance, re-configured per language.
 */

import { createRequire } from "node:module";
import { Parser, Language, type Node } from "web-tree-sitter";
import type { SymbolInfo } from "../types.js";

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
