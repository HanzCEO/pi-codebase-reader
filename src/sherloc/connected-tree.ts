/**
 * Connected Tree — builds and formats an import-dependency graph.
 *
 * Uses tree-sitter import extraction (added to parsers/manager.ts) to
 * discover import relationships across all parseable files in a repository.
 * Supports two modes:
 *   1. File-scoped: show direct imports and reverse imports for one file.
 *   2. Repo-wide: show all import relationships as a compact overview.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { detectLanguage, parseFileImports, type ImportInfo } from "../parsers/index.js";

const MAX_FILE_SIZE = 1024 * 1024; // skip files > 1MB

/** Resolved dependency info for one file. */
export interface FileDeps {
  filePath: string;
  imports: string[];       // module paths this file imports
  importedBy: string[];    // files that import this file
}

/**
 * Build a full import graph for all parseable files under a root dir.
 */
export async function buildImportGraph(rootDir: string): Promise<Map<string, FileDeps>> {
  const graph = new Map<string, FileDeps>();

  // 1. Collect all parseable source files
  const sourceFiles = collectSourceFiles(rootDir);

  // 2. Parse imports for each file
  const fileImports = new Map<string, string[]>();

  for (const filePath of sourceFiles) {
    const imports = await parseFileImportsFromPath(filePath);
    if (imports.length > 0) {
      fileImports.set(filePath, imports.map((i) => i.source));
    } else {
      fileImports.set(filePath, []);
    }
  }

  // 3. Resolve each import to a concrete file path and build bidirectional graph
  for (const [filePath, imports] of fileImports) {
    const resolvedImports = imports.map((imp) => resolveImport(imp, filePath, sourceFiles)).filter(Boolean) as string[];

    let entry = graph.get(filePath);
    if (!entry) {
      entry = { filePath, imports: [], importedBy: [] };
      graph.set(filePath, entry);
    }
    entry.imports = resolvedImports;

    // Register reverse edges
    for (const resolved of resolvedImports) {
      let depEntry = graph.get(resolved);
      if (!depEntry) {
        depEntry = { filePath: resolved, imports: [], importedBy: [] };
        graph.set(resolved, depEntry);
      }
      if (!depEntry.importedBy.includes(filePath)) {
        depEntry.importedBy.push(filePath);
      }
    }
  }

  return graph;
}

/**
 * Format the import graph for a specific file.
 */
export function formatFileConnectedTree(
  graph: Map<string, FileDeps>,
  targetFile: string,
  rootDir: string,
): string {
  const absTarget = resolve(rootDir, targetFile);
  const entry = graph.get(absTarget);

  if (!entry) {
    return `No import data for ${targetFile}.\n`;
  }

  const relPath = relative(rootDir, absTarget);
  const lines: string[] = [];
  lines.push(`Connected tree for: ${relPath}`);
  lines.push("");

  // Direct imports (outgoing)
  if (entry.imports.length === 0) {
    lines.push("  Imports: (none)");
  } else {
    lines.push("  Imports:");
    for (const imp of entry.imports) {
      const rel = relative(rootDir, imp);
      lines.push(`    ← ${rel}`);
    }
  }

  lines.push("");

  // Reverse imports (incoming)
  if (entry.importedBy.length === 0) {
    lines.push("  Imported by: (none)");
  } else {
    lines.push("  Imported by:");
    for (const importer of entry.importedBy) {
      const rel = relative(rootDir, importer);
      lines.push(`    → ${rel}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format repository-wide import overview.
 */
export function formatRepoConnectedTree(
  graph: Map<string, FileDeps>,
  rootDir: string,
): string {
  const lines: string[] = [];
  lines.push("Repository import overview");
  lines.push("");

  // Count imports per file, sort by most imports
  const entries = Array.from(graph.entries())
    .map(([_, deps]) => ({
      filePath: relative(rootDir, deps.filePath),
      importCount: deps.imports.length,
      importedByCount: deps.importedBy.length,
    }))
    .sort((a, b) => b.importCount - a.importCount);

  if (entries.length === 0) {
    lines.push("  No import relationships found.");
    return lines.join("\n");
  }

  // Top imported files
  const mostImported = [...entries].sort((a, b) => b.importedByCount - a.importedByCount).slice(0, 20);
  lines.push(`Files with the most reverse-dependencies (top ${mostImported.length}):`);
  for (const e of mostImported) {
    lines.push(`  ${e.filePath} — imported by ${e.importedByCount} file(s)`);
  }

  lines.push("");

  // Files with most imports
  const mostImporting = entries.slice(0, 20);
  lines.push(`Most importing files (top ${mostImporting.length}):`);
  for (const e of mostImporting) {
    lines.push(`  ${e.filePath} — ${e.importCount} import(s)`);
  }

  lines.push("");
  lines.push(`Total parseable files in graph: ${entries.length}`);

  return lines.join("\n");
}

/**
 * Resolve an import source string to an actual file path.
 * Handles relative imports (./foo, ../foo) and looks for extensions.
 */
function resolveImport(
  importSource: string,
  fromFile: string,
  allFiles: string[],
): string | null {
  // Skip external / npm / stdlib imports
  if (
    !importSource.startsWith(".") &&
    !importSource.startsWith("/") &&
    !importSource.includes("\\") &&
    !importSource.endsWith(".sol")
  ) {
    return null; // external dependency
  }

  const fromDir = statSync(fromFile).isDirectory()
    ? fromFile
    : fromFile.substring(0, fromFile.lastIndexOf(sep));

  // Try resolving with common extensions
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".sol", "/index.ts", "/index.js", "/index.tsx", "/index.jsx", "/__init__.py"];

  for (const ext of extensions) {
    const candidate = resolve(fromDir, importSource + ext);
    if (allFiles.includes(candidate)) {
      return candidate;
    }
  }

  // Try as absolute path (same repo)
  for (const candidate of allFiles) {
    if (candidate.endsWith(importSource) || candidate.endsWith(importSource.replace(/\//g, sep))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Parse imports from a single file path using tree-sitter.
 */
async function parseFileImportsFromPath(filePath: string): Promise<ImportInfo[]> {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lang = detectLanguage(filePath);
    if (!lang) return [];
    return await parseFileImports(lang, content);
  } catch {
    return [];
  }
}

/**
 * Recursively collect all parseable source files under a root directory.
 */
function collectSourceFiles(rootDir: string): string[] {
  const results: string[] = [];
  const excludedDirs = new Set([
    "node_modules",
    ".git",
    ".github",
    "dist",
    "build",
    "target",
    "venv",
    ".venv",
    "__pycache__",
    ".next",
    "coverage",
    ".nyc_output",
    ".svelte-kit",
    ".cache",
    "tmp",
    "out",
    ".tox",
    "eggs",
    ".eggs",
    "env",
    ".env",
    "site-packages",
    ".dart_tool",
    "packages",
    "vendor",
  ]);

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!excludedDirs.has(entry) && !entry.startsWith(".")) {
          walk(fullPath);
        }
      } else if (stat.isFile() && stat.size <= MAX_FILE_SIZE) {
        const lang = detectLanguage(fullPath);
        if (lang) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(rootDir);
  return results;
}


