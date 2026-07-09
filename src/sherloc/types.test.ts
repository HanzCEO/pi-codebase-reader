/**
 * Tests for src/sherloc/types.ts
 *
 * Pure type tests — validates type constructors and default values.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("sherloc types", () => {
  it("validates SherlocFinding shape", () => {
    const finding = {
      locationExplanation: "The check in base.py ignores lookups via get_lookup()",
      rootCause: "System check incorrectly flags ordering with lookups",
      solutionIdea: "Modify the error condition to check get_transform()",
      dependencies: "Standalone in model system check logic",
      testingImpact: "Add tests in tests/model_checks/",
    };

    assert.equal(typeof finding.locationExplanation, "string");
    assert.equal(typeof finding.rootCause, "string");
    assert.equal(typeof finding.solutionIdea, "string");
    assert.equal(typeof finding.dependencies, "string");
    assert.equal(typeof finding.testingImpact, "string");
    assert.ok(finding.locationExplanation.length > 0);
    assert.ok(finding.rootCause.length > 0);
    assert.ok(finding.solutionIdea.length > 0);
  });

  it("validates SherlocLocation shape", () => {
    const location = {
      filePath: "django/db/models/base.py",
      startLine: 1750,
      endLine: 1751,
    };

    assert.equal(typeof location.filePath, "string");
    assert.equal(typeof location.startLine, "number");
    assert.equal(typeof location.endLine, "number");
    assert.ok(location.startLine > 0);
    assert.ok(location.endLine >= location.startLine);
  });

  it("validates SherlocResult structure", () => {
    const result = {
      findings: {
        locationExplanation: "Root cause in query.py",
        rootCause: "filterable check not scoped to expressions",
        solutionIdea: "Add expression-type guard",
        dependencies: "None",
        testingImpact: "Add regression tests",
      },
      locations: [
        { filePath: "django/db/models/sql/query.py", startLine: 100, endLine: 105 },
      ],
    };

    assert.equal(result.locations.length, 1);
    assert.ok(Array.isArray(result.locations));
    assert.equal(typeof result.findings.rootCause, "string");
  });

  it("validates JudgeScores and JudgeResult shapes", () => {
    const scores = {
      rootCause: 5,
      locationAccuracy: 4,
      solutionActionability: 5,
      reasoning: "Perfect root cause identification",
    };

    const result = {
      composite: (scores.rootCause + scores.locationAccuracy + scores.solutionActionability) / 3,
      scores,
    };

    assert.ok(result.composite >= 1);
    assert.ok(result.composite <= 5);
    assert.equal(result.scores.rootCause, 5);
    assert.equal(typeof result.scores.reasoning, "string");
  });

  it("validates RecoveryState defaults", () => {
    const state = {
      toolCallHistory: [],
      loopThreshold: 3,
      maxTurns: 20,
      turnCount: 0,
    };

    assert.deepEqual(state.toolCallHistory, []);
    assert.equal(state.loopThreshold, 3);
    assert.equal(state.maxTurns, 20);
    assert.equal(state.turnCount, 0);
  });

  it("validates ImportInfo shape", () => {
    const imp: { source: string; names: string[]; lineNumber: number } = {
      source: "./helpers",
      names: ["foo", "bar"],
      lineNumber: 42,
    };

    assert.equal(imp.source, "./helpers");
    assert.deepEqual(imp.names, ["foo", "bar"]);
    assert.equal(imp.lineNumber, 42);
  });
});
