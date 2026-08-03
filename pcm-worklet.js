// Collects raw microphone PCM and forwards it to the main thread.
// Loaded as a same-origin file because the page CSP is script-src 'self',
// which rules out defining this from a blob: URL.
class PCMCollector extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}

registerProcessor('pcm-collector', PCMCollector);
