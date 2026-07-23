import type { AudioEngine } from './audioEngine'

export type VizMode = 'waveform' | 'milkdrop'
export type WaveformStyle = 'line' | 'bars' | 'mirror'

export interface VisualTheme {
  id: string
  name: string
  uiColor: string
  bgColor: string
  usePalette: number
  palette: [number, number, number][]
}

export const DEFAULT_CHARSET = ' .:-=+*#%@'

export const VIZ_THEMES: VisualTheme[] = [
  {
    id: 'none',
    name: 'none (raw)',
    uiColor: '#feffff',
    bgColor: '#000000',
    usePalette: 0.0,
    palette: [],
  },
  {
    id: 'white',
    name: 'white',
    uiColor: '#feffff',
    bgColor: '#000000',
    usePalette: 1.0,
    palette: [
      [0.0, 0.0, 0.0],
      [0.996, 1.0, 1.0],
    ],
  },
  {
    id: 'pink',
    name: 'pink ambiant',
    uiColor: '#ff66b2',
    bgColor: '#00001a',
    usePalette: 1.0,
    palette: [
      [0.0, 0.0, 0.1],
      [0.035, 0.047, 0.506],
      [1.0, 0.7, 0.8],
      [1.0, 0.294, 0.945],
      [1.0, 1.0, 1.0],
    ],
  },
  {
    id: 'amber',
    name: 'amber folk',
    uiColor: '#ff8300',
    bgColor: '#160d06',
    usePalette: 1.0,
    palette: [
      [0.086, 0.055, 0.024],
      [0.306, 0.192, 0.075],
      [0.180, 0.529, 0.255],
      [0.698, 0.365, 0.043],
    ],
  },
  {
    id: 'red',
    name: 'red rock',
    uiColor: '#ff0000',
    bgColor: '#200000',
    usePalette: 1.0,
    palette: [
      [0.0, 0.0, 0.0],
      [1.0, 0.0, 0.0],
      [0.949, 0.973, 1.0],
    ],
  },
  {
    id: 'purple-yellow',
    name: 'purple hiphop',
    uiColor: '#fedc04',
    bgColor: '#570085',
    usePalette: 1.0,
    palette: [
      [0.345, 0.0, 0.522],
      [0.847, 0.0, 1.0],
      [1.0, 0.867, 0.0],
      [1.0, 0.486, 0.0],
      [0.106, 0.0, 1.0],
    ],
  },
  {
    id: 'violet',
    name: 'violet pop',
    uiColor: '#ab00ff',
    bgColor: '#11001d',
    usePalette: 1.0,
    palette: [
      [0.067, 0.0, 0.118],
      [0.671, 0.0, 1.0],
      [1.0, 0.0, 0.0],
      [0.996, 1.0, 1.0],
    ],
  },
  {
    id: 'neon',
    name: 'neon club',
    uiColor: '#000000',
    bgColor: '#8afe00',
    usePalette: 1.0,
    palette: [
      [0.0, 0.0, 0.0],
      [0.0, 0.906, 1.0],
      [1.0, 0.0, 0.655],
      [0.545, 0.996, 0.0],
      [1.0, 1.0, 1.0],
    ],
  },
]

const BLACKLIST = new Set([
  'martin - The Bridge of Khazad-Dum',
  'martin - witchcraft reloaded',
  'flexi + amandio c - organic [random mashup]',
  'sawtooth grin roam',
  'Aderrasi - Songflower (Moss Posy)',
  'martin + flexi - diamond cutter [prismaticvortex.com] - camille - i wish i wish i wish i was constrained',
  'martin - extreme heat',
])

const VERT_SHADER = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0, 1);
}`

const FRAG_SHADER = `
precision mediump float;
uniform sampler2D uScene, uFont, uPaletteTex;
uniform vec2 uRes;
uniform float uChars, uCell, uUsePalette, uUseAscii, uPaletteSize;
varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.299,0.587,0.114)); }
void main() {
  vec2 px = vUv * uRes;
  vec2 cell = floor(px / uCell) * uCell;
  vec3 scene = texture2D(uScene, cell / uRes).rgb;
  float l = lum(scene);
  float u = (0.5 + l * (uPaletteSize - 1.0)) / uPaletteSize;
  vec3 mapped = texture2D(uPaletteTex, vec2(u, 0.5)).rgb;
  float idxChar = floor((1.0 - l) * (uChars - 1.0));
  vec2 fuv = vec2((idxChar + fract(px.x / uCell)) / uChars, fract(px.y / uCell));
  float g = texture2D(uFont, fuv).r;
  vec3 col = mix(scene, mapped, uUsePalette);
  gl_FragColor = mix(vec4(col, 1.0), vec4(col * g, 1.0), uUseAscii);
}`

const FPS_THRESHOLD = 15
const COOLDOWN_MS = 3000
const PRESET_CYCLE_MS = 60000

export interface VisualizerConfig {
  engine: AudioEngine
  displayCanvas: HTMLCanvasElement
  milkdropCanvas: HTMLCanvasElement
}

export class Visualizer {
  private engine: AudioEngine
  private displayCanvas: HTMLCanvasElement
  private milkdropCanvas: HTMLCanvasElement
  private displayCtx: CanvasRenderingContext2D | null = null

  private mode: VizMode = 'waveform'
  private running = false
  private animFrameId = 0
  private presetCycleTimer = 0

  private waveformColor = 'rgba(215, 235, 255, 0.45)'
  private waveformLineWidth = 1.35
  private waveformStyle: WaveformStyle = 'line'
  private isFullscreen = false

  private butterchurnReady = false
  private butterchurnInitializing = false
  private butterchurnViz: ReturnType<typeof import('butterchurn').default.createVisualizer> | null = null
  private offscreenCanvas: HTMLCanvasElement | null = null
  private gl: WebGLRenderingContext | null = null
  private font: { tex: WebGLTexture; count: number } | null = null
  private sceneTex: WebGLTexture | null = null
  private paletteTex: WebGLTexture | null = null
  private prog: WebGLProgram | null = null
  private charset = DEFAULT_CHARSET
  private cellSize = 8
  private useAscii = 1.0
  private theme: VisualTheme | null = null
  private presets: Record<string, unknown> = {}
  private autoRamp = true

  private presetNames: string[] = []
  private currentPresetIndex = 0
  private lastPresetChangeTime = 0
  private lowFpsCounter = 0
  private framesThisSecond = 0
  private lastFpsTime = 0

  private lastRampTime = 0
  private baseCell = 8
  private targetCell = 8

  private butterchurnTimeData: Uint8Array<ArrayBuffer> | null = null
  private butterchurnTimeDataL: Uint8Array<ArrayBuffer> | null = null
  private butterchurnTimeDataR: Uint8Array<ArrayBuffer> | null = null
  private uniformCache = new Map<string, WebGLUniformLocation | null>()
  private lastPaletteThemeId: string | null = null
  private cachedPaletteData: Uint8Array | null = null

  constructor(config: VisualizerConfig) {
    this.engine = config.engine
    this.displayCanvas = config.displayCanvas
    this.milkdropCanvas = config.milkdropCanvas
    this.displayCtx = config.displayCanvas.getContext('2d')
  }

  setMode(mode: VizMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.syncCanvasVisibility()
  }

  private syncCanvasVisibility(): void {
    this.displayCanvas.style.display = this.mode === 'waveform' ? 'block' : 'none'
  }

  setWaveformColor(color: string): void { this.waveformColor = color }
  setWaveformLineWidth(width: number): void { this.waveformLineWidth = width }
  setWaveformStyle(style: WaveformStyle): void { this.waveformStyle = style }
  setFullscreen(isFs: boolean): void { this.isFullscreen = isFs }

  setCharset(charset: string): void {
    this.charset = charset || DEFAULT_CHARSET
    if (this.gl) {
      this.font = this.createAsciiTexture(this.charset)
    }
  }

  setCellSize(size: number): void {
    this.cellSize = size
    this.baseCell = size
    this.targetCell = size
  }

  setUseAscii(use: boolean): void { this.useAscii = use ? 1.0 : 0.0 }

  setTheme(themeId: string): void {
    this.theme = VIZ_THEMES.find(t => t.id === themeId) || VIZ_THEMES[1]
  }

  setAutoRamp(enabled: boolean): void { this.autoRamp = enabled }

  start(): void {
    if (this.running) return
    this.running = true
    this.syncCanvasVisibility()
    this.resizeCanvases()
    const now = performance.now()
    this.lastFpsTime = now
    this.lastRampTime = now
    this.lastPresetChangeTime = now
    this.animFrameId = requestAnimationFrame((t) => this.renderLoop(t))
    this.startPresetCycle()
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.animFrameId)
    if (this.presetCycleTimer) {
      clearInterval(this.presetCycleTimer)
      this.presetCycleTimer = 0
    }
  }

  resize(): void {
    this.resizeCanvases()
    if (this.butterchurnViz && this.offscreenCanvas) {
      const w = Math.floor(window.innerWidth / 2)
      const h = Math.floor(window.innerHeight / 2)
      this.offscreenCanvas.width = w
      this.offscreenCanvas.height = h
      try {
        this.butterchurnViz.setRendererSize(w, h)
      } catch { /* ignore */ }
    }
  }

  dispose(): void {
    this.stop()
    if (this.gl) {
      this.gl.getExtension('WEBGL_lose_context')?.loseContext()
      this.gl = null
    }
    this.butterchurnViz = null
    this.butterchurnReady = false
    this.butterchurnInitializing = false
    this.offscreenCanvas = null
    this.font = null
    this.sceneTex = null
    this.paletteTex = null
    this.prog = null
    this.presets = {}
    this.butterchurnTimeData = null
    this.butterchurnTimeDataL = null
    this.butterchurnTimeDataR = null
    this.uniformCache.clear()
    this.lastPaletteThemeId = null
    this.cachedPaletteData = null
  }

  private resizeCanvases(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    if (this.displayCanvas.width !== w || this.displayCanvas.height !== h) {
      this.displayCanvas.width = w
      this.displayCanvas.height = h
    }
    if (this.milkdropCanvas.width !== w || this.milkdropCanvas.height !== h) {
      this.milkdropCanvas.width = w
      this.milkdropCanvas.height = h
    }
  }

  private async ensureMilkdropReady(): Promise<void> {
    if (this.butterchurnReady || this.butterchurnInitializing) return

    const ctx = this.engine.getAudioContext()
    const ana = this.engine.getAnalyserNode()
    if (!ctx || !ana) return

    this.butterchurnInitializing = true

    try {
      type AnyRecord = Record<string, unknown>
      const bc = (window as unknown as AnyRecord)['butterchurn'] as AnyRecord | undefined
      if (!bc) {
        throw new Error('butterchurn global not found — ensure the CDN script is loaded')
      }
      const createVisualizerFn = (bc.createVisualizer) as
        | ((ctx: AudioContext, canvas: HTMLCanvasElement, opts: Record<string, number>) => import('butterchurn').Visualizer)
        | undefined
      if (!createVisualizerFn) {
        throw new Error('Could not locate butterchurn.createVisualizer')
      }

      const pr = (window as unknown as AnyRecord)['butterchurnPresets'] as AnyRecord | undefined
      if (!pr) {
        throw new Error('butterchurnPresets global not found — ensure the CDN script is loaded')
      }
      const getPresetsFn = (pr.getPresets) as
        | (() => Record<string, unknown>)
        | undefined
      if (!getPresetsFn) {
        throw new Error('Could not locate butterchurn-presets.getPresets')
      }

      const halfW = Math.floor(window.innerWidth / 2)
      const halfH = Math.floor(window.innerHeight / 2)

      this.offscreenCanvas = document.createElement('canvas')
      this.offscreenCanvas.width = halfW
      this.offscreenCanvas.height = halfH

      this.butterchurnViz = createVisualizerFn(ctx, this.offscreenCanvas, {
        width: halfW,
        height: halfH,
        pixelRatio: 1,
      })

      this.butterchurnTimeData = new Uint8Array(1024)
      this.butterchurnTimeDataL = new Uint8Array(1024)
      this.butterchurnTimeDataR = new Uint8Array(1024)

      this.presets = getPresetsFn()
      this.presetNames = Object.keys(this.presets).filter(name => !BLACKLIST.has(name))
      this.currentPresetIndex = Math.floor(Math.random() * this.presetNames.length)

      this.butterchurnViz!.loadPreset(
        this.presets[this.presetNames[this.currentPresetIndex]],
        0,
      )

      this.gl = this.milkdropCanvas.getContext('webgl', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
      })

      if (this.gl) {
        this.font = this.createAsciiTexture(this.charset)
        this.initWebGL()
      }

      this.butterchurnReady = true
    } catch (err) {
      console.warn('Failed to initialize butterchurn:', err)
    } finally {
      this.butterchurnInitializing = false
    }
  }

  private createAsciiTexture(chars: string): { tex: WebGLTexture; count: number } {
    const gl = this.gl!
    const size = 32
    const c = document.createElement('canvas')
    c.width = chars.length * size
    c.height = size
    const ctx2d = c.getContext('2d')!
    ctx2d.fillStyle = 'black'
    ctx2d.fillRect(0, 0, c.width, c.height)
    ctx2d.fillStyle = 'white'
    ctx2d.font = `${size}px monospace`
    ctx2d.textBaseline = 'top'
    ;[...chars].forEach((ch, i) => ctx2d.fillText(ch, i * size, 0))

    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    return { tex, count: chars.length }
  }

  private initWebGL(): void {
    const gl = this.gl!
    if (!gl) return

    this.uniformCache.clear()

    const compileShader = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return shader
    }

    this.prog = gl.createProgram()!
    gl.attachShader(this.prog, compileShader(gl.VERTEX_SHADER, VERT_SHADER))
    gl.attachShader(this.prog, compileShader(gl.FRAGMENT_SHADER, FRAG_SHADER))
    gl.linkProgram(this.prog)
    gl.useProgram(this.prog)

    const quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(this.prog, 'position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    this.sceneTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.milkdropCanvas.width, this.milkdropCanvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)

    this.paletteTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }

  private U(name: string): WebGLUniformLocation | null {
    const cached = this.uniformCache.get(name)
    if (cached !== undefined) return cached
    if (!this.prog || !this.gl) return null
    const loc = this.gl.getUniformLocation(this.prog, name)
    this.uniformCache.set(name, loc)
    return loc
  }

  private renderLoop(t: number): void {
    if (!this.running) return

    if (document.hidden) {
      this.animFrameId = requestAnimationFrame((tt) => this.renderLoop(tt))
      return
    }

    if (this.mode === 'waveform') {
      this.renderWaveform()
    } else if (!this.butterchurnReady) {
      void this.ensureMilkdropReady()
    } else {
      this.renderMilkdrop(t)
    }

    this.animFrameId = requestAnimationFrame((tt) => this.renderLoop(tt))
  }

  private renderWaveform(): void {
    const ctx = this.displayCtx
    const canvas = this.displayCanvas
    if (!ctx || !canvas.width || !canvas.height) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const timeData = new Uint8Array(1024)
    const freqData = new Uint8Array(1024)
    const hasTime = this.engine.getWaveformData(timeData)
    const hasFreq = this.engine.getFrequencyData(freqData)
    if (!hasTime && !hasFreq) return

    if (this.waveformStyle === 'bars' && hasFreq) {
      const barCount = 128
      const barGap = 1
      const barWidth = Math.max(1, w / barCount - barGap)

      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * freqData.length)
        const value = freqData[idx] / 255
        const barHeight = Math.max(2, value * h * 0.9)
        const x = i * (barWidth + barGap)
        const y = (h - barHeight) / 2

        ctx.fillStyle = this.waveformColor
        ctx.fillRect(x, y, barWidth, barHeight)
      }
    } else if (this.waveformStyle === 'mirror' && hasTime) {
      ctx.strokeStyle = this.waveformColor
      ctx.lineWidth = this.isFullscreen ? 1.75 : this.waveformLineWidth

      ctx.beginPath()
      for (let i = 0; i < timeData.length; i++) {
        const x = (i / (timeData.length - 1)) * w
        const val = timeData[i] / 255 - 0.5
        const y = h / 2 + val * h * 0.8
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      ctx.beginPath()
      for (let i = 0; i < timeData.length; i++) {
        const x = (i / (timeData.length - 1)) * w
        const val = timeData[i] / 255 - 0.5
        const y = h / 2 - val * h * 0.8
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    } else if (hasTime) {
      ctx.strokeStyle = this.waveformColor
      ctx.lineWidth = this.isFullscreen ? 1.75 : this.waveformLineWidth
      ctx.beginPath()
      for (let i = 0; i < timeData.length; i++) {
        const x = (i / (timeData.length - 1)) * w
        const y = (timeData[i] / 255) * h
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  private renderMilkdrop(t: number): void {
    if (!this.butterchurnViz || !this.gl || !this.offscreenCanvas || !this.font || !this.prog) return
    if (!this.butterchurnTimeData || !this.butterchurnTimeDataL || !this.butterchurnTimeDataR) return

    this.engine.getWaveformData(this.butterchurnTimeData)
    this.engine.getWaveformData(this.butterchurnTimeDataL)
    this.engine.getWaveformData(this.butterchurnTimeDataR)

    this.butterchurnViz.render({
      audioLevels: {
        timeByteArray: this.butterchurnTimeData,
        timeByteArrayL: this.butterchurnTimeDataL,
        timeByteArrayR: this.butterchurnTimeDataR,
      },
    })

    const gl = this.gl
    gl.viewport(0, 0, this.milkdropCanvas.width, this.milkdropCanvas.height)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.offscreenCanvas)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.font.tex)

    this.updateResolution(t)

    gl.uniform2f(this.U('uRes')!, this.milkdropCanvas.width, this.milkdropCanvas.height)
    gl.uniform1f(this.U('uChars')!, this.font.count)
    gl.uniform1f(this.U('uCell')!, this.cellSize)
    gl.uniform1f(this.U('uUseAscii')!, this.useAscii)

    gl.uniform1i(this.U('uScene')!, 0)
    gl.uniform1i(this.U('uFont')!, 1)
    gl.uniform1i(this.U('uPaletteTex')!, 2)

    if (this.theme) {
      gl.uniform1f(this.U('uUsePalette')!, this.theme.usePalette)
      if (this.theme.palette.length > 0) {
        const pSize = this.theme.palette.length
        gl.uniform1f(this.U('uPaletteSize')!, pSize)
        if (this.lastPaletteThemeId !== this.theme.id) {
          this.lastPaletteThemeId = this.theme.id
          this.cachedPaletteData = new Uint8Array(pSize * 4)
          this.theme.palette.forEach((col, i) => {
            this.cachedPaletteData![i * 4 + 0] = col[0] * 255
            this.cachedPaletteData![i * 4 + 1] = col[1] * 255
            this.cachedPaletteData![i * 4 + 2] = col[2] * 255
            this.cachedPaletteData![i * 4 + 3] = 255
          })
        }
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, this.paletteTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pSize, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.cachedPaletteData)
      }
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6)

    this.framesThisSecond++
    if (t - this.lastFpsTime > 2000) {
      this.lastFpsTime = t
      this.framesThisSecond = 0
      this.lowFpsCounter = 0
      return
    }

    if (t - this.lastFpsTime >= 1000) {
      const fps = this.framesThisSecond
      this.framesThisSecond = 0
      this.lastFpsTime = t

      const isCoolingDown = (t - this.lastPresetChangeTime) < COOLDOWN_MS
      if (!isCoolingDown && fps < FPS_THRESHOLD) {
        this.lowFpsCounter++
        if (this.lowFpsCounter >= 3) {
          console.warn(`[AUTO-BAN] blacklisted preset: "${this.presetNames[this.currentPresetIndex]}" (${fps} FPS)`)
          this.presetNames.splice(this.currentPresetIndex, 1)
          if (this.presetNames.length > 0) {
            this.triggerRandomPreset(0.5)
          }
          this.lowFpsCounter = 0
        }
      } else if (!isCoolingDown) {
        this.lowFpsCounter = 0
      }
    }
  }

  private updateResolution(t: number): void {
    if (!this.autoRamp) {
      this.cellSize += (this.baseCell - this.cellSize) * 0.05
      return
    }

    if (t - this.lastRampTime > 15000 && Math.random() < 0.02) {
      this.targetCell = this.baseCell * (2 + Math.random() * 3)
      this.lastRampTime = t
    }
    this.targetCell += (this.baseCell - this.targetCell) * 0.002
    this.cellSize += (this.targetCell - this.cellSize) * 0.05
  }

  triggerRandomPreset(blend = 1.2): void {
    if (!this.presetNames.length || !this.butterchurnViz) return
    let next: number
    do {
      next = Math.floor(Math.random() * this.presetNames.length)
    } while (next === this.currentPresetIndex && this.presetNames.length > 1)
    this.currentPresetIndex = next
    this.butterchurnViz.loadPreset(this.presets[this.presetNames[this.currentPresetIndex]], blend)
    this.lastPresetChangeTime = performance.now()
    this.lowFpsCounter = 0
  }

  private startPresetCycle(): void {
    this.presetCycleTimer = window.setInterval(() => {
      if (this.mode === 'milkdrop') {
        this.triggerRandomPreset(1.5)
      }
    }, PRESET_CYCLE_MS)
  }
}
