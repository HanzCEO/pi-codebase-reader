/** A single structural symbol extracted from source code. */
export interface SymbolInfo {
  name: string;
  type: string; // e.g. "class", "function", "method", "interface", "enum", "trait"
  startLine: number; // 1-indexed
  endLine: number;
  children?: SymbolInfo[];
  detail?: string; // optional extra info (e.g. parameters, visibility)
}

/** Result of parsing a source file. */
export interface ParseResult {
  symbols: SymbolInfo[];
}

/** Information about a single import/require statement. */
export interface ImportInfo {
  source: string;
  names: string[];
  lineNumber: number;
}

/** Configuration stored in .toml file. */
export interface CodebaseReaderConfig {
  general: {
    enabled: boolean;
    threshold_tokens: number;
    suggest_similar: boolean;
  };
  explorer: {
    model: string;
    thinking: string;
    max_turns: number;
  };
  parsing: {
    max_outline_depth: number;
  };
  /**
   * Optional subagent library preference.
   * One of "@tintinweb/pi-subagents", "pi-subagents" (nicobailon), or "" (auto-detect).
   * Used for informational logging and to guide install instructions.
   */
  subagent?: {
    library: string;
  };
}

export const DEFAULT_CONFIG: CodebaseReaderConfig = {
  general: {
    enabled: true,
    threshold_tokens: 10_000,
    suggest_similar: true,
  },
  explorer: {
    model: "anthropic/claude-sonnet-4-20250514",
    thinking: "medium",
    max_turns: 30,
  },
  parsing: {
    max_outline_depth: 10,
  },
  subagent: {
    library: "",
  },
};

export interface ExplorerAgentConfig {
  model: string;
  thinking: string;
  maxTurns: number;
  /** When true, register the tool as `short_read` instead of `read` (for pi-hashline-edit-pro compatibility). */
  useShortRead?: boolean;
}

/** Parsed file info used to decide read strategy. */
export interface FileInfo {
  path: string;
  content: string;
  language: string | null; // null = unknown/not supported
  lineCount: number;
  byteLength: number;
}
