/**
 * Java tree-sitter symbol extractor.
 *
 * Tree-sitter grammar: tree-sitter-java (https://github.com/tree-sitter/tree-sitter-java)
 * The official tree-sitter Java grammar, maintained by the tree-sitter core team.
 * Supports modern Java up to Java 21 (records, sealed types, pattern matching,
 * switch expressions, text blocks).
 */

import type { Node } from "web-tree-sitter";
import type { SymbolInfo, ImportInfo } from "../types.js";

/**
 * Extract structural symbols from Java source code.
 */
export function extractJava(
  node: Node,
  source: string,
  depth: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const MAX_DEPTH = depth + 10;

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    const symbol = extractJavaTopLevel(child, source, depth, MAX_DEPTH);
    if (symbol) results.push(symbol);
  }

  return results;
}

function extractJavaType(
  node: Node,
  source: string,
  depth: number,
  MAX_DEPTH: number,
): SymbolInfo | null {
  switch (node.type) {
    case "class_declaration":
    case "interface_declaration":
    case "enum_declaration":
    case "record_declaration":
    case "annotation_type_declaration":
      return extractJavaTypeDeclaration(node, source, depth, MAX_DEPTH);
    default:
      return null;
  }
}

function extractJavaTopLevel(
  child: Node,
  source: string,
  depth: number,
  MAX_DEPTH: number,
): SymbolInfo | null {
  return extractJavaType(child, source, depth, MAX_DEPTH);
}

function extractJavaTypeDeclaration(
  child: Node,
  source: string,
  depth: number,
  MAX_DEPTH: number,
): SymbolInfo | null {
  let typeName = "<unknown>";
  let typeLabel = "class";
  const modifiers: string[] = [];
  let superClass: string | undefined;
  const interfaces: string[] = [];
  const extendsInterfaces: string[] = [];

  if (child.type === "interface_declaration") typeLabel = "interface";
  else if (child.type === "enum_declaration") typeLabel = "enum";
  else if (child.type === "record_declaration") typeLabel = "record";
  else if (child.type === "annotation_type_declaration") typeLabel = "annotation";

  for (let j = 0; j < child.namedChildCount; j++) {
    const c = child.namedChild(j);
    if (!c) continue;

    if (c.type === "modifiers") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (sub && sub.type !== "annotation") {
          modifiers.push(source.slice(sub.startIndex, sub.endIndex));
        }
      }
    } else if (c.type === "identifier") {
      typeName = source.slice(c.startIndex, c.endIndex);
    } else if (c.type === "superclass") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (sub && sub.type !== "extends") {
          superClass = source.slice(sub.startIndex, sub.endIndex);
        }
      }
    } else if (c.type === "super_interfaces") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (sub && sub.type !== "implements") {
          interfaces.push(source.slice(sub.startIndex, sub.endIndex));
        }
      }
    } else if (c.type === "extends_interfaces") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (sub && sub.type !== "extends") {
          extendsInterfaces.push(source.slice(sub.startIndex, sub.endIndex));
        }
      }
    }
  }

  const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
  const detailParts: string[] = [];
  if (modifiers.length > 0) detailParts.push(modifiers.join(" "));
  if (superClass) detailParts.push("extends " + superClass);
  if (interfaces.length > 0) detailParts.push("implements " + interfaces.join(", "));
  if (extendsInterfaces.length > 0) detailParts.push("extends " + extendsInterfaces.join(", "));

  const symbol: SymbolInfo = {
    name: typeName,
    type: typeLabel,
    startLine: sl,
    endLine: el,
    detail: detailParts.length > 0 ? detailParts.join(" ") : undefined,
  };

  if (depth < MAX_DEPTH) {
    const body = findClassBody(child);
    if (body) {
      const children = extractJavaClassBody(body, source, depth + 1, MAX_DEPTH);
      if (children.length > 0) symbol.children = children;
    }
  }

  return symbol;
}

function findClassBody(node: Node): Node | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (
      c.type === "class_body" ||
      c.type === "enum_body" ||
      c.type === "interface_body" ||
      c.type === "annotation_type_body"
    ) {
      return c;
    }
  }
  return null;
}

function extractJavaClassBody(
  body: Node,
  source: string,
  depth: number,
  MAX_DEPTH: number,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];

  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (!child) continue;

    switch (child.type) {
      case "method_declaration": {
        const method = extractJavaMethod(child, source);
        if (method) results.push(method);
        break;
      }
      case "constructor_declaration": {
        const ctor = extractJavaConstructor(child, source);
        if (ctor) results.push(ctor);
        break;
      }
      case "field_declaration": {
        const fields = extractJavaFields(child, source);
        results.push(...fields);
        break;
      }
      case "class_declaration":
      case "interface_declaration":
      case "enum_declaration":
      case "record_declaration":
      case "annotation_type_declaration": {
        const type = extractJavaTypeDeclaration(child, source, depth, MAX_DEPTH);
        if (type) results.push(type);
        break;
      }
      case "enum_constant": {
        const ec = extractJavaEnumConstant(child, source);
        if (ec) results.push(ec);
        break;
      }
      case "static_initializer": {
        const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
        results.push({ name: "static", type: "static_initializer", startLine: sl, endLine: el });
        break;
      }
    }
  }

  return results;
}

function extractModifiers(node: Node, source: string): string[] {
  const mods: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (c.type !== "annotation") {
      mods.push(source.slice(c.startIndex, c.endIndex));
    }
  }
  return mods;
}

function extractJavaMethod(
  child: Node,
  source: string,
): SymbolInfo | null {
  let methodName = "<unknown>";
  const modifiers: string[] = [];
  let returnType: string | undefined;
  let params: string | undefined;
  let typeParams: string | undefined;

  for (let j = 0; j < child.namedChildCount; j++) {
    const c = child.namedChild(j);
    if (!c) continue;

    if (c.type === "modifiers") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (sub && sub.type !== "annotation") {
          modifiers.push(source.slice(sub.startIndex, sub.endIndex));
        }
      }
    } else if (c.type === "_method_header") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (!sub) continue;

        if (sub.type === "type_parameters") {
          typeParams = source.slice(sub.startIndex, sub.endIndex);
        } else if (sub.type === "_method_declarator") {
          for (let m = 0; m < sub.namedChildCount; m++) {
            const decl = sub.namedChild(m);
            if (!decl) continue;
            if (decl.type === "identifier") {
              methodName = source.slice(decl.startIndex, decl.endIndex);
            } else if (decl.type === "formal_parameters") {
              params = source.slice(decl.startIndex, decl.endIndex);
            }
          }
        } else if (sub.type !== "type_parameters" && sub.type !== "_method_declarator" && sub.type !== "throws") {
          returnType = source.slice(sub.startIndex, sub.endIndex);
        }
      }
    }
  }

  const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
  const detailParts: string[] = [];
  if (modifiers.length > 0) detailParts.push(modifiers.join(" "));
  if (typeParams) detailParts.push(typeParams);
  if (returnType) detailParts.push(returnType);
  if (params) detailParts.push(params);

  return {
    name: methodName,
    type: "method",
    startLine: sl,
    endLine: el,
    detail: detailParts.length > 0 ? detailParts.join(" ") : undefined,
  };
}

function extractJavaConstructor(
  child: Node,
  source: string,
): SymbolInfo | null {
  let ctorName = "<unknown>";
  const modifiers: string[] = [];
  let params: string | undefined;
  let typeParams: string | undefined;

  for (let j = 0; j < child.namedChildCount; j++) {
    const c = child.namedChild(j);
    if (!c) continue;

    if (c.type === "modifiers") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (sub && sub.type !== "annotation") {
          modifiers.push(source.slice(sub.startIndex, sub.endIndex));
        }
      }
    } else if (c.type === "_constructor_declarator") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (!sub) continue;
        if (sub.type === "type_parameters") {
          typeParams = source.slice(sub.startIndex, sub.endIndex);
        } else if (sub.type === "identifier") {
          ctorName = source.slice(sub.startIndex, sub.endIndex);
        } else if (sub.type === "formal_parameters") {
          params = source.slice(sub.startIndex, sub.endIndex);
        }
      }
    }
  }

  const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
  const detailParts: string[] = [];
  if (modifiers.length > 0) detailParts.push(modifiers.join(" "));
  if (typeParams) detailParts.push(typeParams);
  if (params) detailParts.push(params);

  return {
    name: ctorName,
    type: "constructor",
    startLine: sl,
    endLine: el,
    detail: detailParts.length > 0 ? detailParts.join(" ") : undefined,
  };
}

function extractJavaFields(
  child: Node,
  source: string,
): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const modifiers: string[] = [];
  let fieldType: string | undefined;

  for (let j = 0; j < child.namedChildCount; j++) {
    const c = child.namedChild(j);
    if (!c) continue;

    if (c.type === "modifiers") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const sub = c.namedChild(k);
        if (sub && sub.type !== "annotation") {
          modifiers.push(source.slice(sub.startIndex, sub.endIndex));
        }
      }
    } else if (c.type === "_unannotated_type" || c.type === "type") {
      fieldType = source.slice(c.startIndex, c.endIndex);
    } else if (c.type === "_variable_declarator_list") {
      for (let k = 0; k < c.namedChildCount; k++) {
        const decl = c.namedChild(k);
        if (!decl) continue;
        if (decl.type === "variable_declarator") {
          const field = extractJavaVariableDeclarator(decl, source, modifiers, fieldType);
          if (field) results.push(field);
        }
      }
    }
  }

  return results;
}

function extractJavaVariableDeclarator(
  node: Node,
  source: string,
  modifiers: string[],
  fieldType: string | undefined,
): SymbolInfo | null {
  let fieldName = "<unknown>";
  let fieldValue: string | undefined;

  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;

    if (c.type === "_variable_declarator_id") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const sub = c.namedChild(j);
        if (sub && sub.type === "identifier") {
          fieldName = source.slice(sub.startIndex, sub.endIndex);
        }
      }
    } else if (c.type === "=") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const sub = c.namedChild(j);
        if (sub) {
          fieldValue = source.slice(sub.startIndex, sub.endIndex);
        }
      }
    }
  }

  const [sl, el] = [node.startPosition.row + 1, node.endPosition.row + 1];
  const detailParts: string[] = [];
  if (modifiers.length > 0) detailParts.push(modifiers.join(" "));
  if (fieldType) detailParts.push(fieldType);
  if (fieldValue) detailParts.push("= " + fieldValue);

  return {
    name: fieldName,
    type: "field",
    startLine: sl,
    endLine: el,
    detail: detailParts.length > 0 ? detailParts.join(" ") : undefined,
  };
}

function extractJavaEnumConstant(
  child: Node,
  source: string,
): SymbolInfo | null {
  let constName = "<unknown>";
  let constArgs: string | undefined;

  for (let j = 0; j < child.namedChildCount; j++) {
    const c = child.namedChild(j);
    if (!c) continue;

    if (c.type === "identifier") {
      constName = source.slice(c.startIndex, c.endIndex);
    } else if (c.type === "argument_list") {
      constArgs = source.slice(c.startIndex, c.endIndex);
    }
  }

  const [sl, el] = [child.startPosition.row + 1, child.endPosition.row + 1];
  const detailParts: string[] = [];
  if (constArgs) detailParts.push(constArgs);

  return {
    name: constName,
    type: "enum_constant",
    startLine: sl,
    endLine: el,
    detail: detailParts.length > 0 ? detailParts.join(" ") : undefined,
  };
}

/**
 * Extract Java imports.
 */
export function extractJavaImports(
  node: Node,
  source: string,
): ImportInfo[] {
  const results: ImportInfo[] = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;

    if (child.type === "import_declaration") {
      let importSource = "";
      let isStatic = false;
      let isWildcard = false;

      for (let j = 0; j < child.namedChildCount; j++) {
        const c = child.namedChild(j);
        if (!c) continue;

        if (c.type === "static" || source.slice(c.startIndex, c.endIndex) === "static") {
          isStatic = true;
        } else if (c.type === "asterisk") {
          isWildcard = true;
        } else if (c.type === "scoped_identifier" || c.type === "identifier") {
          importSource = source.slice(c.startIndex, c.endIndex);
        }
      }

      // Build the full import path
      let fullPath = importSource;
      if (isWildcard) {
        fullPath += ".*";
      }

      // Extract the last segment as the imported name
      const names: string[] = [];
      if (!isWildcard) {
        const parts = importSource.split(".");
        const lastName = parts[parts.length - 1];
        if (lastName) names.push(lastName);
      }

      results.push({
        source: isStatic ? "static " + fullPath : fullPath,
        names,
        lineNumber: child.startPosition.row + 1,
      });
    }
  }

  return results;
}
