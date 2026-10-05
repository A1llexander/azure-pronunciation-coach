/**
 * Results view. Builds DOM nodes and sets text with textContent only:
 * user text and Azure output are never parsed as HTML.
 */

import { SCORE_BANDS } from "./config.js";
import { tooltipPhonemes } from "./assessment.js";

/**
 * @param {number} score 0..100
 * @returns {"good" | "fair" | "poor"}
 */
export function scoreBand(score) {
  return SCORE_BANDS.find((b) => score >= b.min)?.band ?? "poor";
}

/**
 * Breakdown rows to show. Prosody appears only when Azure returned it (en-US today).
 *
 * @param {{accuracy: number, fluency: number, completeness: number, prosody: number | null}} scores
 * @returns {{label: string, value: number}[]}
 */
export function scoreRows(scores) {
  const rows = [
    { label: "Accuracy", value: scores.accuracy },
    { label: "Fluency", value: scores.fluency },
    { label: "Completeness", value: scores.completeness },
  ];
  if (scores.prosody !== null && scores.prosody !== undefined) rows.push({ label: "Prosody", value: scores.prosody });
  return rows;
}

/**
 * Render a full result into a container.
 *
 * @param {HTMLElement} container
 * @param {ReturnType<typeof import("./assessment.js").assess>} result
 * @param {object} options
 * @param {string} options.locale BCP-47 tag of the reference text.
 * @param {string} [options.note] Optional line under the scores (e.g. why recording stopped).
 * @param {(item: object, element: HTMLElement) => void} options.onPlay Called when a spoken word is clicked.
 * @param {HTMLElement} options.tooltip Shared tooltip element.
 */
export function renderResults(container, result, { locale, note, onPlay, tooltip }) {
  const summary = el("div", "summary");
  summary.append(ring(result.scores.pronunciation), bars(result.scores));
  const text = reading(result.items, locale, onPlay, tooltip);
  container.replaceChildren(text, marksBar(result, text));
  if (note) container.append(el("p", "result-note", note));
  container.append(summary);
}

/**
 * Mark types shown in the counter bar, in display order. Prosody types appear only when Azure
 * returned prosody feedback (en-US).
 *
 * @param {{counts: object, prosodyAvailable: boolean}} result
 * @returns {{type: string, label: string, count: number, sample: string}[]}
 */
export function markTypes(result) {
  const { counts } = result;
  const types = [
    { type: "mispronounced", label: "Mispronounced", count: counts.mispronounced, sample: "word" },
    { type: "omitted", label: "Skipped", count: counts.omitted, sample: "word" },
    { type: "inserted", label: "Extra words", count: counts.inserted, sample: "‸" },
  ];
  if (result.prosodyAvailable) {
    types.push(
      { type: "unexpected", label: "Unexpected pauses", count: counts.unexpectedPause, sample: "|" },
      { type: "missing", label: "Missing pauses", count: counts.missingPause, sample: "/" },
      { type: "monotone", label: `Monotone phrases of ${counts.phrases}`, count: counts.monotonePhrases, sample: "word" },
    );
  }
  return types;
}

/** Counters that double as legend and as show/hide toggles for each kind of mark. */
function marksBar(result, readingNode) {
  const bar = el("div", "marks");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Marks in the text. Press one to hide or show it.");
  for (const { type, label, count, sample } of markTypes(result)) {
    const button = el("button", `mark-toggle mark-toggle--${type}`);
    button.type = "button";
    button.setAttribute("aria-pressed", "true");
    button.append(sampleMark(type, sample), el("span", "mark-count", String(count)), el("span", "mark-label", label));
    button.addEventListener("click", () => {
      const shown = button.getAttribute("aria-pressed") === "true";
      button.setAttribute("aria-pressed", String(!shown));
      readingNode.classList.toggle(`hide-${type}`, shown);
    });
    bar.append(button);
  }
  bar.append(el("p", "marks-hint", "Click a word to hear how you said it."));
  return bar;
}

function sampleMark(type, sample) {
  if (type === "unexpected" || type === "missing") return el("span", `pause pause--${type}`, sample);
  if (type === "monotone") return el("span", "word word--correct is-monotone", sample);
  return el("span", `word word--${type}`, sample);
}

function ring(score) {
  const value = Math.round(score);
  const node = el("div", `ring band-${scoreBand(value)}`);
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", `Pronunciation score ${value} out of 100`);
  node.style.setProperty("--score", String(value));
  node.append(el("span", "ring-value", String(value)), el("span", "ring-label", "Pronunciation"));
  return node;
}

function bars(scores) {
  const list = el("dl", "bars");
  for (const { label, value } of scoreRows(scores)) {
    const rounded = Math.round(value);
    const row = el("div", `bar band-${scoreBand(rounded)}`);
    const track = el("span", "bar-track");
    const fill = el("span", "bar-fill");
    fill.style.setProperty("--score", String(rounded));
    track.append(fill);
    const dd = el("dd");
    dd.append(track, el("span", "bar-value", String(rounded)));
    row.append(el("dt", null, label), dd);
    list.append(row);
  }
  return list;
}

function reading(items, locale, onPlay, tooltip) {
  const p = el("p", "reading");
  p.lang = locale;
  items.forEach((item, index) => {
    if (index > 0) p.append(" ");
    if (item.pauseBefore) p.append(pauseNode(item, tooltip));
    p.append(wordNode(item, onPlay, tooltip));
  });
  return p;
}

function pauseNode(item, tooltip) {
  const unexpected = item.pauseBefore === "unexpected";
  const node = el("span", `pause pause--${item.pauseBefore}`, unexpected ? "|" : "/");
  const title = unexpected ? "Unexpected pause" : "Missing pause";
  const line = unexpected
    ? `You paused for ${(item.pauseMs / 1000).toFixed(2)} s here, inside a phrase.`
    : "The punctuation here asks for a short pause.";
  node.tabIndex = 0;
  node.setAttribute("aria-label", `${title} before ${item.text}`);
  attachTooltip(node, tooltip, () => [el("p", "tooltip-title", title), el("p", "tooltip-line", line)]);
  return node;
}

const GAP_TITLES = {
  pause: "Pause here",
  optional: "Short pause if you like",
};

/**
 * Render rule-based pause hints. The text is the original, slice for slice: gaps are styled,
 * no marks are inserted, so selecting and copying it gives back what the user typed.
 *
 * @param {HTMLElement} container
 * @param {import("./pauseMap.js").Part[]} parts output of pauseMap()
 */
export function renderPauseMap(container, parts) {
  container.replaceChildren(...parts.map(pausePart));
}

function pausePart(part) {
  if (part.type === "word") return document.createTextNode(part.text);
  if (part.type === "group") {
    const group = el("span", "pm-group");
    group.append(...part.parts.map(pausePart));
    return group;
  }
  if (part.kind !== "pause" && part.kind !== "optional") return document.createTextNode(part.text);
  const gap = el("span", `pm-gap pm-gap--${part.kind}`, part.text);
  gap.title = GAP_TITLES[part.kind];
  return gap;
}

function attachTooltip(node, tooltip, build) {
  const show = () => placeTooltip(tooltip, node, build());
  const hide = () => {
    tooltip.hidden = true;
  };
  node.addEventListener("mouseenter", show);
  node.addEventListener("focus", show);
  node.addEventListener("mouseleave", hide);
  node.addEventListener("blur", hide);
}

function wordNode(item, onPlay, tooltip) {
  const playable = item.spoken !== null;
  const monotone = item.kind !== "inserted" && item.spoken?.prosody?.monotone;
  const node = el(
    playable ? "button" : "span",
    `word word--${item.kind}${monotone ? " is-monotone" : ""}`,
    item.kind === "inserted" ? "‸" : item.text,
  );
  if (playable) {
    node.type = "button";
    node.addEventListener("click", () => onPlay(item, node));
    if (item.kind === "inserted") node.setAttribute("aria-label", "Extra word, not in the text. Play it.");
  }
  if (item.kind === "omitted") node.setAttribute("aria-label", `${item.text}, skipped`);

  attachTooltip(node, tooltip, () => wordTooltip(item));
  return node;
}

function wordTooltip(item) {
  const children = [];
  if (item.kind === "inserted") {
    children.push(el("p", "tooltip-title", "Extra word"), el("p", "tooltip-line", "Not in the text. Click to hear what you said."));
  } else if (item.kind === "omitted") {
    children.push(el("p", "tooltip-title", item.text), el("p", "tooltip-line", "Skipped"));
  } else {
    const accuracy = item.spoken.accuracy;
    children.push(el("p", "tooltip-title", item.text));
    const verdict = item.kind === "mispronounced" ? "Needs work" : "Good";
    children.push(el("p", "tooltip-line", accuracy === null ? verdict : `${verdict}, accuracy ${Math.round(accuracy)}`));
    const phonemes = tooltipPhonemes(item.spoken);
    if (phonemes.length > 0) {
      const list = el("ul", "phonemes");
      for (const p of phonemes) {
        const score = p.accuracy === null ? "–" : String(Math.round(p.accuracy));
        const li = el("li", `phoneme band-${p.accuracy === null ? "fair" : scoreBand(p.accuracy)}`);
        li.append(el("span", "phoneme-name", p.name), el("span", "phoneme-score", score));
        list.append(li);
      }
      children.push(list);
    }
    if (item.spoken.prosody?.monotone) children.push(el("p", "tooltip-line", "Monotone phrase: vary your pitch more."));
  }
  return children;
}

function placeTooltip(tooltip, anchor, children) {
  tooltip.replaceChildren(...children);
  tooltip.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - tip.width / 2), window.innerWidth - tip.width - margin);
  const above = rect.top - tip.height - margin;
  const top = above >= margin ? above : rect.bottom + margin;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
