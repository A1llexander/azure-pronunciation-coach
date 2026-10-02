/**
 * Pure PCM helpers: downsampling, Float32 <-> Int16 conversion, RMS level.
 * No DOM or SDK imports, so everything here is unit-testable in Node.
 */

/**
 * Create a stateful streaming downsampler from `inputRate` to `outputRate`.
 *
 * Each output sample is the mean of the input samples covering its time span
 * (a box filter, which also acts as a basic anti-aliasing low-pass). State is
 * carried across calls, so feeding audio in chunks of any size produces the
 * same output as one call with all samples, and no drift accumulates over
 * long recordings. Index arithmetic stays in integers to avoid float drift.
 *
 * @param {number} inputRate Input sample rate in Hz (e.g. 44100 or 48000).
 * @param {number} outputRate Output sample rate in Hz; must not exceed inputRate.
 * @returns {(chunk: Float32Array) => Float32Array} Function that consumes a chunk
 *   and returns the output samples that are complete so far.
 */
export function createDownsampler(inputRate, outputRate) {
  assertPositiveInteger(inputRate, "inputRate");
  assertPositiveInteger(outputRate, "outputRate");
  if (outputRate > inputRate) {
    throw new RangeError(`Upsampling is not supported: ${inputRate} -> ${outputRate}`);
  }

  let carry = new Float32Array(0);
  let carryStart = 0; // global input index of carry[0]
  let produced = 0; // number of output samples emitted so far

  return function process(chunk) {
    const buffer = concatFloat32(carry, chunk);
    const bufferEnd = carryStart + buffer.length; // global, exclusive
    const out = [];

    // Output sample n covers input span [n*in/out, (n+1)*in/out).
    while ((produced + 1) * inputRate <= bufferEnd * outputRate) {
      const from = Math.floor((produced * inputRate) / outputRate) - carryStart;
      const to = Math.ceil(((produced + 1) * inputRate) / outputRate) - carryStart;
      out.push(mean(buffer, from, to));
      produced += 1;
    }

    const nextStart = Math.floor((produced * inputRate) / outputRate);
    carry = buffer.slice(nextStart - carryStart);
    carryStart = nextStart;
    return Float32Array.from(out);
  };
}

/**
 * Convert Float32 samples in [-1, 1] to 16-bit signed PCM, clipping out-of-range values.
 *
 * @param {Float32Array} samples
 * @returns {Int16Array}
 */
export function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/**
 * Convert 16-bit signed PCM to Float32 samples in [-1, 1] (for AudioBuffer playback).
 *
 * @param {Int16Array} samples
 * @returns {Float32Array}
 */
export function int16ToFloat(samples) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = samples[i] < 0 ? samples[i] / 0x8000 : samples[i] / 0x7fff;
  }
  return out;
}

/**
 * Root-mean-square level of Float32 samples. Returns 0 for an empty array.
 *
 * @param {Float32Array} samples
 * @returns {number}
 */
export function rms(samples) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function mean(buffer, from, to) {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += buffer[i];
  return sum / (to - from);
}

function concatFloat32(a, b) {
  if (a.length === 0) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

/**
 * Stateful silence detector over consecutive chunks.
 *
 * @param {{threshold: number, timeoutMs: number, sampleRate: number}} options
 *   threshold: RMS level (Float32 scale) below which a chunk counts as silent.
 * @returns {(chunk: Float32Array) => boolean} Feed each chunk in order; returns true once
 *   silence has lasted at least timeoutMs without interruption.
 */
export function createSilenceDetector({ threshold, timeoutMs, sampleRate }) {
  const limit = Math.round((timeoutMs / 1000) * sampleRate);
  let silentSamples = 0;
  return function isSilentLongEnough(chunk) {
    if (rms(chunk) < threshold) silentSamples += chunk.length;
    else silentSamples = 0;
    return silentSamples >= limit;
  };
}
