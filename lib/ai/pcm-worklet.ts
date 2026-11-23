// Runs on the browser's audio thread. Turns the microphone (whatever rate the device uses) into 16 kHz, 16-bit mono
// chunks of 40 ms for Gemini Live, and reports how loud it is. A box filter keeps the downsampling clean enough for speech.
export const PCM_WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.sum = 0;
    this.count = 0;
    this.size = 640;
    this.out = new Int16Array(this.size);
    this.n = 0;
    this.energy = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i];
      this.count++;
      this.pos += 1;
      if (this.pos < this.ratio) continue;
      this.pos -= this.ratio;
      const v = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      this.energy += v * v;
      if (this.n === this.size) {
        this.port.postMessage({ pcm: this.out.buffer, rms: Math.sqrt(this.energy / this.size) }, [this.out.buffer]);
        this.out = new Int16Array(this.size);
        this.n = 0;
        this.energy = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;
