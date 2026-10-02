# Pronunciation Coach — v1 Spec

Oct 1, 2026 · @Aleksandr

## Overview

A static web app on GitHub Pages that wraps Azure Speech pronunciation assessment in a simple UI: paste text, read it aloud, get word-level scores and errors, and replay any word as you said it.

- **Users:** language learners who are not developers (the author, family, friends), plus developers who fork the repo.
- **Goals:** personal daily use; share with a small circle; open-source on GitHub; a LinkedIn post with a demo GIF.
- **Key model:** bring your own key (BYOK). Each user enters their own Azure Speech key and region. There is no backend; audio goes from the browser straight to Azure.
- **Recommended key tier:** F0 (free). F0 rejects requests once the monthly quota is used up, so a leaked key cannot create charges. It can still burn the owner's monthly quota.
- **Working name:** Pronunciation Coach (placeholder, can change).

## Scope

**In v1**

- Desktop browsers only (latest Chrome, Edge, Firefox). The page shows a "desktop only" notice on mobile.
- English UI.
- Languages: en-US and es-ES.
- Reading (scripted) mode only: the user pastes a reference text and reads it.
- Continuous recording up to 2 minutes, with a live transcript while recording.
- Results after Stop: overall score, score breakdown, word-level highlighting, phoneme tooltip, replay of a single word.
- Key security measures (see Security).
- Unit tests for pure logic, lint, CI on GitHub Actions.
- README with a step-by-step guide to getting an F0 key.

**Out of v1**

- Mobile support (iOS Safari recording is a known risk).
- Free speech (unscripted) mode.
- Text-to-speech "how it should sound".
- Result history, accounts, any backend.
- Own IPA transcription for Spanish.

## User flow

1. First visit: the user enters the Azure Speech key and region, and chooses whether to remember the key on this device.
2. The user picks a language (en-US or es-ES) and pastes the reference text.
3. The user presses **Record**. The browser asks for microphone access. A timer starts and the recognized text appears live.
4. The user presses **Stop**. Recording also stops automatically at 2 minutes or after 10 seconds of silence.
5. The results view appears: overall score, breakdown, and the reference text with highlighted words.
6. Hovering a word shows its score and, when available, phoneme names with scores.
7. Clicking a spoken word plays that word from the user's recording.
8. The user can edit the text and record again. The previous result and recording are discarded.

## Functional requirements

**Recording**

- One `getUserMedia` stream feeds an AudioWorklet (`recorder-worklet.js`, loaded from a same-origin file, not a Blob URL). The worklet downsamples to 16 kHz and converts Float32 to 16-bit mono PCM, the default format of the SDK push stream.
- The same PCM chunks are pushed to the Speech SDK and kept in memory for playback. The local audio is exactly the stream Azure received, so word offsets align by construction: offset 0 = first pushed sample.
- No MediaRecorder: its WebM output has unreliable seeking.
- Hard limit of 2 minutes, a visible countdown timer, and auto-stop after 10 s of silence. Silence is detected locally by RMS level on the worklet output; threshold and duration live in `config.js`.
- Record is disabled until key, region, language and non-empty text are set.
- Reference text limit: 1,500 characters, plus a warning when the text length predicts more than 2 minutes of reading.

**Results**

- Overall pronunciation score (0–100) shown as a ring, with color bands: 0–59 red, 60–79 yellow, 80–100 green.
- Breakdown bars: Accuracy, Fluency, Completeness, Prosody. Prosody appears only when the field is present in the Azure response (currently en-US only).
- Reference text rendered word by word:
  - mispronounced: yellow highlight;
  - omitted: red, strikethrough or bracketed;
  - inserted (said but not in the text): shown in place with a distinct style;
  - correct: no highlight.
- Tooltip on hover: word and score; phoneme names with per-phoneme scores **only when Azure returns non-empty phoneme names**. Decide by the data, not by the language, so es-ES support starts working when Azure adds it.

**Word playback**

- Click on a spoken word plays the segment \[offset − 120 ms, offset + duration + 120 ms\] from the in-memory PCM buffer, clamped to the recording bounds. Playback uses an AudioBuffer and AudioBufferSourceNode for sample-exact seeking. Padding is a named constant, tuned in testing.
- Omitted words are not clickable.
- Audio lives in memory only and is discarded on a new recording or page reload.

## Azure integration

Use the official Microsoft Speech SDK for JavaScript (`microsoft-cognitiveservices-speech-sdk`), pinned to an exact version.

**Assessment config**

- Reference text set (scripted mode), grading system HundredMark, granularity Phoneme, miscue enabled.
- Phoneme alphabet IPA.
- Prosody assessment enabled for en-US only.
- Continuous recognition: `startContinuousRecognitionAsync` / `stopContinuousRecognitionAsync`; live text from the `recognizing` event; per-segment results from `recognized`.

**Aggregation (main technical task)**

- Continuous mode returns several segments. Merge their word lists, then compute final scores yourself. Base the method on Microsoft's official JS continuous pronunciation assessment sample, not on an invented formula.
- In continuous scripted mode each segment is assessed against the whole reference text, so per-segment Omission/Insertion flags and Completeness are meaningless (segment 1 reports the rest of the text as omitted). Discard them. Keep from Azure only per-word accuracy, mispronunciation flags and phoneme data; recompute omissions, insertions and Completeness from your own alignment of all recognized words against the reference text. Confirm this behavior against the Microsoft sample in the spike.
- Offsets and durations are in 100-ns ticks. Verify in the spike that offset 0 corresponds to the first pushed PCM sample.

**Verified service constraints**

- Phoneme names come back only for en-US (IPA). For es-ES only phoneme scores are returned with empty names; confirmed by a manual test in Speech Studio.
- Prosody score exists only for en-US.
- Content assessment (vocabulary, grammar, topic) has been retired; not used.

Sources: [Use pronunciation assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment), [SDK samples](https://github.com/Azure-Samples/cognitive-services-speech-sdk).

## Security

A key in the browser cannot be protected from code running on the page. The goal is that no foreign code runs on the page and that the key never leaves the browser except to Azure.

1. **No XSS.** User text and Azure results are rendered only via `textContent` / DOM nodes. No `innerHTML`, `insertAdjacentHTML`, `eval` or string-built HTML anywhere; enforce with a lint rule.
2. **No third-party runtime scripts.** Vendor the pinned Speech SDK bundle into the repo (record version and SHA-256 in the README). If a CDN is used instead, it must have an SRI hash. No analytics, fonts or trackers.
3. **CSP** via a `<meta http-equiv="Content-Security-Policy">` tag: `default-src 'self'`, `script-src 'self'` (no inline scripts, no 'unsafe-eval'), `connect-src` limited to Azure Speech hosts by wildcard (e.g. wss://\*.stt.speech.microsoft.com, plus the token host if used). A meta CSP is fixed at page load, so it cannot be scoped to the region entered at runtime. The spike confirms the exact hosts and that the vendored SDK bundle runs without 'unsafe-eval'; the lint rule covers only our code.
4. **Storage by choice.** "Remember key on this device" checkbox: on → `localStorage`; off → memory only, lost on tab close. A "Forget key" button clears all stored values.
5. **Key never exposed.** Not in page URLs, console logs or error messages; masked input field; errors from the SDK are sanitized before display. The spike checks whether the SDK puts the key in the WebSocket URL query string (visible in DevTools and Azure-side logs). If it does, exchange the key for a 10-minute token via the region's issueToken endpoint and use SpeechConfig.fromAuthorizationToken; a 2-minute session fits in the token lifetime.
6. **README guidance:** use an F0 resource only (a leaked F0 key cannot create charges but can burn the monthly quota); use the official URL, not forks; rotate the key in the Azure portal if a leak is suspected; malicious browser extensions are a residual risk that the app cannot prevent.

## Error handling

Every failure shows a short, plain-English message with the next step. Nothing fails silently.

| Case | Message shows | Next step for the user |
| --- | --- | --- |
| Invalid key or region | Key or region rejected | Check both fields; README link |
| Quota exhausted | Free monthly quota used up | Wait for next month or use another key |
| Too many sessions on one F0 key | This key is already in use | Wait and retry; one session at a time per F0 key |
| Microphone denied | No microphone access | How to allow it in the browser |
| No microphone found | No microphone detected | Connect one and retry |
| Nothing recognized / too quiet | No speech detected | Speak closer to the mic and retry |
| Network or service error | Connection to Azure failed | Retry; check internet |
| Mobile browser | Desktop only for now | Open on a computer |

The exact Azure error codes for each case are mapped in the spike, not guessed.

## Architecture and code quality

Plain JavaScript ES modules, no framework, no build step. The repo root is served as-is by GitHub Pages.

| Module | Responsibility | Pure logic? |
| --- | --- | --- |
| `config.js` | Limits, padding, silence threshold, color bands, locales as named constants | Yes |
| `keyStore.js` | Save, load, forget key and region | No (storage) |
| `pcm.js` | Downsampling to 16 kHz, Float32 to Int16 conversion, RMS level | Yes |
| `recorder-worklet.js` | AudioWorklet processor: hands raw mic frames to the main thread | No |
| `audio.js` | Mic stream, worklet wiring, PCM buffer, silence detection, segment playback | No |
| `azure.js` | SDK setup, push stream, continuous recognition, event wiring, error mapping | No |
| `assessment.js` | Merge segments, align with reference text, compute final scores | Yes |
| `segments.js` | Ticks to seconds, padded and clamped playback ranges | Yes |
| `render.js` | Build results DOM with `textContent` only | No |
| `app.js` | UI state machine: idle → recording → processing → results | No |

**Rules**

- All business logic lives in pure modules with no DOM or SDK imports, so it is unit-testable.
- No dependencies beyond the Speech SDK at runtime; ESLint is the only dev dependency.
- Small functions, explicit names, JSDoc on public functions. No speculative abstractions or config options nobody asked for.
- One UI state machine; no scattered boolean flags.

## Testing and CI

**Unit tests** (Node built-in test runner, `node --test`, no extra framework) cover the pure modules:

- downsampling and Float32 to Int16 conversion: sample counts, clipping, rate ratios for 44.1 and 48 kHz input;
- merging several recognized segments into one word list;
- alignment: omitted, inserted and mispronounced words, including across segment boundaries; Completeness recomputed from the alignment, not taken from Azure;
- final score computation against fixtures from real Azure responses;
- tick conversion and playback ranges: padding, clamping at the start and end of the recording;
- phoneme tooltip and Prosody rule: field present → shown, absent or empty → hidden.

**Fixtures:** real JSON responses captured in the spike for en-US and es-ES, with the key removed, committed under `tests/fixtures/`.

**Manual test checklist** in the repo for UI, microphone and playback on Chrome, Edge and Firefox.

**CI:** a GitHub Actions workflow runs ESLint and the unit tests on every push and pull request. Merging requires a green run.

## README

Written for non-developers first, developers second.

- What the app does, with a demo GIF: read → results → click a word → hear it.
- Link to the live GitHub Pages site.
- Step-by-step: create an Azure account, create a Speech resource on the **F0** tier, copy key and region. Screenshots for every step; call out where the region is shown, since it is a common mistake.
- Privacy: audio is sent to Microsoft Azure; nothing is sent anywhere else; the key stays in the browser.
- Security guidance from the Security section, item 6.
- Limits: desktop only, en-US and es-ES, phoneme names only for English, prosody only for English, 2-minute recording, one session at a time per F0 key.
- For developers: run locally, run tests, project structure, SDK version and checksum.
- License: MIT.

## Implementation order

Each step is its own branch off `main` (`feat/…`, `fix/…`), merged only with green CI. A step is done when the commit is on disk and the changed files are read back, not when an agent reports it.

1. **Scaffold** (`feat/scaffold`): repo layout, ESLint config with the no-`innerHTML` rule, empty test suite, CI workflow, MIT license.
2. **Spike** (`feat/spike`): a throwaway page that runs continuous assessment on en-US and es-ES through the worklet and push stream. Outputs, all settled before `feat/audio` starts:
   - captured JSON fixtures;
   - 16 kHz 16-bit mono PCM accepted by the push stream; offset 0 = first pushed sample;
   - per-segment Omission/Completeness behavior, checked against the Microsoft sample;
   - worklet loads under the CSP; vendored SDK runs without 'unsafe-eval';
   - exact Azure hosts for `connect-src`;
   - whether the key appears in the WebSocket URL, and the token-exchange decision;
   - F0 concurrent session limit;
   - Azure error codes for each error case. The spike page is deleted after.
3. **Key onboarding test** (in parallel with the spike): one real non-developer gets an F0 key using a draft README. If they fail, revisit the BYOK model before building the UI.
4. **Assessment logic** (`feat/assessment`): `pcm.js`, `assessment.js` and `segments.js` with unit tests on the fixtures.
5. **Audio** (`feat/audio`): shared mic stream, worklet, PCM buffer, padded segment playback, 2-minute limit and silence auto-stop.
6. **Azure wiring** (`feat/azure`): `azure.js` with push stream, live transcript, error mapping.
7. **UI** (`feat/ui`): key form, text input, recording state machine, results view, tooltip, click-to-play.
8. **Hardening** (`feat/security`): CSP meta tag, vendored SDK with checksum, key-exposure review, mobile notice based on a capability check (coarse pointer, AudioWorklet support), not user-agent sniffing.
9. **Release** (`feat/release`): README with screenshots, GitHub Pages deploy, manual test checklist run.

## Acceptance criteria

v1 is done when every box is ticked on the live GitHub Pages site.

- [ ] A non-developer gets an F0 key using only the README and starts a session without help.
- [ ] en-US: a 1-minute paragraph produces an overall score, all four breakdown scores, highlighted words, and phoneme tooltips.
- [ ] es-ES: the same paragraph flow works; Prosody is hidden; phoneme tooltip is hidden because names are empty.
- [ ] Omitted and inserted words are marked correctly, including at segment boundaries.
- [ ] Clicking a word plays only that word, audibly not cut off.
- [ ] Recording stops at 2:00 and after 10 s of silence.
- [ ] Every row of the error table shows its message when reproduced.
- [ ] The key does not appear in URLs, console output, error messages or network requests other than to Azure.
- [ ] With "remember key" off, the key is gone after the tab is closed; "Forget key" clears storage.
- [ ] A search of the code finds no `innerHTML`, `insertAdjacentHTML` or `eval`; the CSP blocks a test request to a non-Azure domain.
- [ ] CI is green: lint and unit tests pass.
- [ ] Works in the latest Chrome, Edge and Firefox on desktop; mobile shows the notice.
