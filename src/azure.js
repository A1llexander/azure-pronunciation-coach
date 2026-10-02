/**
 * Azure Speech wiring: token exchange, continuous pronunciation assessment over
 * a push stream, and error mapping. The key is only ever sent to issueToken in
 * a header; the WebSocket carries the 10-minute token (the SDK would otherwise
 * put the key in the URL, see docs/spike-findings.md).
 */

import { TARGET_SAMPLE_RATE, PROSODY_LOCALES } from "./config.js";
import { AppError, classifyTokenFailure, classifyCancellation } from "./errors.js";

/** How long to wait for final results after the audio ends. */
const FINISH_TIMEOUT_MS = 20_000;

/**
 * Exchange the key for a 10-minute authorization token.
 *
 * @param {string} key
 * @param {string} region Normalized region code.
 * @returns {Promise<string>}
 * @throws {AppError} key-rejected, quota, busy or network.
 */
export async function fetchToken(key, region) {
  let response;
  try {
    response = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new AppError(classifyTokenFailure({}));
  }
  if (!response.ok) throw new AppError(classifyTokenFailure({ status: response.status }));
  return response.text();
}

/**
 * @typedef {object} Session
 * @property {Promise<void>} started Resolves when recognition has started.
 * @property {(pcm: Int16Array) => void} push Send 16 kHz Int16 mono audio.
 * @property {() => Promise<object[]>} finish End the audio and return all recognized segments (Azure JSON).
 * @property {() => void} abort Close without waiting for results.
 */

/**
 * Start continuous scripted pronunciation assessment.
 *
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.region
 * @param {string} options.locale "en-US" or "es-ES".
 * @param {string} options.referenceText
 * @param {(text: string) => void} options.onText Live transcript: final text so far plus the current partial.
 * @param {(error: AppError) => void} options.onError Azure cancelled the session with an error.
 * @returns {Session}
 */
export function startSession({ token, region, locale, referenceText, onText, onError }) {
  const sdk = window.SpeechSDK;
  const config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  config.speechRecognitionLanguage = locale;
  // Keep the SDK from starting its data: URL timer worker (CSP worker-src 'self').
  config.setProperty(sdk.PropertyId.WebWorkerLoadType, "off");

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

  const segments = [];
  let finalText = "";
  let failure = null;
  let closed = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  recognizer.recognizing = (_s, e) => onText(join(finalText, e.result.text));
  recognizer.recognized = (_s, e) => {
    const json = e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
    if (json) segments.push(JSON.parse(json));
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech) finalText = join(finalText, e.result.text);
    onText(finalText);
  };
  recognizer.canceled = (_s, e) => {
    if (e.reason === sdk.CancellationReason.Error) {
      failure = new AppError(classifyCancellation(sdk.CancellationErrorCode[e.errorCode]));
      if (!closed) onError(failure);
    }
    resolveDone();
  };
  recognizer.sessionStopped = () => resolveDone();

  const started = new Promise((resolve, reject) => {
    recognizer.startContinuousRecognitionAsync(resolve, () => reject(new AppError("network")));
  });

  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolve) => recognizer.stopContinuousRecognitionAsync(resolve, resolve));
    recognizer.close();
  };

  return {
    started,
    push(pcm) {
      if (!closed) pushStream.write(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    },
    async finish() {
      pushStream.close();
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, FINISH_TIMEOUT_MS))]);
      await close();
      if (failure) throw failure;
      return segments;
    },
    abort() {
      pushStream.close();
      close();
    },
  };
}

function join(a, b) {
  return [a, b].filter(Boolean).join(" ");
}
