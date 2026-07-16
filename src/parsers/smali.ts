/**
 * Smali (Android bytecode) tree-sitter symbol extractor.
 *
 * Tree-sitter grammar: tree-sitter-smali (https://github.com/amaanq/tree-sitter-smali)
 * The grammar is the best available Smali tree-sitter grammar, published on npm
 * as tree-sitter-smali@1.0.0, maintained by amaanq and yotamN.
 *
 * Smali is the human-readable assembly format for Android's Dalvik bytecode.
 * The grammar supports:
 *  - class/interface/enum definitions
 *  - method definitions with signatures
 *  - field definitions with types and values
 *  - annotations
 *  - directives (super, implements, source, registers, locals, etc.)
 *  - all Dalvik opcodes
 *  - catch/catchall directives
 *  - packed/sparse switch directives
 *  - array data
 *  - debug info (line, local, etc.)
 */

import type { Node } from "web-tree-sitter";
import type { SymbolInfo, ImportInfo } from "../types.js";

/**
 * Extract structural symbols from Smali source code.
 */
export function extractSmali(
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const MAX_DEPTH = depth + 10;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    if (child.type === "class_definition") {
      let className = "<unknown>";
      let classType = "class";
      let superClass: string | undefined;
      const implementsList: string[] = [];

      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j);
        if (!c) continue;

        if (c.type === "class_directive") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const sub = c.namedChild(k);
            if (!sub) continue;
            if (sub.type === "class_identifier") {
              className = source.slice(sub.startIndex, sub.endIndex);
            }
            if (sub.type === "access_modifiers") {
              for (let m = 0; m < sub.namedChildCount; m++) {
                const modNode = sub.namedChild(m);
                if (modNode && modNode.type === "access_modifier") {
                  const mod = source.slice(modNode.startIndex, modNode.endIndex);
                  if (mod === "interface") classType = "interface";
                  else if (mod === "enum") classType = "enum";
                  else if (mod === "abstract" && classType === "class") classType = "abstract class";
                }
              }
            }
          }
        } else if (c.type === "super_directive") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const sub = c.namedChild(k);
            if (sub && sub.type === "class_identifier") {
              superClass = source.slice(sub.startIndex, sub.endIndex);
            }
          }
        } else if (c.type === "implements_directive") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const sub = c.namedChild(k);
            if (sub && sub.type === "class_identifier") {
              implementsList.push(source.slice(sub.startIndex, sub.endIndex));
            }
          }
        }
      }

      const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
      const detailParts: string[] = [];
      if (superClass) detailParts.push(`extends ${superClass}`);
      if (implementsList.length > 0) detailParts.push(`implements ${implementsList.join(", ")}`);

      const symbol: SymbolInfo = {
        name: className,
        type: classType,
        startLine: sl,
        endLine: el,
        detail: detailParts.length > 0 ? detailParts.join(" ") : undefined,
      };

      // Recurse into class body for fields, methods, and annotations
      if (depth < MAX_DEPTH) {
        const children: SymbolInfo[] = [];
        for (let j = 0; j < child.namedChildCount; j++) {
          const c = child.namedChild(j);
          if (!c) continue;

          if (c.type === "method_definition") {
            const method = extractSmaliMethod(c, source);
            if (method) children.push(method);
          } else if (c.type === "field_definition") {
            const field = extractSmaliField(c, source);
            if (field) children.push(field);
          } else if (c.type === "annotation_directive") {
            const annot = extractSmaliAnnotation(c, source);
            if (annot) children.push(annot);
          }
        }
        if (children.length > 0) symbol.children = children;
      }

      results.push(symbol);
    }
  }

  return results;
}

/** Extract a Smali method definition. */
function extractSmaliMethod(
  child: Node,
  source: string,
): SymbolInfo | null {
  let methodName = "<unknown>";
  let params: string | undefined;
  let returnType: string | undefined;
  const accessMods: string[] = [];

  for (let j = 0; j < child.namedChildCount; j++) {
    const c = child.namedChild(j);
    if (!c) continue;

    if (c.type === "access_modifier") {
      accessMods.push(source.slice(c.startIndex, c.endIndex));
    } else if (c.type === "method_signature") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (!sub) continue;
        if (sub.type === "method_identifier") {
          methodName = source.slice(sub.startIndex, sub.endIndex);
        } else if (sub.type === "parameters") {
          params = source.slice(sub.startIndex, sub.endIndex);
        } else if (sub.type === "type") {
          returnType = source.slice(sub.startIndex, sub.endIndex);
        }
      }
    }
  }

  const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
  const parts: string[] = [];
  if (accessMods.length > 0) parts.push(accessMods.join(" "));
  if (params) parts.push(params);
  if (returnType) parts.push(`-> ${returnType}`);

  return {
    name: methodName,
    type: "method",
    startLine: sl,
    endLine: el,
    detail: parts.length > 0 ? parts.join(" ") : undefined,
  };
}

/** Extract a Smali field definition. */
function extractSmaliField(
  child: Node,
  source: string,
): SymbolInfo | null {
  let fieldName = "<unknown>";
  let fieldType: string | undefined;
  let fieldValue: string | undefined;
  const accessMods: string[] = [];

  for (let j = 0; j < child.namedChildCount; j++) {
    const c = child.namedChild(j);
    if (!c) continue;

    if (c.type === "access_modifiers") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (sub && sub.type === "access_modifier") {
          accessMods.push(source.slice(sub.startIndex, sub.endIndex));
        }
      }
    } else if (c.type === "field_identifier") {
      fieldName = source.slice(c.startIndex, c.endIndex);
    } else if (c.type === "field_type") {
      fieldType = source.slice(c.startIndex, c.endIndex);
    } else if (c.type === "value") {
      fieldValue = source.slice(c.startIndex, c.endIndex);
    }
  }

  const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
  const parts: string[] = [];
  if (accessMods.length > 0) parts.push(accessMods.join(" "));
  if (fieldType) parts.push(fieldType);
  if (fieldValue) parts.push(`= ${fieldValue}`);

  return {
    name: fieldName,
    type: "field",
    startLine: sl,
    endLine: el,
    detail: parts.length > 0 ? parts.join(" ") : undefined,
  };
}

/** Extract a Smali annotation directive. */
function extractSmaliAnnotation(
  child: Node,
  source: string,
): SymbolInfo | null {
  let annotName = "<unknown>";
  for (let j = 0; j < child.namedChildCount; j++) {
    const c = child.namedChild(j);
    if (c && c.type === "class_identifier") {
      annotName = source.slice(c.startIndex, c.endIndex);
      break;
    }
  }

  const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
  return {
    name: annotName,
    type: "annotation",
    startLine: sl,
    endLine: el,
  };
}

/**
 * Extract Smali "imports" -- super classes and implemented interfaces.
 */
export function extractSmaliImports(
  node: Node,
  source: string,
): ImportInfo[] {
  const results: ImportInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    if (child.type === "class_definition") {
      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j);
        if (!c) continue;

        if (c.type === "super_directive") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const sub = c.namedChild(k);
            if (sub && sub.type === "class_identifier") {
              const text = source.slice(sub.startIndex, sub.endIndex);
              results.push({
                source: text,
                names: [text],
                lineNumber: sub.startPosition.row + 1,
              });
            }
          }
        } else if (c.type === "implements_directive") {
          for (let k = 0; k < c.namedChildCount; k++) {
            const sub = c.namedChild(k);
            if (sub && sub.type === "class_identifier") {
              const text = source.slice(sub.startIndex, sub.endIndex);
              results.push({
                source: text,
                names: [text],
                lineNumber: sub.startPosition.row + 1,
              });
            }
          }
        }
      }
    }
  }

  return results;
}