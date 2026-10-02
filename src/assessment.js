/**
 * Pure assessment logic: merge continuous-recognition segments, align the
 * recognized words with the reference text, and compute final scores.
 *
 * Method follows Microsoft's continuous pronunciation assessment sample
 * (Azure-Samples/cognitive-services-speech-sdk,
 * scenarios/javascript/node/language-learning/pronunciationAssessmentContinue.js):
 * in continuous mode the service does not report omissions or insertions, so
 * they come from our own alignment of all recognized words against the
 * reference text, and Completeness, Accuracy, Fluency and the overall score are
 * recomputed from that alignment. Per-word accuracy, Azure's Mispronunciation
 * flag and phoneme data are kept from the service.
 */

import { MISPRONUNCIATION_THRESHOLD } from "./config.js";

/** Pause allowance Microsoft adds after each word when measuring fluency (100-ns ticks). */
const WORD_GAP_TICKS = 100_000;

/**
 * Lowercase a word and strip leading/trailing punctuation and symbols.
 * Inner apostrophes and hyphens are kept ("don't", "well-known").
 *
 * @param {string} word
 * @returns {string}
 */
export function normalizeWord(word) {
  return word.toLocaleLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}

/**
 * Split the reference text into words, keeping the original spelling for display.
 *
 * @param {string} text
 * @returns {{display: string, norm: string}[]} Tokens that contain at least one letter or digit.
 */
export function tokenizeReference(text) {
  return text
    .split(/\s+/)
    .map((display) => ({ display, norm: normalizeWord(display) }))
    .filter((t) => t.norm.length > 0);
}

/**
 * @typedef {object} RecognizedWord
 * @property {string} word        Word as Azure returned it.
 * @property {string} norm        normalizeWord(word).
 * @property {number} offsetTicks
 * @property {number} durationTicks
 * @property {number | null} accuracy  Null when Azure returned no assessment for the word.
 * @property {boolean} azureMispronounced
 * @property {{name: string, accuracy: number | null}[]} phonemes
 * @property {number} segment     Index of the segment the word came from.
 */

/**
 * Flatten successful segments into one word list in time order.
 * Azure's per-segment Omission/Insertion flags are discarded.
 *
 * @param {object[]} segments Parsed SpeechServiceResponse_JsonResult objects, in arrival order.
 * @returns {{words: RecognizedWord[], prosodyScores: number[], assessmentMissing: boolean}}
 *   assessmentMissing is true when any recognized word came back without pronunciation assessment.
 */
export function mergeSegments(segments) {
  const words = [];
  const prosodyScores = [];
  let assessmentMissing = false;

  segments.forEach((segment, index) => {
    if (segment.RecognitionStatus !== "Success") return;
    const best = segment.NBest?.[0];
    if (!best) return;
    const prosody = best.PronunciationAssessment?.ProsodyScore;
    if (Number.isFinite(prosody)) prosodyScores.push(prosody);

    for (const w of best.Words ?? []) {
      const pa = w.PronunciationAssessment;
      if (!pa) assessmentMissing = true;
      if (pa?.ErrorType === "Omission" || pa?.ErrorType === "Insertion") continue;
      words.push({
        word: w.Word,
        norm: normalizeWord(w.Word),
        offsetTicks: w.Offset,
        durationTicks: w.Duration,
        accuracy: Number.isFinite(pa?.AccuracyScore) ? pa.AccuracyScore : null,
        azureMispronounced: pa?.ErrorType === "Mispronunciation",
        phonemes: (w.Phonemes ?? []).map((p) => ({
          name: p.Phoneme ?? "",
          accuracy: Number.isFinite(p.PronunciationAssessment?.AccuracyScore) ? p.PronunciationAssessment.AccuracyScore : null,
        })),
        segment: index,
      });
    }
  });

  words.sort((a, b) => a.offsetTicks - b.offsetTicks);
  return { words, prosodyScores, assessmentMissing };
}

/**
 * Word-level alignment of reference and recognized word lists (minimum edit distance).
 * A substitution is reported as an omission of the reference word plus an insertion
 * of the recognized word, as in Microsoft's sample.
 *
 * @param {string[]} ref Normalized reference words.
 * @param {string[]} hyp Normalized recognized words.
 * @returns {{op: "match" | "omit" | "insert", ref?: number, hyp?: number}[]} Operations in text order.
 */
export function alignWords(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  // cost[i][j]: edit distance between ref[i..] and hyp[j..]; a substitution costs 2 (omit + insert).
  const cost = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n; i >= 0; i -= 1) {
    for (let j = m; j >= 0; j -= 1) {
      if (i === n) cost[i][j] = m - j;
      else if (j === m) cost[i][j] = n - i;
      else if (ref[i] === hyp[j]) cost[i][j] = cost[i + 1][j + 1];
      else cost[i][j] = 1 + Math.min(cost[i + 1][j], cost[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ref[i] === hyp[j] && cost[i][j] === cost[i + 1][j + 1]) {
      ops.push({ op: "match", ref: i, hyp: j });
      i += 1;
      j += 1;
    } else if (i < n && (j === m || cost[i][j] === 1 + cost[i + 1][j])) {
      ops.push({ op: "omit", ref: i });
      i += 1;
    } else {
      ops.push({ op: "insert", hyp: j });
      j += 1;
    }
  }
  return ops;
}

/**
 * @typedef {object} ResultItem
 * @property {"correct" | "mispronounced" | "omitted" | "inserted"} kind
 * @property {string} text  Reference spelling for reference words; Azure's word for insertions.
 * @property {RecognizedWord | null} spoken  Null for omitted words.
 */

/**
 * Full assessment of one recording.
 *
 * @param {string} referenceText
 * @param {object[]} segments Parsed Azure JSON results, in arrival order.
 * @returns {{
 *   items: ResultItem[],
 *   scores: {pronunciation: number, accuracy: number, fluency: number, completeness: number, prosody: number | null},
 *   assessmentMissing: boolean,
 * }}
 */
export function assess(referenceText, segments) {
  const reference = tokenizeReference(referenceText);
  const { words, prosodyScores, assessmentMissing } = mergeSegments(segments);
  const ops = alignWords(
    reference.map((t) => t.norm),
    words.map((w) => w.norm),
  );

  const items = ops.map(({ op, ref, hyp }) => {
    if (op === "omit") return { kind: "omitted", text: reference[ref].display, spoken: null };
    if (op === "insert") return { kind: "inserted", text: words[hyp].word, spoken: words[hyp] };
    const spoken = words[hyp];
    return { kind: isMispronounced(spoken) ? "mispronounced" : "correct", text: reference[ref].display, spoken };
  });

  return { items, scores: computeScores(items, words, prosodyScores), assessmentMissing };
}

function isMispronounced(word) {
  return word.azureMispronounced || (word.accuracy !== null && word.accuracy < MISPRONUNCIATION_THRESHOLD);
}

function computeScores(items, words, prosodyScores) {
  const referenceItems = items.filter((it) => it.kind !== "inserted");
  const correctItems = items.filter((it) => it.kind === "correct");

  const accuracy = mean(referenceItems.map((it) => it.spoken?.accuracy ?? 0));
  const completeness = referenceItems.length === 0 ? 0 : Math.min(100, (correctItems.length / referenceItems.length) * 100);
  const prosody = prosodyScores.length === 0 ? null : mean(prosodyScores);

  let fluency = 0;
  if (words.length > 0) {
    const start = words[0].offsetTicks;
    const last = words[words.length - 1];
    const end = last.offsetTicks + last.durationTicks + WORD_GAP_TICKS;
    const spokenCorrectly = correctItems.reduce((sum, it) => sum + it.spoken.durationTicks + WORD_GAP_TICKS, 0);
    fluency = end > start ? Math.min(100, (spokenCorrectly / (end - start)) * 100) : 0;
  }

  const pronunciation = weightedScore(prosody === null ? [accuracy, completeness, fluency] : [accuracy, prosody, completeness, fluency]);
  return { pronunciation, accuracy, fluency, completeness, prosody };
}

/** Microsoft's weighting: the lowest score counts most. */
function weightedScore(scores) {
  const sorted = [...scores].sort((a, b) => a - b);
  const weights = sorted.length === 4 ? [0.4, 0.2, 0.2, 0.2] : [0.6, 0.2, 0.2];
  return sorted.reduce((sum, s, k) => sum + s * weights[k], 0);
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Phonemes to show in the tooltip: only when Azure returned non-empty names.
 * Decided by the data, not the locale (es-ES currently returns empty names).
 *
 * @param {RecognizedWord | null} word
 * @returns {{name: string, accuracy: number | null}[]}
 */
export function tooltipPhonemes(word) {
  if (!word || word.phonemes.length === 0) return [];
  return word.phonemes.every((p) => p.name.length > 0) ? word.phonemes : [];
}
