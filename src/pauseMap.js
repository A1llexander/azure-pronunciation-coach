/**
 * Rule-based pause hints for an English reference text, with no model and no network.
 *
 * Every gap between two words gets one of four kinds, checked in this order (first match wins):
 *   "pause"    the previous word ends a sentence or clause (. ! ? ; : or an ellipsis);
 *   "optional" the previous word ends with a comma or dash, a dash or quotation follows, or the next word opens a subordinate clause
 *              (because, which, when…) after a clause of at least PAUSE_SUBORDINATE_MIN_WORDS words;
 *   "join"     the previous word is a function word (article, preposition, possessive, auxiliary,
 *              "to", subject pronoun): the two words belong to one sense group;
 *   "free"     nothing is known: the reader decides.
 *
 * The parts keep the original text character for character: words and gaps are slices of the input,
 * so the rendered text copies back unchanged. Runs of words joined by "join" gaps are wrapped in
 * a group so they can be underlined as one unit.
 *
 * These are hints, not Azure's expectations: the prosody scorer's own break model is not exposed.
 * See docs/pause-map.md.
 */

import { PAUSE_SUBORDINATE_MIN_WORDS } from "./config.js";

/** Words after which a pause would split a sense group. Lower case, apostrophes as "'". */
const FUNCTION_WORDS = new Set([
  // articles and determiners that always take a noun
  "a", "an", "the", "every", "each", "no",
  // possessives
  "my", "your", "his", "her", "its", "our", "their",
  // prepositions
  "of", "to", "in", "on", "at", "for", "with", "from", "by", "into", "onto", "about", "over", "under",
  "between", "through", "during", "without", "within", "among", "towards", "toward", "upon", "across",
  "behind", "beyond", "against", "around", "near", "like",
  // auxiliaries and modals
  "am", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "isn't", "aren't", "wasn't", "weren't", "haven't", "hasn't", "hadn't", "don't", "doesn't", "didn't",
  "won't", "wouldn't", "shouldn't", "can't", "cannot", "couldn't", "mustn't",
  // subject pronouns ("it" and "you" are left out of the pronoun rule where they are often objects)
  "i", "he", "she", "we", "they",
  "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "you'd", "he's", "he'll", "he'd",
  "she's", "she'll", "she'd", "it's", "it'll", "we're", "we've", "we'll", "we'd",
  "they're", "they've", "they'll", "they'd", "that's", "there's", "here's", "what's", "who's",
]);

/** Words that open a subordinate clause. "that" is left out: it is just as often a determiner. */
const SUBORDINATORS = new Set([
  "because", "although", "though", "which", "who", "whom", "whose", "when", "while", "whereas",
  "if", "unless", "since", "until", "before", "after", "where",
]);

/** Abbreviations whose final period does not end a sentence. */
const ABBREVIATIONS = new Set([
  "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "jr.", "sr.", "vs.", "etc.", "e.g.", "i.e.",
  "approx.", "fig.", "inc.", "ltd.", "co.", "u.s.", "u.k.",
]);

const CLOSERS = /["'”’»)\]]+$/u;
const OPENERS = /^["'“‘«([]+/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * @typedef {{type: "word", text: string}} WordPart
 * @typedef {{type: "gap", text: string, kind: "pause" | "optional" | "join" | "free"}} GapPart
 * @typedef {{type: "group", parts: (WordPart | GapPart)[]}} GroupPart
 * @typedef {WordPart | GapPart | GroupPart} Part
 */

/**
 * Split a text into words and classified gaps.
 *
 * @param {string} text
 * @returns {(WordPart | GapPart)[]} Flat list; joining every part's text gives back the input.
 */
export function classifyGaps(text) {
  const tokens = text.match(/\s+|\S+/gu) ?? [];
  /** @type {(WordPart | GapPart)[]} */
  const parts = tokens.map((t) => (/^\s/u.test(t) ? { type: "gap", text: t, kind: "free" } : { type: "word", text: t }));

  let clauseWords = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type !== "word") continue;
    if (HAS_LETTER_OR_DIGIT.test(part.text)) clauseWords++;

    const gap = parts[i + 1];
    const next = parts[i + 2];
    if (!gap || !next) continue; // trailing whitespace stays "free"

    gap.kind = gapKind(part.text, next.text, clauseWords);
    if (gap.kind === "pause" || gap.kind === "optional") clauseWords = 0;
  }
  return parts;
}

/**
 * @param {string} prev word before the gap, as written
 * @param {string} next word after the gap, as written
 * @param {number} clauseWords words read since the last pause, including prev
 * @returns {GapPart["kind"]}
 */
function gapKind(prev, next, clauseWords) {
  const prevCore = prev.replace(CLOSERS, "");
  const nextBare = bare(next);

  if (!HAS_LETTER_OR_DIGIT.test(next)) return "optional"; // a lone dash or bracket: "word — word"
  if (!HAS_LETTER_OR_DIGIT.test(prev)) return "free"; // the pause was marked before the dash
  if (/(\.\.\.|…|[!?;:])$/u.test(prevCore)) return "pause";
  if (/\.$/u.test(prevCore) && !ABBREVIATIONS.has(prevCore.replace(OPENERS, "").toLowerCase())) return "pause";
  if (/[,—–]$/u.test(prevCore)) return "optional";
  if (OPENERS.test(next)) return "optional"; // a quotation or parenthesis starts
  if (SUBORDINATORS.has(nextBare) && clauseWords >= PAUSE_SUBORDINATE_MIN_WORDS) return "optional";
  if (FUNCTION_WORDS.has(bare(prev))) return "join";
  return "free";
}

/** Lower case, no surrounding punctuation, curly apostrophes made straight. */
function bare(word) {
  return word
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * Words joined by "join" gaps wrapped into groups, so a sense group can be shown as one unit.
 *
 * @param {(WordPart | GapPart)[]} flat output of classifyGaps
 * @returns {Part[]}
 */
export function groupParts(flat) {
  /** @type {Part[]} */
  const out = [];
  let group = null;
  for (let i = 0; i < flat.length; i++) {
    const part = flat[i];
    const joinsNext = part.type === "word" && flat[i + 1]?.kind === "join";
    const inJoin = part.type === "gap" && part.kind === "join";
    if (group) {
      group.parts.push(part);
      if (part.type === "word" && !joinsNext) {
        out.push(group);
        group = null;
      }
    } else if (joinsNext) {
      group = { type: "group", parts: [part] };
    } else if (!inJoin) {
      out.push(part);
    }
  }
  if (group) out.push(group);
  return out;
}

/**
 * Pause hints for a text: classified gaps with sense groups wrapped.
 *
 * @param {string} text
 * @returns {Part[]}
 */
export function pauseMap(text) {
  return groupParts(classifyGaps(text));
}
