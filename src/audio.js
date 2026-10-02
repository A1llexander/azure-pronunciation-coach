/**
 * Microphone capture and word playback.
 *
 * One getUserMedia stream feeds the recorder worklet. Each chunk is downsampled
 * to 16 kHz Int16 mono, handed to the caller (which pushes it to Azure) and kept
 * in memory, so the local recording is exactly what Azure received: word offsets
 * from Azure index straight into it.
 */

import { createDownsampler, floatToInt16, int16ToFloat, createSilenceDetector } from "./pcm.js";
import {
  TARGET_SAMPLE_RATE,
  MAX_RECORDING_MS,
  SILENCE_RMS_THRESHOLD,
  SILENCE_RELATIVE_LEVEL,
  SILENCE_TIMEOUT_MS,
} from "./config.js";
import { AppError, classifyMicError } from "./errors.js";

const MAX_SAMPLES = Math.round((MAX_RECORDING_MS / 1000) * TARGET_SAMPLE_RATE);
const FLUSH_TIMEOUT_MS = 500;

/**
 * @typedef {object} Recording
 * @property {() => Promise<Int16Array>} stop Stop capture and return all 16 kHz samples.
 */

/**
 * Start recording from the default microphone.
 *
 * @param {object} handlers
 * @param {(pcm: Int16Array) => void} handlers.onChunk Called for every 16 kHz chunk, in order.
 * @param {(reason: "silence" | "limit") => void} handlers.onAutoStop Called once when silence or the
 *   2-minute limit is reached; the caller should then call stop().
 * @returns {Promise<Recording>}
 * @throws {AppError} mic-denied or no-mic.
 */
export async function startRecording({ onChunk, onAutoStop }) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (error) {
    throw new AppError(classifyMicError(error?.name));
  }

  // Match the context to the microphone rate where the browser reports it:
  // Firefox refuses to connect a stream whose rate differs from the context.
  const trackRate = stream.getAudioTracks()[0]?.getSettings().sampleRate;
  const context = trackRate ? new AudioContext({ sampleRate: trackRate }) : new AudioContext();

  try {
    await context.resume(); // may start suspended when created after awaits
    await context.audioWorklet.addModule(new URL("./recorder-worklet.js", import.meta.url));
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    throw error;
  }

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "recorder-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit", // down-mix stereo microphones to mono
    channelInterpretation: "speakers",
  });
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(context.destination); // keeps the worklet pulled without audible output

  const downsample = createDownsampler(context.sampleRate, TARGET_SAMPLE_RATE);
  const isSilentLongEnough = createSilenceDetector({
    threshold: SILENCE_RMS_THRESHOLD,
    relative: SILENCE_RELATIVE_LEVEL,
    timeoutMs: SILENCE_TIMEOUT_MS,
    sampleRate: TARGET_SAMPLE_RATE,
  });
  const chunks = [];
  let total = 0;
  let autoStopped = false;
  let resolveFlushed;
  const flushed = new Promise((resolve) => {
    resolveFlushed = resolve;
  });

  const autoStop = (reason) => {
    if (autoStopped) return;
    autoStopped = true;
    onAutoStop(reason);
  };

  node.port.onmessage = (event) => {
    if (event.data.type === "flushed") {
      resolveFlushed();
      return;
    }
    if (event.data.type !== "frames" || total >= MAX_SAMPLES) return;
    let samples = downsample(event.data.samples);
    if (total + samples.length > MAX_SAMPLES) samples = samples.subarray(0, MAX_SAMPLES - total);
    const pcm = floatToInt16(samples);
    chunks.push(pcm);
    total += pcm.length;
    onChunk(pcm);
    if (total >= MAX_SAMPLES) autoStop("limit");
    else if (isSilentLongEnough(samples)) autoStop("silence");
  };

  let stopped = null;
  return {
    stop() {
      stopped ??= (async () => {
        node.port.postMessage({ type: "flush" });
        await Promise.race([flushed, new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS))]);
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        await context.close();
        return concat(chunks, total);
      })();
      return stopped;
    },
  };
}

/**
 * Plays sample ranges of one recording. Starting a new range stops the previous one.
 *
 * @param {Int16Array} pcm
 * @param {number} sampleRate
 */
export function createPlayer(pcm, sampleRate) {
  let context = null;
  let current = null;
  return {
    /** @param {{start: number, end: number}} range Sample indices, end exclusive. */
    play({ start, end }) {
      context ??= new AudioContext();
      current?.stop();
      const buffer = context.createBuffer(1, end - start, sampleRate);
      buffer.copyToChannel(int16ToFloat(pcm.subarray(start, end)), 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
      current = source;
    },
    close() {
      current?.stop();
      context?.close();
      context = null;
      current = null;
    },
  };
}

function concat(chunks, total) {
  const out = new Int16Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
