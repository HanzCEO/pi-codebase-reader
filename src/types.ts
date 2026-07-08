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

/** Configuration stored in .toml file. */
export interface CodebaseReaderConfig {
  general: {
    enabled: boolean;
    threshold_tokens: number;
  };
  explorer: {
    model: string;
    thinking: string;
    max_turns: number;
  };
  parsing: {
    max_outline_depth: number;
  };
}

export const DEFAULT_CONFIG: CodebaseReaderConfig = {
  general: {
    enabled: true,
    threshold_tokens: 10_000,
  },
  explorer: {
    model: "anthropic/claude-sonnet-4-20250514",
    thinking: "medium",
    max_turns: 30,
  },
  parsing: {
    max_outline_depth: 10,
  },
};

export interface ExplorerAgentConfig {
  model: string;
  thinking: string;
  maxTurns: number;
}

/** Parsed file info used to decide read strategy. */
export interface FileInfo {
  path: string;
  content: string;
  language: string | null; // null = unknown/not supported
  lineCount: number;
  byteLength: number;
}
