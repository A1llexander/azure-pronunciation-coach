import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyGaps, groupParts, pauseMap } from "../src/pauseMap.js";
import { DEFAULT_TEXTS } from "../src/samples.js";

/** Gaps as compact markers between words: ‖ pause, | optional, ‿ join, space free. */
function marked(text) {
  return classifyGaps(text)
    .map((p) => (p.type === "word" ? p.text : { pause: " ‖ ", optional: " | ", join: "‿", free: " " }[p.kind]))
    .join("");
}

/** Rebuild the text from grouped parts. */
function flatten(parts) {
  return parts.map((p) => (p.type === "group" ? flatten(p.parts) : p.text)).join("");
}

describe("classifyGaps", () => {
  test("sentence ends and colons are pauses, commas optional", () => {
    assert.equal(marked("Stop. Go now; wait: run, fast!"), "Stop. ‖ Go now; ‖ wait: ‖ run, | fast!");
  });

  test("no pause after articles, prepositions, auxiliaries, possessives and subject pronouns", () => {
    assert.equal(marked("I have been to the edge of my world"), "I‿have‿been‿to‿the‿edge of‿my‿world");
  });

  test("optional pause before a subordinator only after a long clause", () => {
    assert.equal(marked("We stayed home because it rained"), "We‿stayed home because it rained");
    assert.equal(
      marked("We stayed at home all day long because it rained"),
      "We‿stayed at‿home all day long | because it rained",
    );
  });

  test("the subordinator rule wins over a function word before it", () => {
    assert.equal(marked("Every single one of them gave up because"), "Every‿single one of‿them gave up | because");
  });

  test("'that' is never a subordinator", () => {
    assert.equal(marked("Everyone in the whole room knew that she left"), "Everyone in‿the‿whole room knew that she‿left");
  });

  test("abbreviations and decimals do not end a sentence", () => {
    assert.equal(marked("Ask Dr. Smith about 3.5 hours"), "Ask Dr. Smith about‿3.5 hours");
    assert.equal(marked("Tea, e.g. green"), "Tea, | e.g. green");
  });

  test("closing quotes and brackets keep the punctuation before them", () => {
    assert.equal(marked('He said "no." Then left.'), 'He‿said | "no." ‖ Then left.');
    assert.equal(marked("(really.) Fine"), "(really.) ‖ Fine");
  });

  test("dashes and ellipses", () => {
    assert.equal(marked("wait — no"), "wait | — no");
    assert.equal(marked("wait—no… yes"), "wait—no… ‖ yes");
  });

  test("curly apostrophes and case are normalised", () => {
    assert.equal(marked("It’s The END"), "It’s‿The‿END");
  });

  test("whitespace and line breaks are kept as written", () => {
    const text = "  One.\n\nTwo  three ";
    assert.equal(classifyGaps(text).map((p) => p.text).join(""), text);
  });

  test("empty text", () => {
    assert.deepEqual(classifyGaps(""), []);
  });
});

describe("groupParts", () => {
  test("joined words become one group; free gaps stay outside", () => {
    const parts = pauseMap("of the world and more");
    assert.deepEqual(
      parts.map((p) => (p.type === "group" ? `[${flatten(p.parts)}]` : p.text)),
      ["[of the world]", " ", "and", " ", "more"],
    );
  });

  test("a trailing join group is closed", () => {
    const flat = classifyGaps("go to");
    assert.deepEqual(groupParts(flat).map((p) => p.type), ["word", "gap", "word"]);
  });

  test("text survives grouping unchanged", () => {
    for (const text of Object.values(DEFAULT_TEXTS)) assert.equal(flatten(pauseMap(text)), text);
  });
});

describe("default English text", () => {
  test("marks the expected pauses and groups", () => {
    assert.equal(
      marked(DEFAULT_TEXTS["en-US"]),
      "That's‿one small step for‿man, | one giant leap for‿mankind. ‖ " +
        "And so, | my‿fellow Americans: ‖ ask not what your‿country can‿do‿for‿you, | ask what you can‿do‿for‿your‿country.",
    );
  });
});
