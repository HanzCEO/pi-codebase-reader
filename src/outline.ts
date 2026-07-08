/**
 * Outline generation from parsed SymbolInfo[].
 *
 * Renders a token-efficient structural outline following the Sweep blog post format:
 *   (N children) [start:end]
 *
 * Adaptive depth: start unlimited, cap at threshold_tokens, reduce depth by 1
 * until the outline fits, min depth = 1.
 */

import type { SymbolInfo } from "./types.js";
import { estimateOutlineTokens } from "./token-estimate.js";

const INDENT = "  ";
const BRANCH = "├── ";
const LAST_BRANCH = "└── ";
const PIPE = "│   ";
const SPACE = "    ";

/** Outline rendering options. */
export interface OutlineOptions {
  /** Token budget for the outline (will reduce depth to fit). */
  thresholdTokens: number;
  /** Absolute max depth (clamped by adaptive algorithm). */
  maxDepth: number;
  /** Total lines in the file. */
  totalLines: number;
  /** Estimated tokens in the full file. */
  totalTokens: number;
  /** File path for the header. */
  filePath: string;
  /** Display language name. */
  languageName?: string;
}

/** Rendered outline result. */
export interface OutlineResult {
  outline: string;
  depth: number;
  tokens: number;
}

/**
 * Generate a file outline with adaptive depth.
 *
 * Algorithm (from Sweep blog post):
 * 1. Generate full outline at unlimited depth
 * 2. Estimate token cost
 * 3. If under threshold → done
 * 4. If over → regenerate at depth cap, reduce by 1 until it fits
 */
export function generateOutline(
  symbols: SymbolInfo[],
  options: OutlineOptions,
): OutlineResult {
  const { thresholdTokens, totalLines, totalTokens, filePath, languageName } =
    options;

  // Try depths from unlimited down to 1
  for (let depth = options.maxDepth; depth >= 1; depth--) {
    const rendered = renderOutline(symbols, depth, totalLines, totalTokens, filePath, languageName);
    const tokens = estimateOutlineTokens(rendered);

    if (tokens <= thresholdTokens || depth === 1) {
      return { outline: rendered, depth, tokens };
    }
  }

  // Fallback: depth 1
  const rendered = renderOutline(symbols, 1, totalLines, totalTokens, filePath, languageName);
  return {
    outline: rendered,
    depth: 1,
    tokens: estimateOutlineTokens(rendered),
  };
}

// ---- Rendering ----

function renderOutline(
  symbols: SymbolInfo[],
  maxDepth: number,
  totalLines: number,
  totalTokens: number,
  filePath: string,
  languageName?: string,
): string {
  const lines: string[] = [];

  // Header
  const langTag = languageName ? ` (${languageName})` : "";
  const fileLabel = filePath.split("/").pop() || filePath;
  lines.push(
    `${fileLabel}${langTag} — ${totalLines} lines, ~${formatTokens(totalTokens)} tokens`,
  );

  if (symbols.length === 0) {
    lines.push(`  (no parseable symbols at depth ${maxDepth})`);
    return lines.join("\n");
  }

  renderSymbolList(symbols, 0, maxDepth, "", lines);

  // Footer hint
  if (maxDepth < 10) {
    lines.push(
      `\nUse read with offset/limit to view specific sections. ` +
      `Symbols shown at depth ${maxDepth}. Request "read(path, offset, limit)" for any range above.`,
    );
  }

  return lines.join("\n");
}

function renderSymbolList(
  symbols: SymbolInfo[],
  depth: number,
  maxDepth: number,
  prefix: string,
  lines: string[],
): void {
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const isLast = i === symbols.length - 1;
    const connector = isLast ? LAST_BRANCH : BRANCH;
    const childPrefix = isLast ? prefix + SPACE : prefix + PIPE;

    const symbolLine = formatSymbolLine(symbol, connector, depth);
    lines.push(prefix + symbolLine);

    // Recurse into children if within depth
    if (
      symbol.children &&
      symbol.children.length > 0 &&
      depth < maxDepth
    ) {
      renderSymbolList(symbol.children, depth + 1, maxDepth, childPrefix, lines);
    } else if (symbol.children && symbol.children.length > 0 && depth >= maxDepth) {
      // Show child count as hint
      lines.push(
        childPrefix +
          `(${symbol.children.length} nested items)`,
      );
    }
  }
}

function formatSymbolLine(
  symbol: SymbolInfo,
  connector: string,
  _depth: number,
): string {
  const range = `[${symbol.startLine}:${symbol.endLine}]`;

  let label = `${symbol.type} ${symbol.name}`;

  // Add parameters/detail
  if (symbol.detail) {
    // Truncate very long details
    const detail = symbol.detail.length > 60
      ? symbol.detail.slice(0, 57) + "..."
      : symbol.detail;
    label += detail;
  }

  // Add child count
  const childCount = symbol.children?.length ?? 0;
  const childInfo =
    childCount > 0 ? ` (${childCount} children)` : "";

  return `${connector}${label}${childInfo} ${range}`;
}

function typeIcon(_type: string): string {
  return "";
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}K`;
  return `${tokens}`;
}
