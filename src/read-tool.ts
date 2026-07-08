/**
 * Smart read tool — overrides pi's built-in `read` with AST-based outlining.
 *
 * Behavior:
 * - Small files: return full content as normal
 * - Large files (above threshold): return a structural AST outline with line ranges
 * - Offset/limit requests: treated as section drill-down, return that section's content
 * - Unsupported languages: fall back to simple line-count header
 * - Disabled mode (`/codebase-reader off`): pass through to built-in behavior
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { estimateCodeTokens, formatTokenCount } from "./token-estimate.js";
import { suggestSimilarPaths } from "./fuzzy-suggest.js";
import { generateOutline } from "./outline.js";
import { detectLanguage, parseSourceFile } from "./parsers/index.js";
import type { CodebaseReaderConfig } from "./types.js";

const LARGE_FILE_LINES = 200; // files over this many lines get outline treatment

export interface SmartReadDeps {
  isEnabled: () => boolean;
  getConfig: () => CodebaseReaderConfig;
}

export function registerReadTool(pi: ExtensionAPI, deps: SmartReadDeps): void {
  pi.registerTool({
    name: "read",
    label: "Read",
    description:
      "Read the contents of a file or list a directory. " +
      "For small files returns the full content. " +
      "For large files (supported languages: JavaScript, TypeScript, TSX, Python, Go, Rust) " +
      "returns an AST structural outline with line ranges so you can request specific sections. " +
      "For directories, lists entries with size and modified time. " +
      "Use offset/limit to read specific line ranges, or read the full file by omitting them.",
    promptSnippet: "Read files with smart AST outlining for large codebases; list directories",
    promptGuidelines: [
      "Use smart read for all file reading. For large files in supported languages, you'll get a structural outline instead of full content — request specific line ranges with offset/limit to drill down.",
      "Reading a directory path returns a listing of its contents with file sizes and modified times.",
    ],
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the file or directory to read.",
      }),
      offset: Type.Optional(
        Type.Number({
          description: "Line number (1-indexed) to start reading from.",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of lines to read.",
        }),
      ),
    }),
    renderShell: "self" as const,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const config = deps.getConfig();
      const enabled = deps.isEnabled();

      const filePath = params.path;
      const offset = params.offset;
      const limit = params.limit;

      // Resolve path
      const resolvedPath = resolvePath(filePath, ctx.cwd);

      if (!resolvedPath || !existsSync(resolvedPath)) {
        const doSuggest = config.general.suggest_similar !== false;
        const suggestions = doSuggest
          ? suggestSimilarPaths(resolvedPath, filePath)
          : [];
        let msg = `File not found: ${filePath}`;
        if (suggestions.length > 0) {
          msg += `\n\nDid you mean?\n${suggestions.map((s) => `  ${s.display}`).join("\n")}`;
        }
        return textResult(msg);
      }

      // If path is a directory, list its contents
      if (statSync(resolvedPath).isDirectory()) {
        return listDirectory(resolvedPath, filePath);
      }

      // If offset/limit is specified, this is a section drill-down — read raw lines
      if (offset != null || limit != null) {
        return readFileRange(resolvedPath, filePath, offset, limit);
      }

      // Read the file
      let content: string;
      try {
        content = readFileSync(resolvedPath, "utf-8");
      } catch (err) {
        return textResult(
          `Error reading ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const lines = content.split("\n");
      const lineCount = lines.length;
      const tokens = estimateCodeTokens(content);

      // Small file or disabled → return full content
      if (!enabled || lineCount <= LARGE_FILE_LINES) {
        return fullContentResult(resolvedPath, filePath, content, lineCount, tokens);
      }

      // Detect language
      const lang = detectLanguage(filePath);

      // Unsupported language → show size info + first/last lines
      if (!lang) {
        return unsupportedLanguageResult(
          filePath,
          content,
          lineCount,
          tokens,
        );
      }

      // Parse with AST
      try {
        const { symbols, languageName } = await parseSourceFile(
          filePath,
          content,
        );

        const { outline, depth } = generateOutline(symbols, {
          thresholdTokens: config.general.threshold_tokens,
          maxDepth: config.parsing.max_outline_depth,
          totalLines: lineCount,
          totalTokens: tokens,
          filePath,
          languageName,
        });

        return textResult(outline);
      } catch (parseErr) {
        // Parse failed — fall back to simple preview
        console.warn(
          `[codebase-reader] AST parse failed for ${filePath}, falling back:`,
          parseErr instanceof Error ? parseErr.message : String(parseErr),
        );
        return unsupportedLanguageResult(filePath, content, lineCount, tokens);
      }
    },
  });
}

// ---- Helpers ----

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {} as const,
  };
}

function fullContentResult(
  resolvedPath: string,
  displayPath: string,
  content: string,
  lineCount: number,
  tokens: number,
) {
  // Include a small header
  const header = `📄 ${displayPath} — ${lineCount} lines, ~${formatTokenCount(tokens)} tokens\n\n`;
  return textResult(header + content);
}

function unsupportedLanguageResult(
  filePath: string,
  content: string,
  lineCount: number,
  tokens: number,
) {
  const lines = content.split("\n");
  const estTokens = estimateCodeTokens(content);

  // Show first 20 and last 10 lines as a preview
  const head = lines.slice(0, 20);
  const tail = lines.slice(-10);
  const preview = [
    `${filePath} — ${lineCount} lines, ~${formatTokenCount(estTokens)} tokens (unsupported language)`,
    ``,
    `First ${head.length} lines:`,
    ...head.map((l, i) => `${i + 1} │ ${l}`),
    tail.length > 0 && lines.length > 30 ? `  ... (${lineCount - head.length - tail.length} more lines)` : "",
    tail.length > 0 && lines.length > 20 ? `Last ${tail.length} lines:` : "",
    ...(tail.length > 0 && lines.length > 20
      ? tail.map((l, i) => `${lineCount - tail.length + i + 1} │ ${l}`)
      : []),
    ``,
    `Use read with offset/limit to view specific sections.`,
  ]
    .filter(Boolean)
    .join("\n");

  return textResult(preview);
}

async function readFileRange(
  resolvedPath: string,
  displayPath: string,
  offset: number | undefined,
  limit: number | undefined,
) {
  let content: string;
  try {
    content = readFileSync(resolvedPath, "utf-8");
  } catch (err) {
    return textResult(
      `Error reading ${displayPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const lines = content.split("\n");
  const startLine = offset ? Math.max(1, offset) : 1;
  const endLine = limit
    ? Math.min(lines.length, startLine + limit - 1)
    : lines.length;

  const selected = lines.slice(startLine - 1, endLine);
  const result = selected
    .map((l, i) => `${startLine + i} │ ${l}`)
    .join("\n");

  return textResult(
    `${displayPath} lines ${startLine}-${endLine} (${selected.length} lines)\n\n${result}`,
  );
}

/** Format a file size in human-readable form. */
function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Format a Date into a compact timestamp string. */
function formatTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Read a directory and return a listing of its contents.
 * Sorted: directories first, then files, both alphabetically.
 */
function listDirectory(resolvedPath: string, displayPath: string) {
  let entries: string[];
  try {
    entries = readdirSync(resolvedPath);
  } catch (err) {
    return textResult(
      `Error reading directory ${displayPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Build entry info with stats
  type Entry = { name: string; isDir: boolean; size: number; mtime: Date };
  const items: Entry[] = [];
  let subdirCount = 0;

  for (const name of entries) {
    try {
      const full = join(resolvedPath, name);
      const st = statSync(full);
      items.push({
        name,
        isDir: st.isDirectory(),
        size: st.size,
        mtime: st.mtime,
      });
      if (st.isDirectory()) subdirCount++;
    } catch {
      // Skip entries we can't stat
    }
  }

  // Sort: directories first, then files; alphabetical within each group
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  const total = items.length;

  lines.push(`${displayPath}/ — ${total} entries`);

  // Header row
  const nameW = Math.min(40, Math.max(4, ...items.map((e) => e.name.length + (e.isDir ? 1 : 0))));

  const padName = (s: string) => s.padEnd(nameW);
  const padType = (s: string) => s.padEnd(6);
  const padSize = (s: string) => s.padStart(8);

  lines.push(
    `  ${padName("Name")}  ${padType("Type")}  ${padSize("Size")}  Modified`,
  );
  lines.push(
    `  ${padName("").replace(/ /g, "-")}  ${padType("").replace(/ /g, "-")}  ${padSize("").replace(/ /g, "-")}  ${padName("").replace(/ /g, "-")}`,
  );

  for (const entry of items) {
    const name = entry.isDir ? `${entry.name}/` : entry.name;
    const type = entry.isDir ? "dir" : "file";
    const size = entry.isDir ? "--" : formatFileSize(entry.size);
    const time = formatTime(entry.mtime);
    lines.push(`  ${padName(name)}  ${padType(type)}  ${padSize(size)}  ${time}`);
  }

  return textResult(lines.join("\n"));
}

function resolvePath(filePath: string, cwd: string): string | null {
  if (filePath.startsWith("/")) return filePath;
  if (filePath.startsWith("~/")) {
    return filePath.replace("~", homedir());
  }
  return resolve(cwd, filePath);
}
