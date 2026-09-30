// public/voice-worklet.js
// Hai bo xu ly am thanh chay tren luong rieng cua trinh duyet (AudioWorklet).
// Chay rieng luong nen khong bi giat khi giao dien dang ve lai.

// Thu tieng tu micro, gom du 20ms roi day ve luong chinh de ma hoa.
class VoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = options?.processorOptions?.frameSize || 320; // 20ms o 16kHz
    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.buffer[this.filled++] = input[i];
      if (this.filled === this.frameSize) {
        // Gui ban sao: mang goc se bi ghi de ngay o vong sau
        this.port.postMessage(this.buffer.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

// Phat tieng nhan duoc. Giu mot hang doi nho (bo dem chong giat) de mang
// co goi toi muon mot chut van phat lien mach.
class VoicePlayback extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.queue = [];
    this.offset = 0;
    this.queued = 0;
    // So mau phai gom du truoc khi bat dau phat. Ít quá thì rè, nhiều quá thì trễ.
    this.minStart = options?.processorOptions?.minStart || 1280; // 80ms o 16kHz
    this.maxQueued = options?.processorOptions?.maxQueued || 8000; // ~500ms
    this.playing = false;
    this.port.onmessage = (e) => {
      if (e.data === 'reset') { this.queue = []; this.offset = 0; this.queued = 0; this.playing = false; return; }
      this.queue.push(e.data);
      this.queued += e.data.length;
      // Mang dồn goi toi mot luc: bo bot phan cu de khong tre don lai mai
      while (this.queued > this.maxQueued && this.queue.length > 1) {
        const dropped = this.queue.shift();
        this.queued -= dropped.length - (this.offset || 0);
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    if (!this.playing && this.queued < this.minStart) { out.fill(0); return true; }
    this.playing = true;
    for (let i = 0; i < out.length; i++) {
      const chunk = this.queue[0];
      if (!chunk) {
        // Het du lieu: im lang va cho gom lai truoc khi phat tiep
        out.fill(0, i);
        this.playing = false;
        return true;
      }
      out[i] = chunk[this.offset++];
      this.queued--;
      if (this.offset >= chunk.length) { this.queue.shift(); this.offset = 0; }
    }
    return true;
  }
}

registerProcessor('voice-capture', VoiceCapture);
registerProcessor('voice-playback', VoicePlayback);
