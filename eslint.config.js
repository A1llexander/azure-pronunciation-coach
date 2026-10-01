import js from "@eslint/js";

/**
 * Security rules: no HTML string sinks and no dynamic code evaluation.
 * User text and Azure results must be rendered with textContent / DOM nodes only.
 */
const HTML_SINKS = ["innerHTML", "outerHTML", "insertAdjacentHTML"];

const securityRules = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error",
  "no-restricted-properties": [
    "error",
    ...HTML_SINKS.map((property) => ({
      property,
      message: `${property} is banned. Build DOM nodes and use textContent.`,
    })),
    { object: "document", property: "write", message: "document.write is banned." },
    { object: "document", property: "writeln", message: "document.writeln is banned." },
  ],
  "no-restricted-syntax": [
    "error",
    ...HTML_SINKS.map((name) => ({
      selector: `MemberExpression[computed=true][property.value='${name}']`,
      message: `${name} is banned, including computed access.`,
    })),
    {
      selector: "CallExpression[callee.property.name='createContextualFragment']",
      message: "createContextualFragment parses HTML strings and is banned.",
    },
  ],
};

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  console: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  location: "readonly",
  fetch: "readonly",
  Blob: "readonly",
  URL: "readonly",
  WebSocket: "writable",
  XMLHttpRequest: "readonly",
  AudioContext: "readonly",
  AudioWorkletNode: "readonly",
  MediaStream: "readonly",
  DOMException: "readonly",
  Event: "readonly",
  CustomEvent: "readonly",
  performance: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  requestAnimationFrame: "readonly",
  matchMedia: "readonly",
  SpeechSDK: "readonly",
};

const workletGlobals = {
  AudioWorkletProcessor: "readonly",
  registerProcessor: "readonly",
  sampleRate: "readonly",
  currentTime: "readonly",
};

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  URL: "readonly",
};

export default [
  { ignores: ["node_modules/**", "vendor/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    rules: {
      ...securityRules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
  {
    files: ["src/**/*.js", "spike/**/*.js"],
    ignores: ["src/recorder-worklet.js"],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ["src/recorder-worklet.js"],
    languageOptions: { globals: workletGlobals },
  },
  {
    files: ["tests/**/*.js", "eslint.config.js"],
    languageOptions: { globals: nodeGlobals },
  },
];
