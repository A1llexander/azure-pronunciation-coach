/**
 * App-wide constants. Values marked "tuned in testing" are first guesses
 * to be adjusted after manual tests with a real microphone.
 */

/** Sample rate of the PCM stream pushed to Azure and kept for playback (Hz). */
export const TARGET_SAMPLE_RATE = 16000;

/** Hard recording limit (ms). */
export const MAX_RECORDING_MS = 120_000;

/** Absolute floor for silence: a chunk below this AC RMS level (Float32 scale, 0..1) is always silent. */
export const SILENCE_RMS_THRESHOLD = 0.01;

/**
 * Relative silence level: a chunk quieter than this fraction of the loudest chunk so far
 * counts as silence, so room noise above the absolute floor still counts. Tuned in testing.
 */
export const SILENCE_RELATIVE_LEVEL = 0.15;

/**
 * Noise-floor margin: a chunk within this factor of the quietest chunk so far counts as silence
 * (3 = about +9.5 dB), which covers laptop microphones whose own noise is above the absolute floor.
 */
export const SILENCE_NOISE_MARGIN = 3;

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

/**
 * Confidence above which Azure's UnexpectedBreak / MissingBreak feedback counts as an error.
 * Microsoft's suggested value (how-to-pronunciation-assessment, prosody feedback).
 */
export const BREAK_CONFIDENCE_THRESHOLD = 0.75;

/** Locales for which prosody assessment is requested. */
export const PROSODY_LOCALES = Object.freeze(["en-US"]);

/**
 * Azure Speech regions (code, display name), from
 * https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions (checked Oct 2026).
 */
export const AZURE_REGIONS = Object.freeze([
  ["australiaeast", "Australia East"],
  ["brazilsouth", "Brazil South"],
  ["canadacentral", "Canada Central"],
  ["canadaeast", "Canada East"],
  ["centralindia", "Central India"],
  ["centralus", "Central US"],
  ["eastasia", "East Asia"],
  ["eastus", "East US"],
  ["eastus2", "East US 2"],
  ["francecentral", "France Central"],
  ["germanywestcentral", "Germany West Central"],
  ["italynorth", "Italy North"],
  ["japaneast", "Japan East"],
  ["japanwest", "Japan West"],
  ["koreacentral", "Korea Central"],
  ["northcentralus", "North Central US"],
  ["northeurope", "North Europe"],
  ["norwayeast", "Norway East"],
  ["qatarcentral", "Qatar Central"],
  ["southafricanorth", "South Africa North"],
  ["southcentralus", "South Central US"],
  ["southeastasia", "Southeast Asia"],
  ["swedencentral", "Sweden Central"],
  ["switzerlandnorth", "Switzerland North"],
  ["switzerlandwest", "Switzerland West"],
  ["uaenorth", "UAE North"],
  ["uksouth", "UK South"],
  ["ukwest", "UK West"],
  ["westcentralus", "West Central US"],
  ["westeurope", "West Europe"],
  ["westus", "West US"],
  ["westus2", "West US 2"],
  ["westus3", "West US 3"],
]);

/** A token is reused for new recordings while younger than this (tokens live 10 minutes). */
export const TOKEN_REUSE_MS = 8 * 60_000;
