/**
 * Tests for src/sherloc/quality-judge.ts
 *
 * Pure function tests — no mocking or LLM calls involved.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildJudgePrompt,
  parseJudgeResponse,
  computeComposite,
  formatJudgeResult,
  passesQualityFilter,
} from "./quality-judge.js";
import type { SherlocFinding, SherlocLocation, JudgeScores } from "./types.js";

const sampleFinding: SherlocFinding = {
  locationExplanation: "The check in base.py ignores get_lookup()",
  rootCause: "System check incorrectly flags ordering with lookups",
  solutionIdea: "Modify the error condition to check get_transform()",
  dependencies: "Standalone in model system check logic",
  testingImpact: "Add tests in tests/model_checks/",
};

const sampleLocations: SherlocLocation[] = [
  { filePath: "django/db/models/base.py", startLine: 1750, endLine: 1751 },
];

// ========================================================================
// buildJudgePrompt
// ========================================================================

describe("buildJudgePrompt", () => {
  it("includes the issue description", () => {
    const prompt = buildJudgePrompt({
      problemStatement: "E015 raised for ordering with lookups",
      finding: sampleFinding,
      locations: sampleLocations,
    });
    assert.ok(prompt.includes("E015 raised for ordering"), "should contain issue");
    assert.ok(prompt.includes("Root cause:"), "should have root cause section");
    assert.ok(prompt.includes("Location explanation:"), "should have location section");
    assert.ok(prompt.includes("django/db/models/base.py"), "should contain file path");
  });

  it("includes ground truth patch when provided", () => {
    const prompt = buildJudgePrompt({
      problemStatement: "Bug report",
      gtPatch: "--- a/base.py\n+++ b/base.py\n@@ -1750 +1750 @@",
      finding: sampleFinding,
      locations: sampleLocations,
    });
    assert.ok(prompt.includes("Ground Truth Patch"), "should mention GT patch");
    assert.ok(prompt.includes("+++ b/base.py"), "should contain patch content");
  });

  it("indicates when GT patch is unavailable", () => {
    const prompt = buildJudgePrompt({
      problemStatement: "Bug report",
      finding: sampleFinding,
      locations: sampleLocations,
    });
    assert.ok(
      prompt.includes("not available"),
      "should indicate GT patch is missing",
    );
  });

  it("lists all 3 scoring dimensions", () => {
    const prompt = buildJudgePrompt({
      problemStatement: "Bug",
      finding: sampleFinding,
      locations: sampleLocations,
    });
    assert.ok(prompt.includes("Root Cause Correctness"), "dimension 1");
    assert.ok(prompt.includes("Location Accuracy"), "dimension 2");
    assert.ok(prompt.includes("Solution Actionability"), "dimension 3");
  });

  it("requests JSON output format", () => {
    const prompt = buildJudgePrompt({
      problemStatement: "Bug",
      finding: sampleFinding,
      locations: sampleLocations,
    });
    assert.ok(prompt.includes('"root_cause"'), "should specify JSON key");
    assert.ok(prompt.includes('"location_accuracy"'), "should specify JSON key");
    assert.ok(prompt.includes('"solution_actionability"'), "should specify JSON key");
  });
});

// ========================================================================
// parseJudgeResponse
// ========================================================================

describe("parseJudgeResponse", () => {
  it("parses a valid JSON response", () => {
    const response = '{"root_cause": 5, "location_accuracy": 4, "solution_actionability": 5, "reasoning": "Great finding"}';
    const result = parseJudgeResponse(response);
    assert.ok(result, "should parse successfully");
    assert.equal(result!.rootCause, 5);
    assert.equal(result!.locationAccuracy, 4);
    assert.equal(result!.solutionActionability, 5);
    assert.equal(result!.reasoning, "Great finding");
  });

  it("extracts JSON from text with surrounding content", () => {
    const response = `Here are my ratings:
{"root_cause": 4, "location_accuracy": 3, "solution_actionability": 4, "reasoning": "Good but not perfect"}
That's my analysis.`;
    const result = parseJudgeResponse(response);
    assert.ok(result, "should extract JSON");
    assert.equal(result!.rootCause, 4);
  });

  it("clamps scores to 1-5 range", () => {
    const response = '{"root_cause": 0, "location_accuracy": 6, "solution_actionability": 3, "reasoning": "test"}';
    const result = parseJudgeResponse(response);
    assert.ok(result);
    assert.equal(result!.rootCause, 1, "0 should clamp to 1");
    assert.equal(result!.locationAccuracy, 5, "6 should clamp to 5");
  });

  it("returns null for non-JSON responses", () => {
    assert.equal(parseJudgeResponse("I cannot rate this"), null);
    assert.equal(parseJudgeResponse(""), null);
    assert.equal(parseJudgeResponse("{}"), null); // missing required keys
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseJudgeResponse('{"root_cause": broken'), null);
  });

  it("rounds fractional scores to integers", () => {
    const response = '{"root_cause": 4.2, "location_accuracy": 3.7, "solution_actionability": 5.0, "reasoning": "ok"}';
    const result = parseJudgeResponse(response);
    assert.ok(result);
    assert.equal(result!.rootCause, 4);
    assert.equal(result!.locationAccuracy, 4);
    assert.equal(result!.solutionActionability, 5);
  });
});

// ========================================================================
// computeComposite
// ========================================================================

describe("computeComposite", () => {
  it("computes mean of three scores", () => {
    const scores: JudgeScores = {
      rootCause: 5,
      locationAccuracy: 4,
      solutionActionability: 3,
      reasoning: "",
    };
    const composite = computeComposite(scores);
    assert.equal(composite, 4); // (5+4+3)/3 = 4
  });

  it("handles perfect scores", () => {
    const scores: JudgeScores = {
      rootCause: 5,
      locationAccuracy: 5,
      solutionActionability: 5,
      reasoning: "",
    };
    assert.equal(computeComposite(scores), 5);
  });

  it("handles minimum scores", () => {
    const scores: JudgeScores = {
      rootCause: 1,
      locationAccuracy: 1,
      solutionActionability: 1,
      reasoning: "",
    };
    assert.equal(computeComposite(scores), 1);
  });

  it("produces fractional results", () => {
    const scores: JudgeScores = {
      rootCause: 4,
      locationAccuracy: 4,
      solutionActionability: 5,
      reasoning: "",
    };
    const comp = computeComposite(scores);
    assert.equal(comp, (4 + 4 + 5) / 3);
  });
});

// ========================================================================
// formatJudgeResult
// ========================================================================

describe("formatJudgeResult", () => {
  it("formats high-quality findings", () => {
    const result = {
      composite: 4.67,
      scores: {
        rootCause: 5,
        locationAccuracy: 4,
        solutionActionability: 5,
        reasoning: "Excellent root cause identification",
      },
    };
    const text = formatJudgeResult(result);
    assert.ok(text.includes("HIGH"), "should label as HIGH");
    assert.ok(text.includes("4.67"), "should include composite score");
    assert.ok(text.includes("Root Cause Correctness:"), "should include per-dimension scores");
    assert.ok(text.includes("Excellent"), "should include reasoning");
  });

  it("formats low-quality findings", () => {
    const result = {
      composite: 1.33,
      scores: {
        rootCause: 2,
        locationAccuracy: 1,
        solutionActionability: 1,
        reasoning: "Wrong file entirely",
      },
    };
    const text = formatJudgeResult(result);
    assert.ok(text.includes("LOW"), "should label as LOW");
    assert.ok(text.includes("1.33"), "should include composite score");
  });

  it("formats medium-quality findings", () => {
    const result = {
      composite: 3.0,
      scores: {
        rootCause: 3,
        locationAccuracy: 3,
        solutionActionability: 3,
        reasoning: "Average",
      },
    };
    const text = formatJudgeResult(result);
    assert.ok(text.includes("MEDIUM"), "should label as MEDIUM");
  });
});

// ========================================================================
// passesQualityFilter
// ========================================================================

describe("passesQualityFilter", () => {
  it("passes findings at or above default threshold (4.0)", () => {
    const high = { composite: 4.0, scores: { rootCause: 5, locationAccuracy: 4, solutionActionability: 3, reasoning: "" } };
    const perfect = { composite: 5.0, scores: { rootCause: 5, locationAccuracy: 5, solutionActionability: 5, reasoning: "" } };
    assert.ok(passesQualityFilter(high), "4.0 should pass");
    assert.ok(passesQualityFilter(perfect), "5.0 should pass");
  });

  it("fails findings below default threshold", () => {
    const low = { composite: 3.99, scores: { rootCause: 4, locationAccuracy: 4, solutionActionability: 3, reasoning: "" } };
    assert.ok(!passesQualityFilter(low), "3.99 should fail");
  });

  it("respects custom threshold", () => {
    const med = { composite: 3.5, scores: { rootCause: 4, locationAccuracy: 3, solutionActionability: 3, reasoning: "" } };
    assert.ok(passesQualityFilter(med, 3.0), "should pass with lower threshold");
    assert.ok(!passesQualityFilter(med, 4.0), "should fail with higher threshold");
  });
});
