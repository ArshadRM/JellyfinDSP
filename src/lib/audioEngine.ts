type EngineOptions = {
  lowPassFrequency: number
  lowPassQ: number
  lowPassEnabled: boolean
  masterVolume: number
}

export class AudioEngine {
  private context: AudioContext | null = null
  private sourceNode: MediaElementAudioSourceNode | null = null
  private lowPassNode: BiquadFilterNode | null = null
  private gainNode: GainNode | null = null
  private connectedElement: HTMLAudioElement | null = null
  private lowPassEnabled = true

  private reconnectGraph(): void {
    if (!this.sourceNode || !this.gainNode) {
      return
    }

    this.sourceNode.disconnect()
    this.lowPassNode?.disconnect()

    if (this.lowPassEnabled && this.lowPassNode) {
      this.sourceNode.connect(this.lowPassNode)
      this.lowPassNode.connect(this.gainNode)
      return
    }

    this.sourceNode.connect(this.gainNode)
  }

  setupForElement(audioElement: HTMLAudioElement, options: EngineOptions): void {
    if (!this.context) {
      this.context = new AudioContext()
    }

    if (this.connectedElement !== audioElement) {
      this.disconnect()
      this.connectedElement = audioElement
      this.sourceNode = this.context.createMediaElementSource(audioElement)
      this.lowPassNode = this.context.createBiquadFilter()
      this.gainNode = this.context.createGain()

      this.lowPassNode.type = 'lowpass'
      this.lowPassNode.frequency.value = options.lowPassFrequency
      this.lowPassNode.Q.value = options.lowPassQ
      this.gainNode.gain.value = options.masterVolume

      this.lowPassEnabled = options.lowPassEnabled
      this.reconnectGraph()
      this.gainNode.connect(this.context.destination)
    }

    if (this.connectedElement === audioElement) {
      this.lowPassEnabled = options.lowPassEnabled
      this.lowPassNode?.frequency.setValueAtTime(
        options.lowPassFrequency,
        this.context.currentTime,
      )
      this.lowPassNode?.Q.setValueAtTime(options.lowPassQ, this.context.currentTime)
      this.gainNode?.gain.setValueAtTime(options.masterVolume, this.context.currentTime)
      this.reconnectGraph()
    }
  }

  setLowPassEnabled(enabled: boolean): void {
    this.lowPassEnabled = enabled
    this.reconnectGraph()
  }

  setMasterVolume(value: number): void {
    if (!this.context || !this.gainNode) {
      return
    }

    this.gainNode.gain.setTargetAtTime(value, this.context.currentTime, 0.04)
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
    if (!this.context || !this.lowPassNode) {
      return
    }

    this.lowPassNode.frequency.setTargetAtTime(
      value,
      this.context.currentTime,
      0.06,
    )
  }

  setLowPassQ(value: number): void {
    if (!this.context || !this.lowPassNode) {
      return
    }

    this.lowPassNode.Q.setTargetAtTime(value, this.context.currentTime, 0.06)
  }

  disconnect(): void {
    this.sourceNode?.disconnect()
    this.lowPassNode?.disconnect()
    this.gainNode?.disconnect()
    this.sourceNode = null
    this.lowPassNode = null
    this.gainNode = null
    this.connectedElement = null
  }
}
