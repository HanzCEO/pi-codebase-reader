/**
 * SHERLOC-specific types.
 *
 * Structured diagnostic finding with 5 fields, locations, and
 * supporting data structures for the tool suite.
 */

/** Source-code import reference extracted via tree-sitter. */
export interface ImportInfo {
  /** Module/file path being imported (e.g. "./foo", "react", "os"). */
  source: string;
  /** Names brought into scope (empty for side-effect imports). */
  names: string[];
  /** 1-indexed line number. */
  lineNumber: number;
}

/** A single file's imports and reverse-imports. */
export interface FileImports {
  filePath: string;
  imports: ImportInfo[];
  importedBy: string[]; // files that import this file
}

/** A predicted code location. */
export interface SherlocLocation {
  filePath: string;
  startLine: number;
  endLine: number;
}

/** Structured diagnostic finding (5 fields). */
export interface SherlocFinding {
  locationExplanation: string;
  rootCause: string;
  solutionIdea: string;
  dependencies: string;
  testingImpact: string;
}

/** SHERLOC final output. */
export interface SherlocResult {
  findings: SherlocFinding;
  locations: SherlocLocation[];
}

/** Quality-judge score dimensions (1-5). */
export interface JudgeScores {
  rootCause: number;
  locationAccuracy: number;
  solutionActionability: number;
  reasoning: string;
}

/** Result from the quality judge. */
export interface JudgeResult {
  composite: number;
  scores: JudgeScores;
}

/** State tracked by the self-recovery layer. */
export interface RecoveryState {
  /** History of tool calls for loop detection. */
  toolCallHistory: Array<{ name: string; params: Record<string, unknown> }>;
  /** Max repeated identical calls before warning. */
  loopThreshold: number;
  /** Maximum conversation turns before final-turn prompt. */
  maxTurns: number;
  /** Current turn count. */
  turnCount: number;
}
