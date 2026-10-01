import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createDownsampler, floatToInt16, int16ToFloat, rms } from "../src/pcm.js";

function sine(length, rate, freq, amp = 0.5) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

function feedInChunks(downsample, input, chunkSize) {
  const parts = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    parts.push(downsample(input.subarray(i, i + chunkSize)));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

describe("createDownsampler", () => {
  for (const inputRate of [48000, 44100]) {
    test(`${inputRate} -> 16000: one second yields exactly 16000 samples`, () => {
      const out = createDownsampler(inputRate, 16000)(new Float32Array(inputRate));
      assert.equal(out.length, 16000);
    });

    test(`${inputRate} -> 16000: 128-frame chunks match one-shot output`, () => {
      const input = sine(inputRate * 2, inputRate, 440);
      const oneShot = createDownsampler(inputRate, 16000)(input);
      const chunked = feedInChunks(createDownsampler(inputRate, 16000), input, 128);
      assert.equal(chunked.length, oneShot.length);
      for (let i = 0; i < oneShot.length; i += 1) {
        assert.ok(Math.abs(chunked[i] - oneShot[i]) < 1e-6, `sample ${i} differs`);
      }
    });

    test(`${inputRate} -> 16000: no drift over two minutes of odd-sized chunks`, () => {
      const downsample = createDownsampler(inputRate, 16000);
      let consumed = 0;
      let produced = 0;
      const sizes = [128, 127, 333, 1, 4096];
      for (let k = 0; consumed < inputRate * 120; k += 1) {
        const size = Math.min(sizes[k % sizes.length], inputRate * 120 - consumed);
        produced += downsample(new Float32Array(size)).length;
        consumed += size;
      }
      assert.equal(produced, 16000 * 120);
    });
  }

  test("preserves a DC level", () => {
    const out = createDownsampler(44100, 16000)(new Float32Array(4410).fill(0.25));
    for (const s of out) assert.ok(Math.abs(s - 0.25) < 1e-6);
  });

  test("keeps a 440 Hz tone at roughly the same amplitude", () => {
    const out = createDownsampler(48000, 16000)(sine(48000, 48000, 440, 0.5));
    const expectedRms = 0.5 / Math.SQRT2;
    assert.ok(Math.abs(rms(out) - expectedRms) < 0.01);
  });

  test("same rate passes samples through unchanged", () => {
    const input = Float32Array.from([0.1, -0.2, 0.3]);
    assert.deepEqual(Array.from(createDownsampler(16000, 16000)(input)), Array.from(input));
  });

  test("empty chunk yields no samples", () => {
    assert.equal(createDownsampler(48000, 16000)(new Float32Array(0)).length, 0);
  });

  test("rejects upsampling and invalid rates", () => {
    assert.throws(() => createDownsampler(8000, 16000), RangeError);
    assert.throws(() => createDownsampler(0, 16000), RangeError);
    assert.throws(() => createDownsampler(44100.5, 16000), RangeError);
  });
});

describe("floatToInt16", () => {
  test("maps full scale and zero", () => {
    assert.deepEqual(Array.from(floatToInt16(Float32Array.from([-1, 0, 1]))), [-32768, 0, 32767]);
  });

  test("clips out-of-range values", () => {
    assert.deepEqual(Array.from(floatToInt16(Float32Array.from([-2, 1.5]))), [-32768, 32767]);
  });

  test("output length equals input length", () => {
    assert.equal(floatToInt16(new Float32Array(1234)).length, 1234);
  });

  test("round-trips through int16ToFloat within one quantization step", () => {
    const input = sine(1000, 16000, 300, 0.9);
    const back = int16ToFloat(floatToInt16(input));
    for (let i = 0; i < input.length; i += 1) assert.ok(Math.abs(back[i] - input[i]) < 1 / 32767);
  });
});

describe("rms", () => {
  test("empty input is 0", () => assert.equal(rms(new Float32Array(0)), 0));
  test("constant signal equals its magnitude", () => {
    assert.ok(Math.abs(rms(new Float32Array(100).fill(-0.3)) - 0.3) < 1e-6);
  });
});
