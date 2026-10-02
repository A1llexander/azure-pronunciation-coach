import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SAMPLES, findSample } from "../src/samples.js";
import { LOCALES, MAX_REFERENCE_CHARS, MAX_RECORDING_MS, READING_WORDS_PER_MINUTE } from "../src/config.js";
import { estimateReadingMs } from "../src/assessment.js";

describe("samples", () => {
  test("every supported language has samples", () => {
    for (const locale of LOCALES) assert.ok(SAMPLES[locale]?.length > 0, locale);
  });

  test("each sample fits the text limit and the 2-minute recording", () => {
    for (const list of Object.values(SAMPLES)) {
      for (const s of list) {
        assert.ok(s.text.length <= MAX_REFERENCE_CHARS, s.id);
        assert.ok(estimateReadingMs(s.text, READING_WORDS_PER_MINUTE) < MAX_RECORDING_MS, s.id);
      }
    }
  });

  test("ids are unique; findSample recognizes an unchanged sample only", () => {
    const ids = Object.values(SAMPLES).flat().map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    const first = SAMPLES["es-ES"][0];
    assert.deepEqual(findSample(`  ${first.text}\n`), { locale: "es-ES", id: first.id });
    assert.equal(findSample(first.text + " extra"), null);
  });
});
