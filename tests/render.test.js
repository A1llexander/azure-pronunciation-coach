import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreBand, scoreRows } from "../src/render.js";

describe("scoreBand (spec color bands)", () => {
  test("0–59 poor, 60–79 fair, 80–100 good", () => {
    assert.equal(scoreBand(0), "poor");
    assert.equal(scoreBand(59), "poor");
    assert.equal(scoreBand(60), "fair");
    assert.equal(scoreBand(79), "fair");
    assert.equal(scoreBand(80), "good");
    assert.equal(scoreBand(100), "good");
  });
});

describe("scoreRows (Prosody rule)", () => {
  const base = { accuracy: 90, fluency: 80, completeness: 70 };

  test("prosody present -> four rows", () => {
    assert.deepEqual(scoreRows({ ...base, prosody: 65 }).map((r) => r.label), ["Accuracy", "Fluency", "Completeness", "Prosody"]);
  });

  test("prosody absent -> three rows", () => {
    assert.deepEqual(scoreRows({ ...base, prosody: null }).map((r) => r.label), ["Accuracy", "Fluency", "Completeness"]);
  });
});
