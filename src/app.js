/**
 * UI state machine: setup -> idle -> starting -> recording -> processing -> results.
 * The only place that touches the page outside render.js.
 */

import {
  LOCALES,
  MAX_RECORDING_MS,
  MAX_REFERENCE_CHARS,
  PLAYBACK_PADDING_MS,
  READING_WORDS_PER_MINUTE,
  TARGET_SAMPLE_RATE,
} from "./config.js";
import { AppError, ERRORS } from "./errors.js";
import { createKeyStore, normalizeRegion } from "./keyStore.js";
import { fetchToken, startSession } from "./azure.js";
import { startRecording, createPlayer } from "./audio.js";
import { assess, estimateReadingMs } from "./assessment.js";
import { playbackRange } from "./segments.js";
import { renderResults } from "./render.js";

const $ = (id) => document.getElementById(id);
const ui = {
  keyStatus: $("keyStatus"),
  keyStatusText: $("keyStatusText"),
  changeKey: $("changeKey"),
  unsupported: $("unsupported"),
  setup: $("setup"),
  keyForm: $("keyForm"),
  keyInput: $("keyInput"),
  regionInput: $("regionInput"),
  rememberInput: $("rememberInput"),
  saveKey: $("saveKey"),
  forgetKey: $("forgetKey"),
  keyMessage: $("keyMessage"),
  practice: $("practice"),
  locale: $("locale"),
  text: $("text"),
  charCount: $("charCount"),
  lengthWarning: $("lengthWarning"),
  recordButton: $("recordButton"),
  timer: $("timer"),
  status: $("status"),
  live: $("live"),
  error: $("error"),
  errorMessage: $("errorMessage"),
  errorHint: $("errorHint"),
  results: $("results"),
  tooltip: $("tooltip"),
};

const STATUS_TEXT = {
  starting: "Connecting to Azure…",
  recording: "Recording. Read the text aloud, then press Stop.",
  processing: "Scoring…",
};

const AUTO_STOP_NOTE = {
  silence: "Recording stopped after 10 seconds of silence.",
  limit: "Recording stopped at the 2-minute limit.",
};

const store = createKeyStore();
let credentials = null;
let state = "loading";
let run = null; // { session, recording, timerId, startedAt, autoStopReason }
let player = null;

/** @param {"setup" | "idle" | "starting" | "recording" | "processing" | "results" | "unsupported"} next */
function setState(next) {
  state = next;
  document.body.dataset.state = next;
  const busy = next === "starting" || next === "recording" || next === "processing";

  ui.unsupported.hidden = next !== "unsupported";
  ui.setup.hidden = next !== "setup";
  ui.practice.hidden = next === "setup" || next === "unsupported";
  ui.keyStatus.hidden = !credentials || next === "setup" || next === "unsupported";
  ui.changeKey.disabled = busy;

  ui.text.readOnly = busy;
  ui.locale.disabled = busy;
  ui.recordButton.textContent = next === "recording" ? "Stop" : "Record";
  ui.recordButton.disabled = next === "starting" || next === "processing" || (!busy && !canRecord());
  ui.status.textContent = STATUS_TEXT[next] ?? "";
  if (!busy) ui.timer.textContent = formatTime(MAX_RECORDING_MS);
}

function canRecord() {
  return Boolean(credentials) && ui.text.value.trim().length > 0;
}

/* ---------- key setup ---------- */

function showSetup() {
  const saved = store.load();
  ui.keyInput.value = saved?.key ?? "";
  ui.regionInput.value = saved?.region ?? "";
  ui.rememberInput.checked = saved?.remembered ?? false;
  ui.forgetKey.hidden = !saved;
  ui.keyMessage.textContent = "";
  setState("setup");
  (saved ? ui.saveKey : ui.keyInput).focus();
}

async function onSaveKey(event) {
  event.preventDefault();
  const key = ui.keyInput.value.trim();
  const region = normalizeRegion(ui.regionInput.value);
  if (!key) {
    ui.keyMessage.textContent = "Paste your key first.";
    return;
  }
  if (!region) {
    ui.keyMessage.textContent = `${ERRORS["region-invalid"].message}. ${ERRORS["region-invalid"].hint}`;
    return;
  }
  ui.regionInput.value = region;
  ui.saveKey.disabled = true;
  ui.keyMessage.textContent = "";
  ui.saveKey.textContent = "Checking…";
  try {
    await fetchToken(key, region); // proves key and region work before saving
    store.save({ key, region, remember: ui.rememberInput.checked });
    credentials = { key, region };
    updateKeyStatus();
    setState("idle");
    ui.text.focus();
  } catch (error) {
    const entry = ERRORS[error instanceof AppError ? error.code : "network"];
    ui.keyMessage.textContent = `${entry.message}. ${entry.hint}`;
  } finally {
    ui.saveKey.disabled = false;
    ui.saveKey.textContent = "Save key";
  }
}

function onForgetKey() {
  store.forget();
  credentials = null;
  ui.keyInput.value = "";
  ui.regionInput.value = "";
  ui.rememberInput.checked = false;
  ui.forgetKey.hidden = true;
  ui.keyMessage.textContent = "Key forgotten on this device.";
  ui.keyInput.focus();
}

function updateKeyStatus() {
  if (!credentials) return;
  ui.keyStatusText.textContent = `Azure key for ${credentials.region}`;
}

/* ---------- text ---------- */

function onTextInput() {
  const length = ui.text.value.length;
  ui.charCount.textContent = `${length} / ${MAX_REFERENCE_CHARS}`;
  ui.lengthWarning.hidden = estimateReadingMs(ui.text.value, READING_WORDS_PER_MINUTE) <= MAX_RECORDING_MS;
  if (state === "idle" || state === "results") setState(state);
}

/* ---------- recording ---------- */

async function onRecordButton() {
  if (state === "recording") {
    await stopAndScore();
    return;
  }
  if (state === "idle" || state === "results") await startRun();
}

async function startRun() {
  hideError();
  discardResult();
  ui.live.textContent = "";
  setState("starting");

  const locale = ui.locale.value;
  const referenceText = ui.text.value.trim();
  const current = { session: null, recording: null, timerId: null, startedAt: 0, autoStopReason: null, referenceText, locale };
  run = current;

  try {
    const token = await fetchToken(credentials.key, credentials.region);
    current.session = startSession({
      token,
      region: credentials.region,
      locale,
      referenceText,
      onText: (text) => {
        ui.live.textContent = text;
      },
      onError: (error) => failRun(error),
    });
    await current.session.started;
    current.recording = await startRecording({
      onChunk: (pcm) => current.session.push(pcm),
      onAutoStop: (reason) => {
        current.autoStopReason = reason;
        if (run === current && state === "recording") stopAndScore();
      },
    });
  } catch (error) {
    await failRun(error);
    return;
  }
  if (run !== current) return; // failed while starting

  current.startedAt = performance.now();
  current.timerId = setInterval(() => {
    const left = Math.max(0, MAX_RECORDING_MS - (performance.now() - current.startedAt));
    ui.timer.textContent = formatTime(left);
  }, 250);
  setState("recording");
}

async function stopAndScore() {
  const current = run;
  if (!current || state !== "recording") return;
  clearInterval(current.timerId);
  setState("processing");
  try {
    const pcm = await current.recording.stop();
    const segments = await current.session.finish();
    if (run !== current) return;
    const result = assess(current.referenceText, segments);
    if (!result.items.some((item) => item.spoken)) throw new AppError("no-speech");
    if (result.assessmentMissing) throw new AppError("assessment-missing");
    run = null;
    showResult(result, pcm, current);
  } catch (error) {
    await failRun(error);
  }
}

function showResult(result, pcm, current) {
  player = createPlayer(pcm, TARGET_SAMPLE_RATE);
  let playing = null;
  renderResults(ui.results, result, {
    locale: current.locale,
    note: AUTO_STOP_NOTE[current.autoStopReason],
    tooltip: ui.tooltip,
    onPlay: (item, element) => {
      const range = playbackRange(
        { offsetTicks: item.spoken.offsetTicks, durationTicks: item.spoken.durationTicks },
        { paddingMs: PLAYBACK_PADDING_MS, sampleRate: TARGET_SAMPLE_RATE, totalSamples: pcm.length },
      );
      if (!range) return;
      playing?.classList.remove("is-playing");
      element.classList.add("is-playing");
      playing = element;
      player.play(range);
      const ms = ((range.end - range.start) / TARGET_SAMPLE_RATE) * 1000;
      setTimeout(() => element.classList.remove("is-playing"), ms);
    },
  });
  ui.live.textContent = "";
  ui.results.hidden = false;
  setState("results");
}

async function failRun(error) {
  const current = run;
  if (!current) return;
  run = null;
  clearInterval(current.timerId);
  current.session?.abort();
  try {
    await current.recording?.stop();
  } catch {
    // Already stopped.
  }
  showError(error instanceof AppError ? error.code : "network");
  setState("idle");
}

function discardResult() {
  player?.close();
  player = null;
  ui.results.hidden = true;
  ui.results.replaceChildren();
  ui.tooltip.hidden = true;
}

/* ---------- errors ---------- */

function showError(code) {
  const entry = ERRORS[code] ?? ERRORS.network;
  ui.errorMessage.textContent = entry.message;
  ui.errorHint.textContent = entry.hint;
  ui.error.hidden = false;
}

function hideError() {
  ui.error.hidden = true;
}

/* ---------- helpers ---------- */

function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Desktop browsers with microphone, AudioWorklet and the Speech SDK; judged by capability, not user agent. */
function isSupported() {
  const touchOnly = window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches;
  return (
    !touchOnly &&
    typeof AudioWorkletNode !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean(window.SpeechSDK)
  );
}

function init() {
  if (!isSupported()) {
    setState("unsupported");
    return;
  }
  for (const option of ui.locale.options) option.disabled = !LOCALES.includes(option.value);

  ui.keyForm.addEventListener("submit", onSaveKey);
  ui.forgetKey.addEventListener("click", onForgetKey);
  ui.changeKey.addEventListener("click", showSetup);
  ui.text.addEventListener("input", onTextInput);
  ui.recordButton.addEventListener("click", onRecordButton);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") ui.tooltip.hidden = true;
  });

  const saved = store.load();
  if (saved) {
    credentials = { key: saved.key, region: saved.region };
    updateKeyStatus();
  }
  onTextInput();
  if (credentials) setState("idle");
  else showSetup();
}

init();
