import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeWord,
  tokenizeReference,
  mergeSegments,
  alignWords,
  assess,
  tooltipPhonemes,
  estimateReadingMs,
} from "../src/assessment.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/en-US-continuous-3seg.json", import.meta.url), "utf8"));

/** Minimal Azure segment builder for synthetic cases. Words: [word, accuracy, errorType?]. */
function segment(words, { startTicks = 0, prosody } = {}) {
  let t = startTicks;
  const out = words.map(([word, accuracy, errorType = "None"]) => {
    const w = {
      Word: word,
      Offset: t,
      Duration: 3_000_000,
      PronunciationAssessment: { AccuracyScore: accuracy, ErrorType: errorType },
      Phonemes: [{ Phoneme: "x", PronunciationAssessment: { AccuracyScore: accuracy } }],
    };
    t += 3_100_000;
    return w;
  });
  const pa = { AccuracyScore: 0, FluencyScore: 0, CompletenessScore: 0, PronScore: 0 };
  if (prosody !== undefined) pa.ProsodyScore = prosody;
  return { RecognitionStatus: "Success", NBest: [{ PronunciationAssessment: pa, Words: out }] };
}

const kinds = (result) => result.items.map((it) => `${it.kind}:${it.text}`);

describe("normalizeWord / tokenizeReference", () => {
  test("lowercases and strips edge punctuation, keeps inner apostrophes and hyphens", () => {
    assert.equal(normalizeWord("Street."), "street");
    assert.equal(normalizeWord("«Hola»,"), "hola");
    assert.equal(normalizeWord("Don't"), "don't");
    assert.equal(normalizeWord("well-known"), "well-known");
    assert.equal(normalizeWord("¿Qué?"), "qué");
  });

  test("keeps display spelling and drops punctuation-only tokens", () => {
    assert.deepEqual(tokenizeReference("Hello, world — again."), [
      { display: "Hello,", norm: "hello" },
      { display: "world", norm: "world" },
      { display: "again.", norm: "again" },
    ]);
  });
});

describe("alignWords", () => {
  test("identical lists are all matches", () => {
    assert.deepEqual(alignWords(["a", "b"], ["a", "b"]).map((o) => o.op), ["match", "match"]);
  });

  test("omission, insertion and substitution", () => {
    const ops = alignWords(["a", "b", "c", "d"], ["a", "x", "c", "y", "d"]).map((o) => o.op);
    // b replaced by x -> omit + insert; y inserted.
    assert.deepEqual(ops.filter((o) => o === "match").length, 3);
    assert.deepEqual(ops.filter((o) => o === "omit").length, 1);
    assert.deepEqual(ops.filter((o) => o === "insert").length, 2);
  });

  test("trailing reference words not read are omissions", () => {
    assert.deepEqual(alignWords(["a", "b", "c"], ["a"]).map((o) => o.op), ["match", "omit", "omit"]);
  });

  test("empty inputs", () => {
    assert.deepEqual(alignWords([], []), []);
    assert.deepEqual(alignWords(["a"], []).map((o) => o.op), ["omit"]);
    assert.deepEqual(alignWords([], ["a"]).map((o) => o.op), ["insert"]);
  });
});

describe("mergeSegments", () => {
  test("concatenates segments in time order and keeps segment index", () => {
    const { words } = mergeSegments([segment([["a", 90]]), segment([["b", 80]], { startTicks: 10_000_000 })]);
    assert.deepEqual(words.map((w) => [w.norm, w.segment]), [["a", 0], ["b", 1]]);
  });

  test("ignores Azure Omission/Insertion flags and non-success segments", () => {
    const { words } = mergeSegments([
      segment([["a", 90], ["b", 0, "Omission"], ["c", 50, "Insertion"]]),
      { RecognitionStatus: "NoMatch" },
    ]);
    assert.deepEqual(words.map((w) => w.norm), ["a"]);
  });

  test("flags results that came back without pronunciation assessment", () => {
    const seg = segment([["a", 90]]);
    delete seg.NBest[0].Words[0].PronunciationAssessment;
    const merged = mergeSegments([seg]);
    assert.equal(merged.assessmentMissing, true);
    assert.equal(merged.words[0].accuracy, null);
  });
});

describe("assess: synthetic cases", () => {
  // A substitution is reported omission first, then insertion.
  test("substitution across a segment boundary", () => {
    const result = assess("one two three four five", [
      segment([["one", 95], ["two", 95], ["extra", 90]]),
      segment([["four", 95], ["five", 95]], { startTicks: 20_000_000 }),
    ]);
    assert.deepEqual(kinds(result), [
      "correct:one",
      "correct:two",
      "omitted:three",
      "inserted:extra",
      "correct:four",
      "correct:five",
    ]);
  });

  test("mispronounced: Azure flag or accuracy below threshold", () => {
    const result = assess("alpha beta gamma", [segment([["alpha", 95], ["beta", 70, "Mispronunciation"], ["gamma", 59]])]);
    assert.deepEqual(kinds(result), ["correct:alpha", "mispronounced:beta", "mispronounced:gamma"]);
  });

  test("completeness = correct / reference words; accuracy counts omissions as 0", () => {
    const result = assess("a b c d", [segment([["a", 100], ["b", 100]])]);
    assert.equal(result.scores.completeness, 50);
    assert.equal(result.scores.accuracy, 50);
  });

  test("overall score uses Microsoft's weights with and without prosody", () => {
    const withProsody = assess("a", [segment([["a", 100]], { prosody: 60 })]).scores;
    const sorted = [withProsody.accuracy, withProsody.prosody, withProsody.completeness, withProsody.fluency].sort((x, y) => x - y);
    assert.ok(Math.abs(withProsody.pronunciation - (sorted[0] * 0.4 + (sorted[1] + sorted[2] + sorted[3]) * 0.2)) < 1e-9);

    const noProsody = assess("a", [segment([["a", 100]])]).scores;
    assert.equal(noProsody.prosody, null);
    const s3 = [noProsody.accuracy, noProsody.completeness, noProsody.fluency].sort((x, y) => x - y);
    assert.ok(Math.abs(noProsody.pronunciation - (s3[0] * 0.6 + (s3[1] + s3[2]) * 0.2)) < 1e-9);
  });

  test("no speech: zero scores, every reference word omitted", () => {
    const result = assess("a b", []);
    assert.deepEqual(kinds(result), ["omitted:a", "omitted:b"]);
    assert.equal(result.scores.pronunciation, 0);
  });
});

describe("assess: real en-US fixture (3 segments, stopped mid-text)", () => {
  const result = assess(fixture.referenceText, fixture.segments);

  test("all 58 recognized words are placed exactly once", () => {
    const spoken = result.items.filter((it) => it.spoken).map((it) => it.spoken);
    assert.equal(spoken.length, 58);
    assert.equal(new Set(spoken).size, 58);
    assert.equal(result.assessmentMissing, false);
  });

  test("segment boundary: 'on' heard as 'want' -> 'on' omitted, 'want' inserted", () => {
    const i = result.items.findIndex((it) => it.kind === "inserted" && it.text === "want");
    assert.ok(i > 0, "insertion found");
    assert.equal(result.items[i].spoken.segment, 2);
    assert.deepEqual(
      result.items.slice(i - 2, i + 2).map((it) => `${it.kind}:${it.text}`),
      ["correct:paper.", "omitted:On", "inserted:want", "correct:the"],
    );
  });

  test("Azure's Mispronunciation is kept ('bakery', 39) and 69 is not flagged ('rye')", () => {
    assert.equal(result.items.find((it) => it.text === "bakery").kind, "mispronounced");
    assert.equal(result.items.find((it) => it.text === "rye").kind, "correct");
  });

  test("words after 'students' were not read and are omitted", () => {
    const studentsAt = result.items.findIndex((it) => it.text === "students");
    const tail = result.items.slice(studentsAt + 1);
    assert.ok(tail.length > 50);
    assert.ok(tail.every((it) => it.kind === "omitted"));
  });

  test("Completeness is recomputed from the alignment, not taken from Azure", () => {
    const azure = fixture.segments.map((s) => s.NBest[0].PronunciationAssessment.CompletenessScore);
    assert.deepEqual(azure, [96, 100, 100]);
    assert.ok(result.scores.completeness < 50, `got ${result.scores.completeness}`);
  });

  test("scores are within 0..100 and prosody is the mean of segment prosody", () => {
    for (const [name, value] of Object.entries(result.scores)) {
      assert.ok(value >= 0 && value <= 100, `${name}=${value}`);
    }
    assert.ok(Math.abs(result.scores.prosody - (77.5 + 69.9 + 60.5) / 3) < 1e-9);
  });

  test("en-US phonemes have IPA names and are shown in the tooltip", () => {
    const bakery = result.items.find((it) => it.text === "bakery").spoken;
    assert.deepEqual(tooltipPhonemes(bakery).map((p) => p.name), ["b", "eɪ", "k", "ə", "ɹ", "i"]);
  });
});

describe("tooltipPhonemes", () => {
  const word = (names) => ({ phonemes: names.map((name) => ({ name, accuracy: 80 })) });

  test("hidden when any name is empty (es-ES returns scores without names)", () => {
    assert.deepEqual(tooltipPhonemes(word(["", ""])), []);
    assert.deepEqual(tooltipPhonemes(word(["a", ""])), []);
  });

  test("hidden for omitted words and words without phonemes", () => {
    assert.deepEqual(tooltipPhonemes(null), []);
    assert.deepEqual(tooltipPhonemes(word([])), []);
  });
});

describe("assess: real en-US insertion/omission runs (scripted mode)", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/en-US-insert-omit.json", import.meta.url), "utf8"));
  const run = (k) => assess(fx.referenceText, fx.runs[k].segments);

  test("omission: skipped 'brown' is the only omitted word", () => {
    const omitted = run(2).items.filter((it) => it.kind === "omitted").map((it) => it.text);
    assert.deepEqual(omitted, ["brown"]);
  });

  // In scripted mode Azure maps a word that is not in the reference text onto a
  // reference word ("fresh" -> "wraps", "very" -> "warm"). The position of the
  // extra word is detected, its spelling is not.
  test("insertion: extra word is detected between 'warm' and 'of', spelled as a reference word", () => {
    const items = run(1).items;
    const inserted = items.filter((it) => it.kind === "inserted");
    assert.ok(inserted.length >= 1);
    assert.ok(inserted.every((it) => tokenizeReference(fx.referenceText).some((t) => t.norm === it.spoken.norm)));
    const warm = items.findIndex((it) => it.text === "warm");
    const of = items.findIndex((it) => it.text === "of");
    assert.ok(items.slice(warm + 1, of).some((it) => it.kind === "inserted"));
  });

  test("every recognized word is placed exactly once in all runs", () => {
    for (let k = 0; k < fx.runs.length; k += 1) {
      const recognized = fx.runs[k].segments.flatMap((s) => s.NBest[0].Words).length;
      assert.equal(run(k).items.filter((it) => it.spoken).length, recognized, `run ${k}`);
    }
  });
});

describe("assess: real es-ES fixture (21 segments)", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/es-ES-continuous-21seg.json", import.meta.url), "utf8"));
  const result = assess(fx.referenceText, fx.segments);

  test("phoneme names are empty, so no tooltip phonemes are shown", () => {
    const spoken = result.items.filter((it) => it.spoken);
    assert.ok(spoken.some((it) => it.spoken.phonemes.length > 0));
    assert.ok(spoken.every((it) => tooltipPhonemes(it.spoken).length === 0));
  });

  test("no prosody field, so prosody is null and the 3-score weighting is used", () => {
    assert.equal(result.scores.prosody, null);
    const s = [result.scores.accuracy, result.scores.completeness, result.scores.fluency].sort((a, b) => a - b);
    assert.ok(Math.abs(result.scores.pronunciation - (s[0] * 0.6 + (s[1] + s[2]) * 0.2)) < 1e-9);
  });

  test("skipped 'aire' is omitted and every recognized word is placed once", () => {
    assert.equal(result.items.find((it) => it.text === "aire").kind, "omitted");
    const recognized = fx.segments.flatMap((s) => s.NBest[0].Words).length;
    assert.equal(result.items.filter((it) => it.spoken).length, recognized);
  });
});

describe("estimateReadingMs", () => {
  test("counts words, not punctuation", () => {
    assert.equal(estimateReadingMs("one, two — three!", 60), 3000);
    assert.equal(estimateReadingMs("", 130), 0);
  });
});

describe("prosody marks (en-US fixture)", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/en-US-continuous-3seg.json", import.meta.url), "utf8"));
  const result = assess(fx.referenceText, fx.segments);
  const at = (text, nth = 0) => result.items.filter((it) => it.text === text)[nth];

  test("unexpected pause inside a phrase (Azure confidence > 0.75, no punctuation before)", () => {
    assert.equal(at("at").pauseBefore, "unexpected");
    assert.equal(Math.round(at("at").pauseMs), 350);
  });

  test("a pause after a full stop or comma is not an error", () => {
    assert.equal(at("The").pauseBefore, null); // after "street."
    assert.equal(at("always").pauseBefore, null); // after "sleeves,"
  });

  test("missing pause only after punctuation", () => {
    assert.equal(at("a", 0).pauseBefore, "missing"); // "owner, a" read without a pause
    assert.ok(result.items.filter((it) => it.pauseBefore === "missing").every((it) => /[,.;:!?]$/.test(result.items[result.items.indexOf(it) - 1].text)));
  });

  test("counts per mark, monotone per phrase", () => {
    assert.deepEqual(result.counts, {
      mispronounced: 1,
      omitted: 63,
      inserted: 1,
      unexpectedPause: 6,
      missingPause: 1,
      monotonePhrases: 3,
      phrases: 3,
    });
    assert.equal(result.prosodyAvailable, true);
  });

  test("es-ES: no prosody, no pause marks", () => {
    const es = JSON.parse(readFileSync(new URL("./fixtures/es-ES-continuous-21seg.json", import.meta.url), "utf8"));
    const r = assess(es.referenceText, es.segments);
    assert.equal(r.prosodyAvailable, false);
    assert.equal(r.items.filter((it) => it.pauseBefore).length, 0);
    assert.equal(r.counts.monotonePhrases, 0);
  });
});
