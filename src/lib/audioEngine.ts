type EngineOptions = {
  lowPassFrequency: number
  lowPassQ: number
  lowPassEnabled: boolean
  masterVolume: number
}

export class AudioEngine {
  private context: AudioContext | null = null
  private sourceNode: MediaElementAudioSourceNode | null = null
  private splitterNode: ChannelSplitterNode | null = null
  private monoSumNode: GainNode | null = null
  private lowPassNode: IIRFilterNode | null = null
  private monoToStereoNode: ChannelMergerNode | null = null
  private lowPassMixNode: GainNode | null = null
  private masterGainNode: GainNode | null = null
  private analyserNode: AnalyserNode | null = null
  private connectedElement: HTMLAudioElement | null = null
  private lowPassEnabled = true
  private lowPassFrequency = 55
  private lowPassQ = 0.54

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

  setupForElement(audioElement: HTMLAudioElement, options: EngineOptions): void {
    if (!this.context) {
      this.context = new AudioContext()
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
      this.analyserNode = this.context.createAnalyser()

      this.lowPassFrequency = options.lowPassFrequency
      this.lowPassQ = options.lowPassQ
      this.lowPassEnabled = options.lowPassEnabled
      this.masterGainNode.gain.value = options.masterVolume
      this.analyserNode.fftSize = 2048
      this.analyserNode.smoothingTimeConstant = 0.76

      this.rebuildLowPassNode()

      this.sourceNode.connect(this.masterGainNode)
      this.sourceNode.connect(this.splitterNode)
      this.splitterNode.connect(this.monoSumNode, 0, 0)
      this.splitterNode.connect(this.monoSumNode, 1, 0)
      this.monoToStereoNode.connect(this.lowPassMixNode)
      this.lowPassMixNode.connect(this.masterGainNode)
      this.masterGainNode.connect(this.analyserNode)
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
    this.analyserNode?.disconnect()
    this.sourceNode = null
    this.splitterNode = null
    this.monoSumNode = null
    this.lowPassNode = null
    this.monoToStereoNode = null
    this.lowPassMixNode = null
    this.masterGainNode = null
    this.analyserNode = null
    this.connectedElement = null
  }
}
