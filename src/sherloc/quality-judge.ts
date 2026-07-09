/**
 * SHERLOC Quality Judge — optional LLM-as-judge scorer for findings.
 *
 * An optional pipeline step that scores diagnostic findings on three
 * dimensions (1-5 scale):
 *   1. Root Cause Correctness
 *   2. Location Accuracy
 *   3. Solution Actionability
 *
 * The composite score is the mean of the three dimensions.
 * A threshold of >= 4.0 indicates high quality.
 *
 * This is designed to be invoked as a command or as a standalone
 * pipeline step after SHERLOC localization completes.
 */

import type { SherlocFinding, SherlocLocation, JudgeResult, JudgeScores } from "./types.js";

/**
 * Judge prompt template.
 * Injects the issue description, ground-truth patch, finding, and locations.
 */
export function buildJudgePrompt(params: {
  problemStatement: string;
  gtPatch?: string;
  finding: SherlocFinding;
  locations: SherlocLocation[];
}): string {
  return `You are evaluating the quality of a bug localization analysis ("finding") for a software issue.

## Issue Description
${params.problemStatement}

## Ground Truth Patch (what actually fixed the issue)
${params.gtPatch || "(not available — score purely from the finding's internal consistency)"}

## Finding to Evaluate
Location explanation: ${params.finding.locationExplanation}
Root cause: ${params.finding.rootCause}
Solution idea: ${params.finding.solutionIdea}
Dependencies: ${params.finding.dependencies}
Testing impact: ${params.finding.testingImpact}

## Predicted Locations
${params.locations.map((l) => `- ${l.filePath} lines ${l.startLine}-${l.endLine}`).join("\n")}

Rate the finding on these dimensions (1-5 scale):

1. Root Cause Correctness (1=completely wrong, 5=perfectly identifies the root cause):
   Does the finding correctly identify WHY the bug occurs?

2. Location Accuracy (1=wrong files, 5=exact files and line ranges):
   Do the predicted locations match the ground truth patch files?

3. Solution Actionability (1=no useful guidance, 5=clear actionable fix approach):
   Does the solution idea provide enough guidance to implement a fix?

Respond in this exact JSON format:
{"root_cause": <1-5>, "location_accuracy": <1-5>, "solution_actionability": <1-5>, "reasoning": "<brief explanation>"}`;
}

/**
 * Parse a judge JSON response into structured scores.
 */
export function parseJudgeResponse(
  response: string,
): JudgeScores | null {
  try {
    // Try to extract a JSON object from the response
    const jsonMatch = response.match(/\{[^]*"root_cause"[^]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      rootCause: clampScore(parsed.root_cause),
      locationAccuracy: clampScore(parsed.location_accuracy),
      solutionActionability: clampScore(parsed.solution_actionability),
      reasoning: parsed.reasoning || "",
    };
  } catch {
    return null;
  }
}

/**
 * Compute composite score from individual scores.
 */
export function computeComposite(scores: JudgeScores): number {
  return (scores.rootCause + scores.locationAccuracy + scores.solutionActionability) / 3;
}

/**
 * Clamp a score to 1-5 range.
 */
function clampScore(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)));
}

/**
 * Build a formatted judge result string.
 */
export function formatJudgeResult(result: JudgeResult): string {
  const quality =
    result.composite >= 4.0
      ? "HIGH"
      : result.composite >= 3.0
        ? "MEDIUM"
        : result.composite >= 2.0
          ? "LOW"
          : "VERY LOW";

  return [
    `Finding Quality: ${quality} (composite: ${result.composite.toFixed(2)}/5.0)`,
    `  Root Cause Correctness:     ${result.scores.rootCause}/5`,
    `  Location Accuracy:          ${result.scores.locationAccuracy}/5`,
    `  Solution Actionability:     ${result.scores.solutionActionability}/5`,
    `  Reasoning: ${result.scores.reasoning}`,
  ].join("\n");
}

/**
 * Determine whether a finding passes the quality filter.
 * Default threshold: >= 4.0 (composite score).
 */
export function passesQualityFilter(
  result: JudgeResult,
  threshold: number = 4.0,
): boolean {
  return result.composite >= threshold;
}
