/**
 * Pure helpers for Azure time units and word playback ranges.
 * Azure reports Offset and Duration in 100-nanosecond ticks.
 */

/** Azure ticks per second (1 tick = 100 ns). */
export const TICKS_PER_SECOND = 10_000_000;

/**
 * @param {number} ticks Azure 100-ns ticks.
 * @returns {number} Seconds.
 */
export function ticksToSeconds(ticks) {
  return ticks / TICKS_PER_SECOND;
}

/**
 * @param {number} ticks Azure 100-ns ticks.
 * @param {number} sampleRate Samples per second.
 * @returns {number} Nearest sample index.
 */
export function ticksToSamples(ticks, sampleRate) {
  return Math.round((ticks * sampleRate) / TICKS_PER_SECOND);
}

/**
 * Sample range to play for one word: [offset - padding, offset + duration + padding],
 * clamped to the recording. Offset 0 is the first sample pushed to Azure.
 *
 * @param {{offsetTicks: number, durationTicks: number}} word
 * @param {{paddingMs: number, sampleRate: number, totalSamples: number}} options
 * @returns {{start: number, end: number} | null} Start inclusive, end exclusive,
 *   or null when the clamped range is empty (word lies outside the recording).
 */
export function playbackRange(word, options) {
  const { offsetTicks, durationTicks } = word;
  const { paddingMs, sampleRate, totalSamples } = options;
  if (![offsetTicks, durationTicks, paddingMs, sampleRate, totalSamples].every(Number.isFinite)) {
    throw new TypeError("playbackRange: all inputs must be finite numbers");
  }
  if (durationTicks < 0 || paddingMs < 0 || sampleRate <= 0 || totalSamples < 0) {
    throw new RangeError("playbackRange: negative duration/padding/total or non-positive rate");
  }

  const padding = Math.round((paddingMs / 1000) * sampleRate);
  const wordStart = ticksToSamples(offsetTicks, sampleRate);
  const wordEnd = ticksToSamples(offsetTicks + durationTicks, sampleRate);

  const start = Math.max(0, wordStart - padding);
  const end = Math.min(totalSamples, wordEnd + padding);
  return start < end ? { start, end } : null;
}
