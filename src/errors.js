/**
 * User-facing error catalog and pure classifiers that map browser and Azure
 * failures to it (mapping confirmed in the spike, see docs/spike-findings.md).
 * Messages come only from this catalog, never from SDK text, so a key or token
 * can never leak into the UI through an error.
 */

/** @type {Readonly<Record<string, {message: string, hint: string}>>} */
export const ERRORS = Object.freeze({
  "key-rejected": {
    message: "Key or region rejected",
    hint: "Check both fields. The region is the short code shown under Keys and Endpoint, for example westeurope.",
  },
  "region-invalid": {
    message: "Key or region rejected",
    hint: "The region must be a short code such as westeurope or eastus, not a display name.",
  },
  quota: {
    message: "Free monthly quota used up",
    hint: "Wait for next month or use another key.",
  },
  busy: {
    message: "This key is already in use",
    hint: "A free key allows one recording at a time. Close other tabs that use it and try again.",
  },
  "mic-denied": {
    message: "No microphone access",
    hint: "Allow the microphone for this site (the icon in the address bar), then press Record again.",
  },
  "no-mic": {
    message: "No microphone detected",
    hint: "Connect a microphone and try again.",
  },
  "no-speech": {
    message: "No speech detected",
    hint: "Speak closer to the microphone and try again.",
  },
  "assessment-missing": {
    message: "Assessment unavailable",
    hint: "Azure returned no pronunciation scores this time. Please record again.",
  },
  network: {
    message: "Connection to Azure failed",
    hint: "Check your internet connection and the region, then try again.",
  },
  unsupported: {
    message: "Desktop only for now",
    hint: "Open this page on a computer in Chrome, Edge or Firefox.",
  },
});

/** Error carrying a code from ERRORS. */
export class AppError extends Error {
  /** @param {keyof typeof ERRORS} code */
  constructor(code) {
    super(ERRORS[code]?.message ?? "Something went wrong");
    this.name = "AppError";
    this.code = ERRORS[code] ? code : "network";
  }
}

/**
 * @param {string} name DOMException name from getUserMedia.
 * @returns {"mic-denied" | "no-mic"}
 */
export function classifyMicError(name) {
  return name === "NotAllowedError" || name === "SecurityError" ? "mic-denied" : "no-mic";
}

/**
 * Failure of the issueToken request.
 *
 * @param {{status?: number}} failure status is undefined when fetch itself threw
 *   (offline, or a region that does not exist: the two look the same).
 * @returns {"key-rejected" | "quota" | "busy" | "network"}
 */
export function classifyTokenFailure({ status }) {
  if (status === 401) return "key-rejected";
  if (status === 403) return "quota";
  if (status === 429) return "busy";
  return "network";
}

/**
 * Error cancellation of a recognition session.
 *
 * @param {string | undefined} errorCodeName SDK CancellationErrorCode name.
 * @returns {"key-rejected" | "quota" | "busy" | "network"}
 */
export function classifyCancellation(errorCodeName) {
  switch (errorCodeName) {
    case "AuthenticationFailure":
      return "key-rejected";
    case "Forbidden":
      return "quota";
    case "TooManyRequests":
      return "busy";
    default:
      return "network";
  }
}
