/**
 * Token estimation utilities.
 *
 * Uses a conservative heuristic (~4 chars per token for code, ~5 for prose)
 * to estimate whether an outline or file content fits within the threshold.
 * Not exact but good enough for threshold gating — we err on the side of
 * showing the outline when in doubt.
 */

const CODE_CHARS_PER_TOKEN = 4;
const OUTLINE_CHARS_PER_TOKEN = 3; // symbols, brackets, line numbers are terse

/** Estimate token count from raw source code. */
export function estimateCodeTokens(text: string): number {
  return Math.ceil(text.length / CODE_CHARS_PER_TOKEN);
}

/** Estimate token count of an outline string. */
export function estimateOutlineTokens(outline: string): number {
  return Math.ceil(outline.length / OUTLINE_CHARS_PER_TOKEN);
}

/** Human-readable size label. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}K`;
  return `${tokens}`;
}
