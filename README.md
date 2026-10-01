# Pronunciation Coach

Static web app that wraps Azure Speech pronunciation assessment: paste a text, read it aloud, get word-level scores, replay any word as you said it. Bring your own Azure Speech key (F0 free tier recommended). No backend.

Status: early development. The user guide and live link arrive with the first release.

## For developers

Requirements: Node.js 22.13 or newer (for lint and tests only; the app itself has no build step).

```
npm ci
npm run lint
npm test
```

Layout:

- `index.html`: the app, served as-is from the repo root by GitHub Pages.
- `src/`: plain JavaScript ES modules.
- `tests/`: unit tests for the pure modules (`node --test`).
- `vendor/`: the pinned Microsoft Speech SDK browser bundle.
- `spike/`: temporary test page for Azure behavior (see `spike/README.md`); removed before release.

Vendored Speech SDK: `microsoft-cognitiveservices-speech-sdk` 1.52.0, file `vendor/speech-sdk-1.52.0/microsoft.cognitiveservices.speech.sdk.bundle-min.js`, SHA-256 `3e46efc886450f1940fd4da5caf35a362a8462995356e31b23c3c6ac58ba3aee` (checked by `npm test`).

License: MIT.
