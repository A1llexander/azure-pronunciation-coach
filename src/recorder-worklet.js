/**
 * AudioWorklet processor: forwards raw mono mic frames to the main thread.
 *
 * Frames are batched (~43 ms at 48 kHz) to limit message overhead. Downsampling
 * and Int16 conversion happen on the main thread in pcm.js, which is pure and
 * unit-tested. A "flush" message sends any partial batch and replies "flushed",
 * so no audio is lost at Stop.
 */

const BATCH_FRAMES = 2048;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(BATCH_FRAMES);
    this.filled = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "flush") {
        this.sendBatch();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  sendBatch() {
    if (this.filled === 0) return;
    const samples = this.batch.slice(0, this.filled);
    this.port.postMessage({ type: "frames", samples }, [samples.buffer]);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let read = 0;
    while (read < channel.length) {
      const count = Math.min(channel.length - read, BATCH_FRAMES - this.filled);
      this.batch.set(channel.subarray(read, read + count), this.filled);
      this.filled += count;
      read += count;
      if (this.filled === BATCH_FRAMES) this.sendBatch();
    }
    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
