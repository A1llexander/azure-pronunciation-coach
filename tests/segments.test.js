import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TICKS_PER_SECOND, ticksToSeconds, ticksToSamples, playbackRange } from "../src/segments.js";

const RATE = 16000;
const opts = (totalSamples, paddingMs = 120) => ({ paddingMs, sampleRate: RATE, totalSamples });
const ms = (n) => n * 10_000; // milliseconds -> ticks

describe("tick conversion", () => {
  test("one second of ticks", () => {
    assert.equal(ticksToSeconds(TICKS_PER_SECOND), 1);
    assert.equal(ticksToSamples(TICKS_PER_SECOND, RATE), RATE);
  });

  test("Azure-style offset converts to the nearest sample", () => {
    // 0.5 s + 31.25 µs (half a sample at 16 kHz) rounds up.
    assert.equal(ticksToSamples(5_000_313, RATE), 8001);
    assert.equal(ticksToSamples(ms(250), RATE), 4000);
  });
});

describe("playbackRange", () => {
  test("pads 120 ms on both sides in the middle of a recording", () => {
    const range = playbackRange({ offsetTicks: ms(1000), durationTicks: ms(400) }, opts(RATE * 10));
    assert.deepEqual(range, { start: 16000 - 1920, end: 16000 + 6400 + 1920 });
  });

  test("clamps at the start of the recording", () => {
    const range = playbackRange({ offsetTicks: ms(50), durationTicks: ms(200) }, opts(RATE * 10));
    assert.equal(range.start, 0);
    assert.equal(range.end, 800 + 3200 + 1920);
  });

  test("clamps at the end of the recording", () => {
    const total = RATE * 2;
    const range = playbackRange({ offsetTicks: ms(1800), durationTicks: ms(150) }, opts(total));
    assert.equal(range.end, total);
    assert.equal(range.start, 28800 - 1920);
  });

  test("zero padding returns exactly the word", () => {
    const range = playbackRange({ offsetTicks: ms(500), durationTicks: ms(250) }, opts(RATE * 2, 0));
    assert.deepEqual(range, { start: 8000, end: 12000 });
  });

  test("word beyond the recording yields null", () => {
    assert.equal(playbackRange({ offsetTicks: ms(5000), durationTicks: ms(100) }, opts(RATE, 0)), null);
  });

  test("rejects invalid input", () => {
    assert.throws(() => playbackRange({ offsetTicks: NaN, durationTicks: 1 }, opts(RATE)), TypeError);
    assert.throws(() => playbackRange({ offsetTicks: 0, durationTicks: -1 }, opts(RATE)), RangeError);
  });
});
