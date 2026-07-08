/**
 * Parser dispatcher.
 *
 * Maps file extensions to the appropriate parser, maintaining a shared
 * tree-sitter parser manager for WASM-based grammars.
 */

import type { SymbolInfo } from "../types.js";
import {
  detectLanguage,
  languageLabel,
  parseCode,
} from "./manager.js";

export { detectLanguage, languageLabel };

export interface ParseFileResult {
  symbols: SymbolInfo[];
  language: string | null;
  languageName: string;
}

/**
 * Parse a source file's content and extract structural symbols.
 * Returns empty symbols array if language is unsupported or parsing fails.
 */
export async function parseSourceFile(
  filePath: string,
  content: string,
): Promise<ParseFileResult> {
  const lang = detectLanguage(filePath);

  if (!lang) {
    return { symbols: [], language: null, languageName: "Unknown" };
  }

  try {
    const symbols = await parseCode(lang, content);
    return { symbols, language: lang, languageName: languageLabel(lang) };
  } catch (err) {
    console.warn(
      `[codebase-reader] Parse failed for ${filePath}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { symbols: [], language: lang, languageName: languageLabel(lang) };
  }
}
