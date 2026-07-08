/**
 * Fuzzy path suggestion engine.
 *
 * When a requested file or directory does not exist, this module walks up
 * the directory tree to find the nearest existing ancestor, scans its
 * entries, and returns the closest matches ranked by Levenshtein distance.
 *
 * For multi-segment paths (e.g. `src/compnents/buton/helper.ts`) the engine
 * recursively deepens: after finding a close directory match it descends
 * into that directory and attempts to correct the next segment, and so on.
 * Branching is bounded to at most 3 candidates per level, and the final
 * result list is capped at 5 suggestions.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

// ---- Levenshtein distance ----

/**
 * Compute the Levenshtein distance between two strings.
 * Returns the minimum number of single-character edits (insertions, deletions,
 * or substitutions) required to transform `a` into `b`.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Use two alternating rows for O(min(m,n)) memory.
  // Ensure the longer string is iterated in the outer loop.
  if (m < n) return levenshtein(b, a);

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ---- Public types ----

export interface Suggestion {
  /** Display-form path (matches the style the user originally typed). */
  display: string;
  /** Levenshtein distance from the requested name (lower = closer). */
  distance: number;
}

/**
 * Given a resolved absolute path that does **not** exist and its user-facing
 * display form, find the nearest existing ancestor directory, scan its
 * entries, and return the top-N closest matches ranked by Levenshtein
 * distance.
 *
 * Returns an empty array when:
 * - `resolvedPath` is null
 * - The path already exists (caller should not have reached here)
 * - No ancestor directory can be found (walk-up reaches root and fails)
 * - The ancestor directory cannot be read (permissions, etc.)
 * - No entries are similar enough (all above the dynamic threshold)
 */
export function suggestSimilarPaths(
  resolvedPath: string | null,
  displayPath: string,
): Suggestion[] {
  if (!resolvedPath) return [];

  // Should not happen — caller should guard with existsSync first —
  // but handle defensively.
  if (existsSync(resolvedPath)) return [];

  // ---- Walk up to find the nearest existing ancestor ----
  let ancestor = dirname(resolvedPath);
  let foundAncestor = false;

  while (true) {
    if (existsSync(ancestor)) {
      foundAncestor = true;
      break;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break; // filesystem root reached — still missing
    ancestor = parent;
  }

  if (!foundAncestor) return [];

  // ---- Determine the missing segments below the ancestor ----
  const relPath = relative(ancestor, resolvedPath);
  if (!relPath) return [];

  const segments = relPath.split(sep).filter(Boolean);
  if (segments.length === 0) return [];

  // ---- Compute the display form of the ancestor ----
  const displayParts = displayPath.split(sep).filter(Boolean);
  const relParts = relPath.split(sep).filter(Boolean);

  const ancestorDisplayParts = displayParts.slice(
    0,
    displayParts.length - relParts.length,
  );

  const prefix = ancestorDisplayParts.join(sep);
  // For absolute paths, restore the leading separator that filter(Boolean) consumed.
  const displayPrefix =
    displayPath.startsWith(sep) && !prefix.startsWith(sep) ? sep + prefix : prefix;

  // ---- Recursively find the best deep-path matches ----
  return findMatchesRecursive(
    ancestor,
    segments,
    displayPrefix,
    0,  // accumulated distance
    3,  // max recursion depth
  );
}

/**
 * Recursive helper: given an existing ancestor directory and path segments
 * that do NOT exist below it, find close-matching entries at each level
 * and return the top complete paths found.
 *
 * At each level the top-3 closest sibling entries are explored (branching
 * factor = 3). Each match is checked: if the remaining segments resolve to
 * an existing path, it is added as a suggestion; if the match is a directory
 * and there are more segments, the search recurses one level deeper.
 *
 * @param ancestorAbs   Absolute path of the current (existing) directory.
 * @param segments      Remaining path segments to resolve.
 * @param displayPrefix Display form of ancestorAbs (same style as user input).
 * @param accumulatedDistance Sum of Levenshtein distances from parent matches.
 * @param maxDepth      Remaining recursion depth.
 */
function findMatchesRecursive(
  ancestorAbs: string,
  segments: string[],
  displayPrefix: string,
  accumulatedDistance: number,
  maxDepth: number,
): Suggestion[] {
  if (segments.length === 0 || maxDepth <= 0) return [];

  const firstMissing = segments[0];
  const restSegments = segments.slice(1);

  // ---- List entries in the current directory ----
  let entries: string[];
  try {
    entries = readdirSync(ancestorAbs);
  } catch {
    return [];
  }

  if (entries.length === 0) return [];

  // ---- Score entries by Levenshtein distance ----
  const lowerTarget = firstMissing.toLowerCase();
  const threshold = Math.max(2, Math.ceil(firstMissing.length * 0.4));

  const scored: Array<{ name: string; distance: number; isDir: boolean }> = [];

  for (const entry of entries) {
    const lowerDist = levenshtein(lowerTarget, entry.toLowerCase());
    const originalDist = levenshtein(firstMissing, entry);
    const dist = lowerDist === 0 && originalDist > 0 ? originalDist : lowerDist;

    if (dist > 0 && dist <= threshold) {
      try {
        const st = statSync(join(ancestorAbs, entry));
        scored.push({ name: entry, distance: dist, isDir: st.isDirectory() });
      } catch {
        // Skip entries we can't stat
      }
    }
  }

  if (scored.length === 0) return [];

  // Take top 3 at each level to bound branching
  scored.sort((a, b) => a.distance - b.distance);
  const top = scored.slice(0, 3);

  const results: Suggestion[] = [];

  for (const match of top) {
    const totalDist = accumulatedDistance + match.distance;

    // Build the candidate absolute path
    const candidateAbs = join(ancestorAbs, match.name, ...restSegments);

    // Build the display path for this candidate
    const childDisplay = displayPrefix
      ? `${displayPrefix}/${match.name}`
      : match.name;
    const candidateDisplay =
      restSegments.length > 0
        ? `${childDisplay}/${restSegments.join("/")}`
        : childDisplay;

    if (existsSync(candidateAbs)) {
      // Found a valid path — add as suggestion
      results.push({ display: candidateDisplay, distance: totalDist });
    } else if (restSegments.length > 0 && match.isDir && maxDepth > 1) {
      // Recurse deeper into this matched directory
      const deeper = findMatchesRecursive(
        join(ancestorAbs, match.name),
        restSegments,
        childDisplay,
        totalDist,
        maxDepth - 1,
      );
      results.push(...deeper);
    }
  }

  if (results.length === 0) return [];

  // Sort by distance (closest first), deduplicate, cap at 5
  results.sort((a, b) => a.distance - b.distance);
  const seen = new Set<string>();
  return results
    .filter((s) => {
      if (seen.has(s.display)) return false;
      seen.add(s.display);
      return true;
    })
    .slice(0, 5);
}
