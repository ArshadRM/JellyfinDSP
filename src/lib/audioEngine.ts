type EngineOptions = {
  lowPassFrequency: number
  lowPassQ: number
  lowPassEnabled: boolean
  masterVolume: number
  phaserEnabled: boolean
  phaserMinFreq: number
  phaserMaxFreq: number
  phaserRate: number
  phaserDepth: number
  phaserFeedback: number
}

const PHASER_WORKLET_CODE = `
class AllPassDelay {
  constructor() {
    this.a1 = 0;
    this.zm1 = 0;
  }
  setDelay(delay) {
    this.a1 = (1 - delay) / (1 + delay);
  }
  process(sample) {
    let y = sample * -this.a1 + this.zm1;
    this.zm1 = y * this.a1 + sample;
    return y;
  }
}

class Phaser {
  constructor(sampleRate) {
    this.fb = 0.70;
    this.lfoPhase = 0;
    this.depth = 1.00;
    this.zm1 = 0;
    this.lfoInc = 0;
    this.dmin = 0;
    this.dmax = 0;
    this.sampleRate = sampleRate;
    this.alps = Array.from({ length: 6 }, () => new AllPassDelay());
  }

  setRange(min, max) {
    const nyquist = this.sampleRate / 2;
    this.dmin = min / nyquist;
    this.dmax = Math.min(max, nyquist * 0.99) / nyquist;
  }

  setRate(rate) {
    this.lfoInc = 2 * Math.PI * (rate / this.sampleRate);
  }

  setFeedback(fb) {
    this.fb = fb;
  }

  setDepth(depth) {
    this.depth = depth;
  }

  process(sample) {
    let d = this.dmin + (this.dmax - this.dmin) * ((Math.sin(this.lfoPhase) + 1) / 2);

    this.lfoPhase += this.lfoInc;
    if (this.lfoPhase >= Math.PI * 2) {
      this.lfoPhase -= Math.PI * 2;
    }

    for (let i = 0; i < 6; i++) {
        this.alps[i].setDelay(d);
    }

    let y = sample + this.zm1 * this.fb;
    for (let i = 5; i >= 0; i--) {
        y = this.alps[i].process(y);
    }
    
    this.zm1 = y;
    return sample + y * this.depth;
  }
}

class PhaserWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phaserL = new Phaser(sampleRate);
    this.phaserR = new Phaser(sampleRate);
  }

  static get parameterDescriptors() {
    return [
      { name: 'minFreq', defaultValue: 440, minValue: 10, maxValue: 24000 },
      { name: 'maxFreq', defaultValue: 1600, minValue: 10, maxValue: 24000 },
      { name: 'rate', defaultValue: 0.5, minValue: 0, maxValue: 10 },
      { name: 'depth', defaultValue: 1, minValue: 0, maxValue: 1 },
      { name: 'feedback', defaultValue: 0.7, minValue: 0, maxValue: 0.99 },
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1 }
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0) return true;

    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1];
    
    if (!outL) return true;

    const enabled = parameters.enabled.length > 1 ? parameters.enabled[0] : parameters.enabled[0];
    
    if (enabled < 0.5) {
      if (inL) outL.set(inL);
      if (outR && inR) outR.set(inR);
      return true;
    }

    const minFreq = parameters.minFreq.length > 1 ? parameters.minFreq[0] : parameters.minFreq[0];
    const maxFreq = parameters.maxFreq.length > 1 ? parameters.maxFreq[0] : parameters.maxFreq[0];
    const rate = parameters.rate.length > 1 ? parameters.rate[0] : parameters.rate[0];
    const depth = parameters.depth.length > 1 ? parameters.depth[0] : parameters.depth[0];
    const fb = parameters.feedback.length > 1 ? parameters.feedback[0] : parameters.feedback[0];

    this.phaserL.setRange(minFreq, maxFreq);
    this.phaserL.setRate(rate);
    this.phaserL.setDepth(depth);
    this.phaserL.setFeedback(fb);

    this.phaserR.setRange(minFreq, maxFreq);
    this.phaserR.setRate(rate);
    this.phaserR.setDepth(depth);
    this.phaserR.setFeedback(fb);

    const length = inL.length;
    for (let i = 0; i < length; i++) {
        outL[i] = this.phaserL.process(inL[i]);
        if (outR) {
            outR[i] = this.phaserR.process(inR ? inR[i] : inL[i]);
        }
    }

    return true;
  }
}

registerProcessor("phaser-worklet", PhaserWorklet);
`;

export class AudioEngine {
  private context: AudioContext | null = null
  private sourceNode: MediaElementAudioSourceNode | null = null
  private splitterNode: ChannelSplitterNode | null = null
  private monoSumNode: GainNode | null = null
  private lowPassNode: IIRFilterNode | null = null
  private monoToStereoNode: ChannelMergerNode | null = null
  private lowPassMixNode: GainNode | null = null
  private masterGainNode: GainNode | null = null
  private phaserNode: AudioWorkletNode | null = null
  private analyserNode: AnalyserNode | null = null
  private connectedElement: HTMLAudioElement | null = null
  private lowPassEnabled = true
  private lowPassFrequency = 55
  private lowPassQ = 0.54
  private workletLoaded = false

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }

  private buildLowPassCoefficients(frequency: number, qFactor: number): {
    feedforward: number[]
    feedback: number[]
  } {
    if (!this.context) {
      return {
        feedforward: [1, 0, 0],
        feedback: [1, 0, 0],
      }
    }

    const freq = this.clamp(frequency, 10, 10000)
    const q = this.clamp(qFactor, 0.01, 10)

    const x = (freq * 2 * Math.PI) / this.context.sampleRate
    const sinX = Math.sin(x)
    const y = sinX / (q * 2)
    const cosX = Math.cos(x)
    const z = (1 - cosX) / 2

    const a0 = y + 1
    const a1Raw = -2 * cosX
    const a2Raw = 1 - y
    const b0Raw = z
    const b1Raw = 1 - cosX
    const b2Raw = z

    const b0 = b0Raw / a0
    const b1 = b1Raw / a0
    const b2 = b2Raw / a0
    const a1 = -a1Raw / a0
    const a2 = -a2Raw / a0

    return {
      // Web Audio expects subtraction on feedback terms, so invert the script's +a1/+a2 terms.
      feedforward: [b0, b1, b2],
      feedback: [1, -a1, -a2],
    }
  }

  private rebuildLowPassNode(): void {
    if (!this.context || !this.monoSumNode || !this.monoToStereoNode) {
      return
    }

    this.monoSumNode.disconnect()
    this.lowPassNode?.disconnect()

    const coeffs = this.buildLowPassCoefficients(
      this.lowPassFrequency,
      this.lowPassQ,
    )

    this.lowPassNode = this.context.createIIRFilter(
      coeffs.feedforward,
      coeffs.feedback,
    )

    this.monoSumNode.connect(this.lowPassNode)
    this.lowPassNode.connect(this.monoToStereoNode, 0, 0)
    this.lowPassNode.connect(this.monoToStereoNode, 0, 1)
  }

  private reconnectGraph(): void {
    if (!this.lowPassMixNode) {
      return
    }

    this.lowPassMixNode.gain.setTargetAtTime(
      this.lowPassEnabled ? 1 : 0,
      this.context?.currentTime ?? 0,
      0.04,
    )
  }

  async setupForElement(audioElement: HTMLAudioElement, options: EngineOptions): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext()
    }

    if (!this.workletLoaded) {
      const blob = new Blob([PHASER_WORKLET_CODE], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      await this.context.audioWorklet.addModule(url)
      this.workletLoaded = true
    }

    if (this.connectedElement !== audioElement) {
      this.disconnect()
      this.connectedElement = audioElement
      this.sourceNode = this.context.createMediaElementSource(audioElement)
      this.splitterNode = this.context.createChannelSplitter(2)
      this.monoSumNode = this.context.createGain()
      this.monoToStereoNode = this.context.createChannelMerger(2)
      this.lowPassMixNode = this.context.createGain()
      this.masterGainNode = this.context.createGain()
      this.phaserNode = new AudioWorkletNode(this.context, 'phaser-worklet', {
        outputChannelCount: [2]
      })
      this.analyserNode = this.context.createAnalyser()

      this.lowPassFrequency = options.lowPassFrequency
      this.lowPassQ = options.lowPassQ
      this.lowPassEnabled = options.lowPassEnabled
      this.masterGainNode.gain.value = options.masterVolume
      
      this.setPhaserParams({
        phaserMinFreq: options.phaserMinFreq,
        phaserMaxFreq: options.phaserMaxFreq,
        phaserRate: options.phaserRate,
        phaserDepth: options.phaserDepth,
        phaserFeedback: options.phaserFeedback
      })
      this.setPhaserEnabled(options.phaserEnabled)

      this.analyserNode.fftSize = 2048
      this.analyserNode.smoothingTimeConstant = 0.76

      this.rebuildLowPassNode()

      this.sourceNode.connect(this.masterGainNode)
      this.sourceNode.connect(this.splitterNode)
      this.splitterNode.connect(this.monoSumNode, 0, 0)
      this.splitterNode.connect(this.monoSumNode, 1, 0)
      this.monoToStereoNode.connect(this.lowPassMixNode)
      this.lowPassMixNode.connect(this.masterGainNode)
      this.masterGainNode.connect(this.phaserNode)
      this.phaserNode.connect(this.analyserNode)
      this.analyserNode.connect(this.context.destination)

      this.reconnectGraph()
    }

    if (this.connectedElement === audioElement) {
      this.lowPassFrequency = options.lowPassFrequency
      this.lowPassQ = options.lowPassQ
      this.lowPassEnabled = options.lowPassEnabled
      this.rebuildLowPassNode()
      this.masterGainNode?.gain.setTargetAtTime(
        options.masterVolume,
        this.context.currentTime,
        0.04,
      )
      this.setPhaserParams({
        phaserMinFreq: options.phaserMinFreq,
        phaserMaxFreq: options.phaserMaxFreq,
        phaserRate: options.phaserRate,
        phaserDepth: options.phaserDepth,
        phaserFeedback: options.phaserFeedback
      })
      this.setPhaserEnabled(options.phaserEnabled)
      this.reconnectGraph()
    }
  }

  setLowPassEnabled(enabled: boolean): void {
    this.lowPassEnabled = enabled
    this.reconnectGraph()
  }

  setMasterVolume(value: number): void {
    if (!this.context || !this.masterGainNode) {
      return
    }

    this.masterGainNode.gain.setTargetAtTime(value, this.context.currentTime, 0.04)
  }

  setPhaserEnabled(enabled: boolean): void {
    if (!this.context || !this.phaserNode) return
    const param = this.phaserNode.parameters.get('enabled')
    if (param) param.setTargetAtTime(enabled ? 1 : 0, this.context.currentTime, 0.04)
  }

  setPhaserParams(params: {
    phaserMinFreq: number
    phaserMaxFreq: number
    phaserRate: number
    phaserDepth: number
    phaserFeedback: number
  }): void {
    if (!this.context || !this.phaserNode) return
    const t = this.context.currentTime
    this.phaserNode.parameters.get('minFreq')?.setTargetAtTime(params.phaserMinFreq, t, 0.04)
    this.phaserNode.parameters.get('maxFreq')?.setTargetAtTime(params.phaserMaxFreq, t, 0.04)
    this.phaserNode.parameters.get('rate')?.setTargetAtTime(params.phaserRate, t, 0.04)
    this.phaserNode.parameters.get('depth')?.setTargetAtTime(params.phaserDepth, t, 0.04)
    this.phaserNode.parameters.get('feedback')?.setTargetAtTime(params.phaserFeedback, t, 0.04)
  }

  getWaveformData(target: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyserNode) {
      return false
    }

    this.analyserNode.getByteTimeDomainData(target)
    return true
  }

  async resume(): Promise<void> {
    if (!this.context) {
      return
    }

    if (this.context.state === 'suspended') {
      await this.context.resume()
    }
  }

  setLowPassFrequency(value: number): void {
    if (!this.context) {
      return
    }

    this.lowPassFrequency = value
    this.rebuildLowPassNode()
    this.reconnectGraph()
  }

  setLowPassQ(value: number): void {
    if (!this.context) {
      return
    }

    this.lowPassQ = value
    this.rebuildLowPassNode()
    this.reconnectGraph()
  }

  disconnect(): void {
    this.sourceNode?.disconnect()
    this.splitterNode?.disconnect()
    this.monoSumNode?.disconnect()
    this.lowPassNode?.disconnect()
    this.monoToStereoNode?.disconnect()
    this.lowPassMixNode?.disconnect()
    this.masterGainNode?.disconnect()
    this.phaserNode?.disconnect()
    this.analyserNode?.disconnect()
    this.sourceNode = null
    this.splitterNode = null
    this.monoSumNode = null
    this.lowPassNode = null
    this.monoToStereoNode = null
    this.lowPassMixNode = null
    this.masterGainNode = null
    this.phaserNode = null
    this.analyserNode = null
    this.connectedElement = null
  }
}
