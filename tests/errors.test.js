import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ERRORS, AppError, classifyMicError, classifyTokenFailure, classifyCancellation } from "../src/errors.js";

describe("error catalog", () => {
  test("every spec error row has a message and a next step", () => {
    for (const code of ["key-rejected", "quota", "busy", "mic-denied", "no-mic", "no-speech", "network", "unsupported"]) {
      assert.ok(ERRORS[code]?.message && ERRORS[code]?.hint, code);
    }
  });

  test("AppError carries the code and the catalog message; unknown codes fall back to network", () => {
    const e = new AppError("quota");
    assert.equal(e.code, "quota");
    assert.equal(e.message, ERRORS.quota.message);
    assert.equal(new AppError("nope").code, "network");
  });
});

describe("classifiers (spike mapping)", () => {
  test("microphone", () => {
    assert.equal(classifyMicError("NotAllowedError"), "mic-denied");
    assert.equal(classifyMicError("NotFoundError"), "no-mic");
    assert.equal(classifyMicError(undefined), "no-mic");
  });

  test("issueToken: 401 rejected key/region, fetch failure is network", () => {
    assert.equal(classifyTokenFailure({ status: 401 }), "key-rejected");
    assert.equal(classifyTokenFailure({ status: 403 }), "quota");
    assert.equal(classifyTokenFailure({ status: 429 }), "busy");
    assert.equal(classifyTokenFailure({}), "network");
    assert.equal(classifyTokenFailure({ status: 500 }), "network");
  });

  test("session cancellation codes", () => {
    assert.equal(classifyCancellation("AuthenticationFailure"), "key-rejected");
    assert.equal(classifyCancellation("Forbidden"), "quota");
    assert.equal(classifyCancellation("TooManyRequests"), "busy");
    assert.equal(classifyCancellation("ConnectionFailure"), "network");
  });
});
