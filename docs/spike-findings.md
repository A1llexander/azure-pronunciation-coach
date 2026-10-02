# Spike findings (Oct 1–2, 2026)

Chrome 154 and Edge 154 on Windows, Speech SDK 1.52.0 (vendored), F0 key in `eastus`, page served from GitHub Pages under the target CSP. Raw `findings.json` files are not committed; the Azure responses used by tests are in `tests/fixtures/`.

## Settled

| Question | Answer |
| --- | --- |
| 16 kHz Int16 mono via push stream | Accepted. Pushed samples = locally kept samples in every run. |
| Offset 0 = first pushed sample | Yes. First-word offset vs local speech onset: −15 to −101 ms in 6 runs (detector latency). Word playback sounds right by ear, slightly generous with 120 ms padding. |
| Pronunciation assessment present | Yes in all runs but one early run (cause not found). The app shows "Assessment unavailable, please retry" if it happens. |
| Per-segment Omission / Insertion / Completeness | Not reported in continuous mode; per-segment Completeness ignores unread text (96–100 with <50 % read). Recomputed by `assessment.js`. |
| Insertions | Scripted mode spells an extra word as a reference word ("fresh" → "wraps"). Shown as a marker, not as text. |
| en-US data | IPA phoneme names on every phoneme; ProsodyScore per segment; syllables also returned. |
| es-ES data | Phoneme scores with empty names; no ProsodyScore. Matches the spec's data-driven rules. |
| Endpoint | SDK default `wss://{region}.stt.speech.microsoft.com/stt/speech/universal/v2`; classic v1 behaves the same. |
| Key in WebSocket URL | Yes (`Ocp-Apim-Subscription-Key` query parameter) → use a token. |
| Token exchange | `POST https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken` works from the browser (CORS OK, CSP OK). With a token the URL carries `Authorization`, never the key. |
| `connect-src` hosts | `wss://*.stt.speech.microsoft.com https://*.api.cognitive.microsoft.com`. A fetch to example.com is blocked. |
| Worklet and SDK under CSP | No violations with `script-src 'self'` and no `'unsafe-eval'`. SDK timer worker on/off made no difference in a 3 s session; keep `WebWorkerLoadType=off` as the safe default. |
| Microphone | Browser returns 2 channels when 1 is requested; the worklet node down-mixes. Context rate 48 kHz. |
| F0 concurrency | Two simultaneous 8 s sessions on one F0 key both succeeded. Microsoft documents a limit of 1; the "key already in use" error could not be reproduced. |

## Error mapping

With token auth, most failures surface at `issueToken`, before the WebSocket opens, which is the only place they can be told apart.

| Case | What the app sees | Message (spec table) |
| --- | --- | --- |
| Invalid key | `issueToken` HTTP 401 | Key or region rejected |
| Key from another region (valid region name) | `issueToken` HTTP 401 | Key or region rejected |
| Non-existent region | `issueToken` fetch `TypeError` | Connection to Azure failed (check region and internet) |
| Offline | `issueToken` fetch `TypeError`, `navigator.onLine === false` | Connection to Azure failed |
| Region not a code (`East US`, `east_us`) | rejected before any request; spaces and case normalized | Key or region rejected |
| Any of the above with key auth on the WebSocket | `canceled` Error, `ConnectionFailure` (4), "StatusCode: 1006" — indistinguishable | (not used: the app uses tokens) |
| No speech | `RecognitionStatus: Success`, text ".", no `Words` | No speech detected — decided by zero recognized words |
| Microphone denied | `getUserMedia` → `NotAllowedError` | No microphone access |
| No microphone | `NotFoundError` (standard; not reproduced) | No microphone detected |
| Too many sessions | SDK `CancellationErrorCode.TooManyRequests` (3) per SDK source; not reproduced | This key is already in use |
| Quota exhausted | not reproducible on demand; expected HTTP 403 / `Forbidden` (8) per SDK source | Free monthly quota used up |

## Browsers

- Chrome 154: all runs above.
- Edge 154: en-US run with assessment, IPA phonemes and prosody; no CSP violations; offset vs onset −81 ms.
- Firefox: **not tested** (not available to the tester). Known risk to check in the manual test: Firefox rejects `createMediaStreamSource` when the AudioContext rate differs from the microphone rate.

## Not covered yet

- Firefox.
- Quota exhausted and "too many sessions" codes (only from SDK source).

The spike page was removed after these findings; it is kept on branch `archive/spike` (`git checkout archive/spike`, then serve the repo root and open `/spike/`).
