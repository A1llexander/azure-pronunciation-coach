/**
 * Short text placed in the text box so a first-time user can press Record right away.
 * Well known, upper-intermediate, with commas and a colon where pauses are expected and sounds
 * that are often mispronounced (English th and r, Spanish rr). Both are free to reuse:
 * - en-US: Neil Armstrong (1969) and John F. Kennedy (1961), works of US federal employees;
 * - es-ES: traditional Spanish sayings.
 */

/** @type {Readonly<Record<string, string>>} */
export const DEFAULT_TEXTS = Object.freeze({
  "en-US":
    "That's one small step for man, one giant leap for mankind. " +
    "And so, my fellow Americans: ask not what your country can do for you, ask what you can do for your country.",
  "es-ES":
    "Dicen que más vale tarde que nunca, pero también que a quien madruga, Dios le ayuda. " +
    "Perro ladrador, poco mordedor, y en boca cerrada no entran moscas. " +
    "Al final, no hay mal que por bien no venga.",
});

/**
 * Whether a text is empty or one of the default texts, unchanged (so it may be replaced).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isReplaceable(text) {
  const trimmed = text.trim();
  return trimmed === "" || Object.values(DEFAULT_TEXTS).includes(trimmed);
}
