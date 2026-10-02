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
  container.replaceChildren(reading(result.items, locale, onPlay, tooltip), legend());
  if (note) container.append(el("p", "result-note", note));
  container.append(summary);
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

function legend() {
  const list = el("ul", "legend");
  list.setAttribute("aria-label", "How to read the marks");
  const sample = (cls, text) => el("span", `word word--${cls}`, text);
  const item = (...children) => {
    const li = el("li");
    li.append(...children);
    return li;
  };
  list.append(
    item(sample("mispronounced", "word"), " needs work"),
    item(sample("omitted", "word"), " skipped"),
    item(sample("inserted", "‸"), " extra word"),
    item("Click a word to hear how you said it"),
  );
  return list;
}

function reading(items, locale, onPlay, tooltip) {
  const p = el("p", "reading");
  p.lang = locale;
  items.forEach((item, index) => {
    if (index > 0) p.append(" ");
    p.append(wordNode(item, onPlay, tooltip));
  });
  return p;
}

function wordNode(item, onPlay, tooltip) {
  const playable = item.spoken !== null;
  const node = el(playable ? "button" : "span", `word word--${item.kind}`, item.kind === "inserted" ? "‸" : item.text);
  if (playable) {
    node.type = "button";
    node.addEventListener("click", () => onPlay(item, node));
    if (item.kind === "inserted") node.setAttribute("aria-label", "Extra word, not in the text. Play it.");
  }
  if (item.kind === "omitted") node.setAttribute("aria-label", `${item.text}, skipped`);

  const show = () => showTooltip(tooltip, node, item);
  const hide = () => {
    tooltip.hidden = true;
  };
  node.addEventListener("mouseenter", show);
  node.addEventListener("focus", show);
  node.addEventListener("mouseleave", hide);
  node.addEventListener("blur", hide);
  return node;
}

function showTooltip(tooltip, anchor, item) {
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
  }
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
