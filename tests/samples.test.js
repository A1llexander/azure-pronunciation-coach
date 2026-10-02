import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TEXTS, isReplaceable } from "../src/samples.js";
import { LOCALES } from "../src/config.js";
import { tokenizeReference } from "../src/assessment.js";

describe("default texts", () => {
  test("every supported language has a short text with pause punctuation", () => {
    for (const locale of LOCALES) {
      const text = DEFAULT_TEXTS[locale];
      const words = tokenizeReference(text).length;
      assert.ok(words >= 20 && words <= 50, `${locale}: ${words} words`);
      assert.match(text, /[,:]/);
    }
  });

  test("only empty or untouched default texts are replaced on language change", () => {
    assert.equal(isReplaceable(""), true);
    assert.equal(isReplaceable(` ${DEFAULT_TEXTS["en-US"]}\n`), true);
    assert.equal(isReplaceable(DEFAULT_TEXTS["es-ES"] + " más"), false);
    assert.equal(isReplaceable("My own text."), false);
  });
});
