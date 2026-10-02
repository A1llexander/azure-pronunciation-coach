/**
 * App-wide constants. Values marked "tuned in testing" are first guesses
 * to be adjusted after manual tests with a real microphone.
 */

/** Sample rate of the PCM stream pushed to Azure and kept for playback (Hz). */
export const TARGET_SAMPLE_RATE = 16000;

/** Hard recording limit (ms). */
export const MAX_RECORDING_MS = 120_000;

/** RMS level (Float32 scale, 0..1) below which a chunk counts as silence. Tuned in testing. */
export const SILENCE_RMS_THRESHOLD = 0.01;

/** Continuous silence that stops the recording (ms). */
export const SILENCE_TIMEOUT_MS = 10_000;

/** Padding added before and after a word when it is replayed (ms). Tuned in testing. */
export const PLAYBACK_PADDING_MS = 120;

/** Maximum length of the reference text (characters). */
export const MAX_REFERENCE_CHARS = 1500;

/** Reading speed used to warn that a text will not fit in MAX_RECORDING_MS. Tuned in testing. */
export const READING_WORDS_PER_MINUTE = 130;

/** Score color bands, checked top-down: first band whose min is <= score wins. */
export const SCORE_BANDS = Object.freeze([
  Object.freeze({ min: 80, band: "good" }),
  Object.freeze({ min: 60, band: "fair" }),
  Object.freeze({ min: 0, band: "poor" }),
]);

/** Supported assessment locales. */
export const LOCALES = Object.freeze(["en-US", "es-ES"]);

/**
 * Word accuracy below which a word Azure marked "None" is shown as mispronounced.
 * Taken from Microsoft's continuous pronunciation assessment sample.
 */
export const MISPRONUNCIATION_THRESHOLD = 60;

/** Locales for which prosody assessment is requested. */
export const PROSODY_LOCALES = Object.freeze(["en-US"]);
