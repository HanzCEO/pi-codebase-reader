/**
 * SHERLOC Tool Suite — registered as pi tools for the Explorer subagent.
 *
 * Two new tools beyond the existing read/grep/find/bash/ls:
 *   1. repo_tree — filtered repository tree display
 *   2. connected_tree — import dependency graph
 *
 * These are registered alongside existing tools and listed in the
 * Explorer agent's frontmatter for subagent use.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildImportGraph, formatFileConnectedTree, formatRepoConnectedTree } from "./connected-tree.js";

// ── Shared helpers ──────────────────────────────────────────────────────

/** Directories to exclude from repo tree. */
const EXCLUDED_DIRS = new Set([
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
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "bazel-out",
  "bazel-testlogs",
  "bazel-bin",
  ".generated",
]);

/** File extensions to show line counts for. */
const LINE_COUNT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".sol",
  ".json", ".yaml", ".yml", ".toml", ".md",
  ".css", ".scss", ".less", ".html",
  ".sh", ".bash", ".zsh",
  ".java", ".kt", ".scala",
  ".c", ".h", ".cpp", ".hpp",
  ".sql",
]);

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ── repo_tree tool ──────────────────────────────────────────────────────

/**
 * Register the repo_tree tool.
 *
 * Displays the repository file hierarchy (filtered) with per-file line counts.
 * Simulates `tree` but excludes non-production directories.
 */
export function registerRepotreeTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "repo_tree",
    label: "Repository Tree",
    description:
      "Display the repository file hierarchy with per-file line counts. " +
      "Excludes non-production directories (node_modules, .git, dist, etc.). " +
      "Optional depth argument limits nesting depth. " +
      "Shows total files, total lines, and total size at the bottom.",
    promptSnippet: "Display repository tree structure with line counts",
    promptGuidelines: [
      "Use repo_tree when you need a global map of the project structure.",
      "It shows every production source file with its line count.",
      "Optionally pass a depth argument to limit nesting (default: unlimited).",
    ],
    parameters: Type.Object({
      depth: Type.Optional(
        Type.Number({
          description:
            "Maximum nesting depth (default: no limit; 1 = root only).",
        }),
      ),
      root: Type.Optional(
        Type.String({
          description:
            "Subdirectory to start from (relative to repo root, default: repo root).",
        }),
      ),
    }),
    renderShell: "self" as const,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const maxDepth = params.depth ?? Infinity;
      const subRoot = params.root ? resolve(ctx.cwd, params.root) : ctx.cwd;

      if (!existsSync(subRoot)) {
        return textResult(`Directory not found: ${params.root || ctx.cwd}`);
      }

      const lines: string[] = [];
      let totalFiles = 0;
      let totalLines = 0;
      let totalBytes = 0;

      function walk(dir: string, depth: number, prefix: string): void {
        if (depth > maxDepth) return;

        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }

        // Sort: directories first, then files, alphabetical
        const dirs: string[] = [];
        const files: string[] = [];
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          try {
            if (statSync(fullPath).isDirectory()) {
              if (!EXCLUDED_DIRS.has(entry) && !entry.startsWith(".")) {
                dirs.push(entry);
              }
            } else {
              files.push(entry);
            }
          } catch {
            // skip unreadable
          }
        }
        dirs.sort();
        files.sort();

        const allItems = [...dirs, ...files];
        for (let i = 0; i < allItems.length; i++) {
          const entry = allItems[i];
          const fullPath = join(dir, entry);
          const isLast = i === allItems.length - 1;
          const connector = isLast ? "└── " : "├── ";
          const childPrefix = isLast ? prefix + "    " : prefix + "│   ";

          try {
            const stats = statSync(fullPath);
            if (stats.isDirectory()) {
              lines.push(`${prefix}${connector}${entry}/`);
              walk(fullPath, depth + 1, childPrefix);
            } else if (stats.isFile()) {
              totalFiles++;
              totalBytes += stats.size;
              if (LINE_COUNT_EXTENSIONS.has(entry.substring(entry.lastIndexOf(".")))) {
                try {
                  const content = readFileSync(fullPath, "utf-8");
                  const lineCount = content.split("\n").length;
                  totalLines += lineCount;
                  lines.push(`${prefix}${connector}${entry}  (${lineCount} lines, ${formatFileSize(stats.size)})`);
                } catch {
                  lines.push(`${prefix}${connector}${entry}  (${formatFileSize(stats.size)})`);
                }
              } else {
                lines.push(`${prefix}${connector}${entry}  (${formatFileSize(stats.size)})`);
              }
            }
          } catch {
            // skip unreadable
          }
        }
      }

      const rootName = relative(ctx.cwd, subRoot) || ".";
      lines.push(`${rootName}/`);
      walk(subRoot, 1, "");

      // Summary
      lines.push("");
      lines.push(`Total: ${totalFiles} files, ${totalLines} lines, ${formatFileSize(totalBytes)}`);

      return textResult(lines.join("\n"));
    },
  });
}

// ── connected_tree tool ─────────────────────────────────────────────────

/**
 * Register the connected_tree tool.
 *
 * Shows import dependencies for a file or repo-wide import overview.
 * With a file argument: shows direct imports and reverse imports.
 * Without: shows repository-wide import overview (top imported files, etc.).
 */
export function registerConnectedTreeTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "connected_tree",
    label: "Connected Tree",
    description:
      "Shows import dependencies. With a file path argument, shows direct imports " +
      "(what the file imports) and reverse imports (what imports this file). " +
      "Without arguments, shows a repository-wide import overview with the most " +
      "imported files and most importing files. Uses tree-sitter AST parsing to " +
      "extract import statements from supported languages.",
    promptSnippet: "Display import dependency graph for files or repo-wide",
    promptGuidelines: [
      "Use connected_tree <file> to understand a file's dependencies and dependents.",
      "Use connected_tree without arguments for a repo-wide import overview.",
      "Only works for supported languages (JS/TS, Python, Go, Rust, Solidity).",
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description:
            "File path to show import connections for (relative to repo root). " +
            "If omitted, shows a repo-wide import overview.",
        }),
      ),
    }),
    renderShell: "self" as const,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const graph = await buildImportGraph(ctx.cwd);

        if (params.path) {
          const content = formatFileConnectedTree(graph, params.path, ctx.cwd);
          return textResult(content);
        } else {
          const content = formatRepoConnectedTree(graph, ctx.cwd);
          return textResult(content);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(
          `Error building import graph: ${msg}\nMake sure the repository contains supported source files and tree-sitter grammars are installed.`,
        );
      }
    },
  });
}

// ── Shared result helper ────────────────────────────────────────────────

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {} as const,
  };
}
