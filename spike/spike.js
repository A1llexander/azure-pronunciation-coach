/*
 * Throwaway spike page. Answers the open questions from the v1 spec with real
 * Azure responses and records everything in a downloadable findings.json:
 * fixtures, PCM/offset alignment, per-segment Omission/Completeness behavior,
 * CSP compatibility, WebSocket hosts and whether credentials appear in the URL,
 * token exchange, F0 concurrency, and error codes.
 * Secrets are redacted from the log and from the downloaded file.
 */

import { createDownsampler, floatToInt16, int16ToFloat, rms } from "../src/pcm.js";
import { playbackRange, ticksToSamples, TICKS_PER_SECOND } from "../src/segments.js";
import { TARGET_SAMPLE_RATE, PLAYBACK_PADDING_MS, PROSODY_LOCALES, MAX_RECORDING_MS } from "../src/config.js";

const SDK_VERSION = "1.52.0";
const ONSET_WINDOW = TARGET_SAMPLE_RATE / 100; // 10 ms windows for local speech onset
const ONSET_RMS = 0.02;
const ONSET_MIN_WINDOWS = 10; // 100 ms of sustained sound, so a mouse click on Record is not taken as speech
const sdk = window.SpeechSDK;
const $ = (id) => document.getElementById(id);

const TEXTS = {
  "en-US":
    "Every morning I walk to the small bakery at the end of our street. The owner, a quiet man with flour on his sleeves, always asks whether I want the usual. I nod, and he wraps a warm loaf of rye bread in brown paper. On the way back I pass the old library, where a few students are already waiting for the doors to open. The air smells of rain and coffee. By the time I reach home, the city is fully awake: buses rumble past, children laugh on their way to school, and somewhere a dog barks at nothing in particular. These ten minutes are the calmest part of my day, and I try not to waste them.",
  "es-ES":
    "Cada mañana camino hasta la pequeña panadería que está al final de mi calle. El dueño, un hombre tranquilo con harina en las mangas, siempre me pregunta si quiero lo de siempre. Yo asiento, y él envuelve una barra de pan caliente en papel marrón. De vuelta paso por la vieja biblioteca, donde algunos estudiantes ya esperan a que abran las puertas. El aire huele a lluvia y a café. Cuando llego a casa, la ciudad ya está despierta: los autobuses pasan con estruendo, los niños se ríen camino del colegio y, en algún lugar, un perro ladra sin motivo. Estos diez minutos son la parte más tranquila de mi día, y intento no desperdiciarlos.",
};

const PROTOCOL = {
  "en-US":
    'Read the text with three deliberate changes: say "very" before "warm" (insertion); pause 3 seconds after "open." (segment boundary); then skip "air" (omission right after the boundary).',
  "es-ES":
    'Lee el texto con tres cambios: di "muy" antes de "caliente" (inserción); pausa de 3 segundos después de "puertas." (límite de segmento); luego omite "aire" (omisión justo después del límite).',
};

const findings = {
  meta: {
    sdkVersion: SDK_VERSION,
    userAgent: navigator.userAgent,
    startedAt: new Date().toISOString(),
    sdkLoaded: Boolean(sdk),
  },
  csp: { violations: [] },
  sockets: [],
  sentContexts: [],
  http: [],
  runs: [],
  probes: [],
  notes: "",
};

const secrets = new Set();
let token = null;
let busy = false;

/* ---------- redaction and logging ---------- */

function redact(value) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(secret).join("[REDACTED]").split(encodeURIComponent(secret)).join("[REDACTED]");
  }
  return text;
}

function log(message) {
  const line = document.createElement("div");
  line.textContent = `${new Date().toISOString().slice(11, 23)}  ${redact(message)}`;
  $("log").append(line);
  $("log").scrollTop = $("log").scrollHeight;
  updateCounts();
}

function updateCounts() {
  $("counts").textContent =
    `runs: ${findings.runs.length}, probes: ${findings.probes.length}, ` +
    `sockets: ${findings.sockets.length}, CSP violations: ${findings.csp.violations.length}`;
}

/* ---------- instrumentation: CSP violations and WebSocket URLs ---------- */

document.addEventListener("securitypolicyviolation", (e) => {
  const entry = {
    directive: e.effectiveDirective,
    blockedURI: redact(e.blockedURI),
    sourceFile: e.sourceFile,
    line: e.lineNumber,
    sample: redact(e.sample),
  };
  findings.csp.violations.push(entry);
  log(`CSP violation: ${entry.directive} blocked ${entry.blockedURI} (${entry.sourceFile}:${entry.line})`);
});

function containsSecret(url, secret) {
  return Boolean(secret) && (url.includes(secret) || url.includes(encodeURIComponent(secret)));
}

function recordSocket(url) {
  const parsed = new URL(url);
  const entry = {
    at: new Date().toISOString(),
    scheme: parsed.protocol,
    host: parsed.host,
    path: parsed.pathname,
    queryParamNames: [...parsed.searchParams.keys()],
    keyInUrl: containsSecret(url, $("key").value.trim()),
    tokenInUrl: containsSecret(url, token),
  };
  findings.sockets.push(entry);
  log(`WebSocket ${entry.host}${entry.path} params=[${entry.queryParamNames.join(", ")}] keyInUrl=${entry.keyInUrl} tokenInUrl=${entry.tokenInUrl}`);
}

const NativeWebSocket = window.WebSocket;
window.WebSocket = class InstrumentedWebSocket extends NativeWebSocket {
  constructor(url, protocols) {
    recordSocket(String(url));
    super(url, protocols);
  }

  send(data) {
    if (typeof data === "string") recordSentText(data);
    super.send(data);
  }
};

// Records the speech.config / speech.context messages the SDK actually sends, to check
// whether the pronunciation assessment parameters reach the service.
function recordSentText(text) {
  const match = /^Path:\s*(speech\.context|speech\.config)\s*$/im.exec(text);
  if (!match) return;
  const bodyStart = text.indexOf("\r\n\r\n");
  const body = bodyStart === -1 ? "" : text.slice(bodyStart + 4);
  let json;
  try {
    json = JSON.parse(redact(body));
  } catch {
    json = { unparsed: redact(body).slice(0, 2000) };
  }
  const pa = json?.phraseDetection?.enrichment?.pronunciationAssessment;
  findings.sentContexts.push({ at: new Date().toISOString(), path: match[1].toLowerCase(), body: json });
  if (match[1].toLowerCase() === "speech.context") {
    log(`Sent speech.context: pronunciationAssessment ${pa ? "PRESENT" : "ABSENT"}; phraseOutput=${JSON.stringify(json?.phraseOutput ?? null)}`);
  }
}

/* ---------- credentials and SDK config ---------- */

// Azure region codes are lowercase with no spaces ("westeurope"). Users often paste the
// display name ("West Europe"), which yields a non-existent host and a ConnectionFailure.
function normalizeRegion(raw) {
  return raw.replace(/\s+/g, "").toLowerCase();
}

function readCredentials() {
  const key = $("key").value.trim();
  const raw = $("region").value.trim();
  const region = normalizeRegion(raw);
  secrets.add(key);
  if (!key || !region) throw new Error("Enter key and region first.");
  if (!/^[a-z0-9]+$/.test(region)) {
    throw new Error(`Region "${raw}" is not a region code. Use the short code from Keys and Endpoint, e.g. westeurope.`);
  }
  if (region !== raw) {
    findings.meta.regionNormalized = { from: raw, to: region };
    $("region").value = region;
    log(`Region normalized: "${raw}" -> "${region}"`);
  }
  return { key, region };
}

async function fetchToken(key, region) {
  const url = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  const entry = { at: new Date().toISOString(), purpose: "issueToken", host: new URL(url).host };
  findings.http.push(entry);
  try {
    const response = await fetch(url, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key } });
    entry.status = response.status;
    const body = await response.text();
    if (!response.ok) {
      entry.body = redact(body).slice(0, 300);
      throw new Error(`issueToken HTTP ${response.status}`);
    }
    secrets.add(body);
    entry.tokenLength = body.length;
    return body;
  } catch (error) {
    entry.error = entry.error ?? redact(`${error.name}: ${error.message}`);
    throw error;
  }
}

async function speechConfigFor({
  key,
  region,
  locale,
  auth = $("auth").value,
  workerOff = $("workerOff").checked,
  endpoint = $("endpoint").value,
}) {
  let config;
  if (auth === "token") token = await fetchToken(key, region);
  if (endpoint === "v1-conversation") {
    // Classic endpoint used by older SDKs; the default in 1.52 is /stt/speech/universal/v2.
    const url = new URL(`wss://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`);
    if (auth === "token") {
      config = sdk.SpeechConfig.fromEndpoint(url);
      config.authorizationToken = token;
    } else {
      config = sdk.SpeechConfig.fromEndpoint(url, key);
    }
  } else if (auth === "token") {
    config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  } else {
    config = sdk.SpeechConfig.fromSubscription(key, region);
  }
  config.speechRecognitionLanguage = locale;
  if (workerOff) config.setProperty(sdk.PropertyId.WebWorkerLoadType, "off");
  return { config, auth, workerOff, endpoint };
}

// Microsoft's continuous sample lowercases the reference text and strips punctuation.
function sampleStyleReference(text) {
  return text
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ""))
    .filter(Boolean)
    .join(" ");
}

/* ---------- one recognition session over a push stream ---------- */

function startSession({ setup, locale, referenceText, label, onPartial, onError }) {
  const { config } = setup;
  const format = sdk.AudioStreamFormat.getWaveFormatPCM(TARGET_SAMPLE_RATE, 16, 1);
  const pushStream = sdk.AudioInputStream.createPushStream(format);
  const recognizer = new sdk.SpeechRecognizer(config, sdk.AudioConfig.fromStreamInput(pushStream));

  const assessment = new sdk.PronunciationAssessmentConfig(
    referenceText,
    sdk.PronunciationAssessmentGradingSystem.HundredMark,
    sdk.PronunciationAssessmentGranularity.Phoneme,
    true,
  );
  assessment.phonemeAlphabet = "IPA";
  assessment.enableProsodyAssessment = PROSODY_LOCALES.includes(locale);
  assessment.applyTo(recognizer);

  const t0 = performance.now();
  const stamp = () => Math.round(performance.now() - t0);
  const run = {
    label,
    locale,
    auth: setup.auth,
    workerOff: setup.workerOff,
    endpoint: setup.endpoint,
    referenceText,
    prosodyRequested: assessment.enableProsodyAssessment,
    events: [],
    recognizedReasons: [],
    segments: [],
    canceled: null,
    pushedSamples: 0,
  };

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  recognizer.sessionStarted = () => run.events.push({ event: "sessionStarted", ms: stamp() });
  recognizer.sessionStopped = () => {
    run.events.push({ event: "sessionStopped", ms: stamp() });
    resolveDone("sessionStopped");
  };
  recognizer.recognizing = (_s, e) => onPartial?.(e.result.text);
  recognizer.recognized = (_s, e) => {
    const reason = sdk.ResultReason[e.result.reason];
    run.recognizedReasons.push(reason);
    run.events.push({ event: `recognized:${reason}`, ms: stamp() });
    const json = e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
    if (json) run.segments.push(JSON.parse(json));
    log(`[${label}] recognized ${reason}: ${e.result.text ?? ""}`);
  };
  recognizer.canceled = (_s, e) => {
    run.canceled = {
      reason: sdk.CancellationReason[e.reason],
      errorCode: e.errorCode,
      errorCodeName: sdk.CancellationErrorCode[e.errorCode],
      errorDetails: redact(e.errorDetails),
      ms: stamp(),
    };
    log(`[${label}] canceled ${run.canceled.reason} ${run.canceled.errorCodeName ?? ""} ${run.canceled.errorDetails}`);
    resolveDone("canceled");
    if (run.canceled.reason === "Error") onError?.();
  };

  recognizer.startContinuousRecognitionAsync(
    () => run.events.push({ event: "startOk", ms: stamp() }),
    (error) => {
      run.startError = redact(error);
      resolveDone("startError");
    },
  );

  return {
    run,
    push(int16) {
      pushStream.write(int16.buffer.slice(int16.byteOffset, int16.byteOffset + int16.byteLength));
      run.pushedSamples += int16.length;
    },
    async finish(timeoutMs = 20000) {
      pushStream.close();
      run.events.push({ event: "pushStreamClosed", ms: stamp() });
      run.endedBy = await Promise.race([done, sleep(timeoutMs).then(() => "timeout")]);
      await new Promise((resolve) => recognizer.stopContinuousRecognitionAsync(resolve, resolve));
      recognizer.close();
      run.events.push({ event: "closed", ms: stamp() });
      return run;
    },
  };
}

/* ---------- microphone capture through the worklet ---------- */

async function startMicCapture(onPcm) {
  const constraints = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  const context = new AudioContext();
  await context.audioWorklet.addModule("../src/recorder-worklet.js");
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "recorder-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(context.destination);

  const downsample = createDownsampler(context.sampleRate, TARGET_SAMPLE_RATE);
  let resolveFlushed;
  const flushed = new Promise((resolve) => {
    resolveFlushed = resolve;
  });
  node.port.onmessage = (event) => {
    if (event.data.type === "frames") onPcm(downsample(event.data.samples));
    else if (event.data.type === "flushed") resolveFlushed();
  };

  return {
    contextSampleRate: context.sampleRate,
    trackSettings: stream.getAudioTracks()[0].getSettings(),
    requestedConstraints: constraints,
    async stop() {
      node.port.postMessage({ type: "flush" });
      await Promise.race([flushed, sleep(500)]);
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
    },
  };
}

/* ---------- section 2: assessment run ---------- */

let active = null;

async function onRecord() {
  if (busy) return;
  let credentials;
  try {
    credentials = readCredentials();
  } catch (error) {
    log(error.message);
    return;
  }
  setBusy(true);
  $("btnStop").disabled = false;
  $("results").replaceChildren();
  $("live").textContent = "";

  const locale = $("locale").value;
  const referenceText = $("normalizeRef").checked ? sampleStyleReference($("text").value) : $("text").value.trim();
  const chunks = [];
  let samplesSeen = 0;
  let onsetSample = null;
  let loudStart = null; // start sample of the current run of loud windows
  let loudWindows = 0;

  try {
    const setup = await speechConfigFor({ ...credentials, locale });
    const session = startSession({
      setup,
      locale,
      referenceText,
      label: `mic-${locale}`,
      onPartial: (text) => {
        $("live").textContent = text;
      },
      // Stop the microphone as soon as Azure cancels with an error, so a failed run is obvious.
      onError: () => onStop(),
    });
    const capture = await startMicCapture((float16k) => {
      const int16 = floatToInt16(float16k);
      session.push(int16);
      chunks.push(int16);
      for (let i = 0; onsetSample === null && i + ONSET_WINDOW <= float16k.length; i += ONSET_WINDOW) {
        if (rms(float16k.subarray(i, i + ONSET_WINDOW)) > ONSET_RMS) {
          if (loudWindows === 0) loudStart = samplesSeen + i;
          loudWindows += 1;
          if (loudWindows >= ONSET_MIN_WINDOWS) onsetSample = loudStart;
        } else {
          loudWindows = 0;
        }
      }
      samplesSeen += float16k.length;
    });
    const started = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - started;
      $("timer").textContent = formatMs(elapsed);
      if (elapsed >= MAX_RECORDING_MS) onStop();
    }, 200);
    active = { session, capture, chunks, timer, getOnset: () => onsetSample };
    if (session.run.canceled?.reason === "Error") onStop(); // canceled before capture was ready
    log(`Recording ${locale}: context ${capture.contextSampleRate} Hz, track ${JSON.stringify(capture.trackSettings)}`);
  } catch (error) {
    const isMic = ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError"].includes(error.name);
    findings.probes.push({ case: isMic ? "microphone" : "start-failed", name: error.name, message: redact(error.message) });
    log(`Start failed: ${error.name}: ${error.message}`);
    $("btnStop").disabled = true;
    setBusy(false);
  }
}

async function onStop() {
  if (!active) return;
  const { session, capture, chunks, timer, getOnset } = active;
  active = null;
  clearInterval(timer);
  $("btnStop").disabled = true;
  await capture.stop();
  log("Mic stopped; waiting for final results…");
  const run = await session.finish();

  const pcm = concatInt16(chunks);
  run.capture = {
    contextSampleRate: capture.contextSampleRate,
    trackSettings: capture.trackSettings,
    requestedConstraints: capture.requestedConstraints,
    localSamples: pcm.length,
    pushedEqualsLocal: pcm.length === run.pushedSamples,
  };
  run.summary = summarize(run);
  run.alignment = alignmentCheck(run, getOnset());
  findings.runs.push(run);
  log(`Run done: ${run.summary.segmentCount} segments, ended by ${run.endedBy}. Onset check: ${JSON.stringify(run.alignment)}`);
  renderRun(run, pcm);
  setBusy(false);
}

/* ---------- analysis helpers ---------- */

function summarize(run) {
  const segments = run.segments.map((segment, index) => {
    const best = segment.NBest?.[0] ?? {};
    const pa = best.PronunciationAssessment ?? {};
    const words = best.Words ?? [];
    const phonemes = words.flatMap((w) => w.Phonemes ?? []);
    const errorTypes = {};
    for (const w of words) {
      const type = w.PronunciationAssessment?.ErrorType ?? "(missing)";
      errorTypes[type] = (errorTypes[type] ?? 0) + 1;
    }
    return {
      index,
      recognitionStatus: segment.RecognitionStatus,
      displayText: segment.DisplayText,
      segmentOffsetTicks: segment.Offset,
      segmentDurationTicks: segment.Duration,
      scores: {
        accuracy: pa.AccuracyScore,
        fluency: pa.FluencyScore,
        completeness: pa.CompletenessScore,
        pron: pa.PronScore,
        prosody: pa.ProsodyScore,
      },
      hasProsodyField: "ProsodyScore" in pa,
      wordCount: words.length,
      errorTypes,
      phonemeCount: phonemes.length,
      phonemesWithName: phonemes.filter((p) => p.Phoneme).length,
      firstWordOffsetTicks: words[0]?.Offset,
    };
  });
  return { segmentCount: segments.length, segments };
}

function alignmentCheck(run, onsetSample) {
  const firstSpoken = run.segments
    .flatMap((s) => s.NBest?.[0]?.Words ?? [])
    .find((w) => w.PronunciationAssessment?.ErrorType !== "Omission" && Number.isFinite(w.Offset));
  if (!firstSpoken || onsetSample === null) return { available: false };
  const firstWordMs = (firstSpoken.Offset / TICKS_PER_SECOND) * 1000;
  const onsetMs = (onsetSample / TARGET_SAMPLE_RATE) * 1000;
  return {
    available: true,
    firstWord: firstSpoken.Word,
    firstWordOffsetMs: Math.round(firstWordMs),
    localOnsetMs: Math.round(onsetMs),
    deltaMs: Math.round(firstWordMs - onsetMs),
    note: "Onset = first 100 ms of sustained sound. Expect |delta| < ~150 ms if offset 0 = first pushed sample; confirm by ear with ▶.",
  };
}

/* ---------- rendering (textContent only) ---------- */

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

let playbackContext = null;

function playSamples(pcm, start, end) {
  playbackContext ??= new AudioContext();
  const slice = int16ToFloat(pcm.subarray(start, end));
  const buffer = playbackContext.createBuffer(1, slice.length, TARGET_SAMPLE_RATE);
  buffer.copyToChannel(slice, 0);
  const source = playbackContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackContext.destination);
  source.start();
}

function renderRun(run, pcm) {
  const container = $("results");
  const playAll = el("button", "Play whole recording");
  playAll.type = "button";
  playAll.addEventListener("click", () => playSamples(pcm, 0, pcm.length));
  container.append(playAll);

  const summaryTable = el("table");
  summaryTable.append(row("th", ["Seg", "Status", "Words", "ErrorTypes", "Acc", "Flu", "Compl", "Pron", "Prosody", "Phonemes (named/total)"]));
  for (const s of run.summary.segments) {
    summaryTable.append(
      row("td", [
        s.index,
        s.recognitionStatus,
        s.wordCount,
        JSON.stringify(s.errorTypes),
        s.scores.accuracy,
        s.scores.fluency,
        s.scores.completeness,
        s.scores.pron,
        s.hasProsodyField ? s.scores.prosody : "(absent)",
        `${s.phonemesWithName}/${s.phonemeCount}`,
      ]),
    );
  }
  container.append(el("h3", "Segments"), summaryTable);

  const wordTable = el("table");
  wordTable.append(row("th", ["Seg", "Word", "Offset ms", "Dur ms", "Acc", "ErrorType", "Phonemes", "Play"]));
  run.segments.forEach((segment, segIndex) => {
    for (const w of segment.NBest?.[0]?.Words ?? []) {
      const pa = w.PronunciationAssessment ?? {};
      const tr = row("td", [
        segIndex,
        w.Word,
        Math.round(w.Offset / 10_000),
        Math.round(w.Duration / 10_000),
        pa.AccuracyScore,
        pa.ErrorType,
        (w.Phonemes ?? []).map((p) => `${p.Phoneme || "∅"}:${p.PronunciationAssessment?.AccuracyScore}`).join(" "),
      ]);
      tr.className = `err-${pa.ErrorType}`;
      const cell = el("td");
      const range = Number.isFinite(w.Offset)
        ? playbackRange(
            { offsetTicks: w.Offset, durationTicks: w.Duration ?? 0 },
            { paddingMs: PLAYBACK_PADDING_MS, sampleRate: TARGET_SAMPLE_RATE, totalSamples: pcm.length },
          )
        : null;
      if (range && pa.ErrorType !== "Omission") {
        const button = el("button", "▶");
        button.type = "button";
        button.addEventListener("click", () => playSamples(pcm, range.start, range.end));
        cell.append(button);
      }
      tr.append(cell);
      wordTable.append(tr);
    }
  });
  container.append(el("h3", "Words (click ▶ and listen: the word should be whole and alone)"), wordTable);
}

function row(cellTag, values) {
  const tr = el("tr");
  for (const value of values) tr.append(el(cellTag, value ?? ""));
  return tr;
}

/* ---------- probes ---------- */

function nearSilence(samples) {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) out[i] = (Math.random() - 0.5) * 0.002;
  return floatToInt16(out);
}

async function syntheticSession({ setup, locale, seconds, realtime, label }) {
  const session = startSession({ setup, locale, referenceText: "Hello world.", label });
  const chunk = TARGET_SAMPLE_RATE / 10;
  for (let i = 0; i < seconds * 10; i += 1) {
    session.push(nearSilence(chunk));
    if (realtime) await sleep(100);
  }
  return session.finish(15000);
}

function probeRecord(caseName, run, extra = {}) {
  const entry = {
    case: caseName,
    auth: run.auth,
    workerOff: run.workerOff,
    endedBy: run.endedBy,
    startError: run.startError,
    canceled: run.canceled,
    recognizedReasons: run.recognizedReasons,
    segments: run.segments,
    events: run.events,
    ...extra,
  };
  findings.probes.push(entry);
  log(`Probe ${caseName}: endedBy=${entry.endedBy} canceled=${JSON.stringify(entry.canceled)} reasons=${entry.recognizedReasons.join(",")}`);
  return entry;
}

async function probe(caseName, fn) {
  if (busy) return;
  setBusy(true);
  log(`Probe ${caseName} started`);
  try {
    await fn();
  } catch (error) {
    findings.probes.push({ case: caseName, thrown: redact(`${error.name}: ${error.message}`) });
    log(`Probe ${caseName} threw: ${error.name}: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

const locale = () => $("locale").value;

const probes = {
  btnToken: () =>
    probe("token-endpoint", async () => {
      const { key, region } = readCredentials();
      token = await fetchToken(key, region);
      findings.probes.push({ case: "token-endpoint", ok: true, tokenLength: token.length });
      log(`Token OK (length ${token.length})`);
    }),
  btnBadKey: () =>
    probe("invalid-key", async () => {
      const { region } = readCredentials();
      const badKey = "0".repeat(32);
      if ($("auth").value === "token") {
        try {
          await fetchToken(badKey, region);
        } catch (error) {
          findings.probes.push({ case: "invalid-key-token", error: redact(error.message), http: findings.http.at(-1) });
          log(`Invalid key via issueToken: ${error.message}`);
        }
      }
      const setup = await speechConfigFor({ key: badKey, region, locale: locale(), auth: "key" });
      probeRecord("invalid-key", await syntheticSession({ setup, locale: locale(), seconds: 2, realtime: false, label: "bad-key" }));
    }),
  btnBadRegion: () =>
    probe("nonexistent-region", async () => {
      const { key } = readCredentials();
      const setup = await speechConfigFor({ key, region: "nosuchregion1", locale: locale(), auth: "key" });
      probeRecord("nonexistent-region", await syntheticSession({ setup, locale: locale(), seconds: 2, realtime: false, label: "bad-region" }));
    }),
  btnWrongRegion: () =>
    probe("wrong-real-region", async () => {
      const { key, region } = readCredentials();
      const other = region === "eastus" ? "westeurope" : "eastus";
      const setup = await speechConfigFor({ key, region: other, locale: locale(), auth: "key" });
      probeRecord("wrong-real-region", await syntheticSession({ setup, locale: locale(), seconds: 2, realtime: false, label: "wrong-region" }), { usedRegion: other });
    }),
  btnNoSpeech: () =>
    probe("no-speech", async () => {
      const setup = await speechConfigFor({ ...readCredentials(), locale: locale() });
      probeRecord("no-speech", await syntheticSession({ setup, locale: locale(), seconds: 5, realtime: false, label: "no-speech" }));
    }),
  btnConcurrent: () =>
    probe("concurrent-sessions", async () => {
      const credentials = readCredentials();
      const setups = await Promise.all([1, 2].map(() => speechConfigFor({ ...credentials, locale: locale() })));
      const runs = await Promise.all(
        setups.map((setup, i) => syntheticSession({ setup, locale: locale(), seconds: 8, realtime: true, label: `concurrent-${i + 1}` })),
      );
      runs.forEach((run, i) => probeRecord(`concurrent-session-${i + 1}`, run));
    }),
  btnWorkerOn: () =>
    probe("sdk-worker-on", async () => {
      const setup = await speechConfigFor({ ...readCredentials(), locale: locale(), workerOff: false });
      const before = findings.csp.violations.length;
      const run = await syntheticSession({ setup, locale: locale(), seconds: 3, realtime: false, label: "worker-on" });
      probeRecord("sdk-worker-on", run, { newCspViolations: findings.csp.violations.slice(before) });
    }),
  btnNetwork: () =>
    probe("network-failure", async () => {
      const setup = await speechConfigFor({ ...readCredentials(), locale: locale(), auth: "key" });
      probeRecord("network-failure", await syntheticSession({ setup, locale: locale(), seconds: 2, realtime: false, label: "offline" }), {
        navigatorOnLine: navigator.onLine,
      });
    }),
  btnCsp: () =>
    probe("csp-non-azure-fetch", async () => {
      const before = findings.csp.violations.length;
      let outcome;
      try {
        await fetch("https://example.com/", { mode: "no-cors" });
        outcome = "fetch succeeded (CSP did NOT block)";
      } catch (error) {
        outcome = `fetch failed: ${error.name}`;
      }
      await sleep(200);
      findings.probes.push({ case: "csp-non-azure-fetch", outcome, newCspViolations: findings.csp.violations.slice(before) });
      log(`CSP probe: ${outcome}`);
    }),
};

/* ---------- download ---------- */

function onDownload() {
  findings.notes = $("notes").value;
  findings.meta.downloadedAt = new Date().toISOString();
  const json = redact(JSON.stringify(findings, null, 2));
  const blob = new Blob([json], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `spike-findings-${findings.meta.downloadedAt.replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ---------- utilities and wiring ---------- */

function concatInt16(chunks) {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function setBusy(value) {
  busy = value;
  for (const id of ["btnRecord", "btnToken", ...Object.keys(probes)]) $(id).disabled = value;
}

function applyLocale() {
  $("text").value = TEXTS[locale()];
  $("protocol").textContent = PROTOCOL[locale()];
}

function init() {
  if (!sdk) {
    log("Speech SDK did not load. Check the vendor path and the CSP log above.");
    return;
  }
  $("locale").addEventListener("change", applyLocale);
  $("btnRecord").addEventListener("click", onRecord);
  $("btnStop").addEventListener("click", onStop);
  $("btnDownload").addEventListener("click", onDownload);
  for (const [id, handler] of Object.entries(probes)) $(id).addEventListener("click", handler);
  applyLocale();
  log(`Ready. SDK ${SDK_VERSION} loaded under CSP; ticks→samples check: 1 s = ${ticksToSamples(TICKS_PER_SECOND, TARGET_SAMPLE_RATE)} samples.`);
}

init();
