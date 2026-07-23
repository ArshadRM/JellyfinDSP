declare module 'butterchurn' {
  export interface VisualizerOptions {
    width: number
    height: number
    pixelRatio: number
  }

  export interface Visualizer {
    connectAudio(node: AudioNode): void
    loadPreset(preset: unknown, blend: number): void
    render(opts?: unknown): void
    setRendererSize(width: number, height: number): void
  }

  export interface ButterchurnStatic {
    createVisualizer(
      audioContext: AudioContext,
      canvas: HTMLCanvasElement,
      options: VisualizerOptions,
    ): Visualizer
  }

  const butterchurn: ButterchurnStatic
  export default butterchurn
}

declare module 'butterchurn-presets' {
  interface ButterchurnPresetsStatic {
    getPresets(): Record<string, unknown>
  }

  const butterchurnPresets: ButterchurnPresetsStatic
  export default butterchurnPresets
}
