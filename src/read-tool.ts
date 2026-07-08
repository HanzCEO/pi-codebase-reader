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

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { estimateCodeTokens, formatTokenCount } from "./token-estimate.js";
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
      "Read the contents of a file. For small files returns the full content. " +
      "For large files (supported languages: JavaScript, TypeScript, TSX, Python, Go, Rust) " +
      "returns an AST structural outline with line ranges so you can request specific sections. " +
      "Use offset/limit to read specific line ranges, or read the full file by omitting them.",
    promptSnippet: "Read files with smart AST outlining for large codebases",
    promptGuidelines: [
      "Use smart read for all file reading. For large files in supported languages, you'll get a structural outline instead of full content — request specific line ranges with offset/limit to drill down.",
    ],
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the file to read.",
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
        return textResult(`File not found: ${filePath}`);
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
    `📄 ${filePath} — ${lineCount} lines, ~${formatTokenCount(estTokens)} tokens (unsupported language)`,
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
    `📄 ${displayPath} lines ${startLine}-${endLine} (${selected.length} lines)\n\n${result}`,
  );
}

function resolvePath(filePath: string, cwd: string): string | null {
  if (filePath.startsWith("/")) return filePath;
  if (filePath.startsWith("~/")) {
    return filePath.replace("~", homedir());
  }
  return resolve(cwd, filePath);
}
