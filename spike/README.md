# Spike: how to run it

A throwaway page that answers the open questions of the v1 spec with real Azure responses. It writes everything into one `findings.json`. This folder is deleted once the findings are applied.

## Run

1. From the repo root: `python3 -m http.server 8000` (any static server works; the page must be served, not opened as a file).
2. Open <http://localhost:8000/spike/> in **Chrome** (main run). Repeat a short run in **Firefox** and **Edge** to check the worklet and CSP there.
3. Enter the F0 key and region. Keep "SDK timer worker off" checked.

## Checklist (about 15 minutes)

**Section 1**
- [ ] *Test token endpoint*: tells whether issueToken works from the browser under the CSP.

**Section 2: two runs per language, en-US then es-ES**
- [ ] Run A, Auth = *Subscription key*: read the text following the on-page protocol (one inserted word, a 3-second pause, one skipped word right after the pause). Stop.
- [ ] After each run, click ▶ on 5–6 words, including words right after the pause. Write in Notes whether each word was whole and alone, or cut / shifted.
- [ ] Run B, Auth = *10-minute token*: read normally, without the changes. Stop.
- [ ] Once: deny microphone permission and press Record (records the error name). If you can, also try with no microphone connected.

**Section 3: probes**
- [ ] Invalid key, Non-existent region, Valid key + other real region
- [ ] No speech
- [ ] Two sessions at once (F0 concurrency)
- [ ] Run with SDK worker ON (expected: a CSP violation; does recognition still work?)
- [ ] Network failure: DevTools → Network → Offline, click the probe, then back Online
- [ ] CSP: fetch a non-Azure domain (expected: blocked)

**Section 4**
- [ ] Write notes, click *Download findings.json*, and send the file back.

The key and any token are replaced with `[REDACTED]` in the log and in the file. Check before sharing: search the file for the first 6 characters of your key; there should be no match.

## What each question maps to

| Spec question | Where in findings.json |
| --- | --- |
| Fixtures en-US / es-ES | `runs[].segments` (raw Azure JSON per segment) |
| 16 kHz Int16 accepted; offset 0 = first pushed sample | `runs[].alignment`, `runs[].capture`, Notes on ▶ playback |
| Per-segment Omission / Completeness | `runs[].summary.segments[].errorTypes`, `.scores.completeness` |
| Worklet + SDK under CSP, no 'unsafe-eval' | `csp.violations` (should be empty in normal runs) |
| Exact hosts for `connect-src` | `sockets[].host`, `http[].host` |
| Key in WebSocket URL; token decision | `sockets[].keyInUrl`, `sockets[].tokenInUrl`, `queryParamNames` |
| F0 concurrent sessions | `probes[]` with `case: concurrent-session-*` |
| Error codes | `probes[].canceled` (`reason`, `errorCode`, `errorCodeName`, `errorDetails`) |

Not reproducible here: quota exhausted. Its error code stays unconfirmed unless the quota runs out during testing.
