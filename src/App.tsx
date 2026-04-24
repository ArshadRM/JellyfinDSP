import { animate, motion } from 'framer-motion'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import { AudioEngine } from './lib/audioEngine'
import {
  authenticate,
  buildImageUrl,
  buildStreamUrl,
  fetchAudioLibrary,
  msFromTicks,
} from './lib/jellyfin'
import type { JellyfinAudioItem } from './lib/jellyfin'

const DEFAULT_SERVER_URL = 'https://watch.prnt.ink'
const STORAGE_KEY = 'jellyfinosu.session'

type Session = {
  serverUrl: string
  token: string
  userId: string
  username: string
}

function formatDuration(ms: number): string {
  if (!ms) {
    return '--:--'
  }

  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function applyPreservePitch(audio: HTMLAudioElement, preservePitch: boolean): void {
  const elementWithPitch = audio as HTMLAudioElement & {
    preservesPitch?: boolean
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }

  elementWithPitch.preservesPitch = preservePitch
  elementWithPitch.mozPreservesPitch = preservePitch
  elementWithPitch.webkitPreservesPitch = preservePitch
}

function shuffleItems(items: JellyfinAudioItem[]): JellyfinAudioItem[] {
  const next = [...items]

  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = next[i]
    next[i] = next[j]
    next[j] = temp
  }

  return next
}

function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [status, setStatus] = useState('Sign in to Jellyfin to load your music library.')
  const [search, setSearch] = useState('')
  const [isLoadingTracks, setIsLoadingTracks] = useState(false)
  const [tracks, setTracks] = useState<JellyfinAudioItem[]>([])
  const [totalTrackCount, setTotalTrackCount] = useState(0)
  const [selectedTrack, setSelectedTrack] = useState<JellyfinAudioItem | null>(null)
  const [masterVolume, setMasterVolume] = useState(0.85)
  const [isSpeedEnabled, setIsSpeedEnabled] = useState(true)
  const [speedPercent, setSpeedPercent] = useState(80)
  const [adjustPitch, setAdjustPitch] = useState(false)
  const [isLowPassEnabled, setIsLowPassEnabled] = useState(true)
  const [lowPassFrequency, setLowPassFrequency] = useState(55)
  const [lowPassQ, setLowPassQ] = useState(0.80)
  const [isPlaying, setIsPlaying] = useState(false)
  const [randomTargetId, setRandomTargetId] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrubberPeaks, setScrubberPeaks] = useState<number[]>([])
  const [hasInitialShuffleLoaded, setHasInitialShuffleLoaded] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  const scrubberCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const backgroundWaveformRef = useRef<HTMLCanvasElement | null>(null)
  const currentTimeRef = useRef(0)
  const durationRef = useRef(0)
  const expectedDurationRef = useRef(0)
  const activeCardRef = useRef<HTMLButtonElement | null>(null)
  const carouselWrapRef = useRef<HTMLDivElement | null>(null)
  const preloadAudioCacheRef = useRef<Record<string, HTMLAudioElement | undefined>>({})
  const bufferedTrackUrlCacheRef = useRef<Record<string, string | undefined>>({})
  const bufferingTasksRef = useRef<Record<string, Promise<void> | undefined>>({})
  const scrubberPeakCacheRef = useRef<Record<string, number[] | undefined>>({})
  const scrubberPeakTasksRef = useRef<Record<string, Promise<void> | undefined>>({})
  const engineRef = useRef(new AudioEngine())

  async function buildSongIntensityPeaks(
    streamUrl: string,
  ): Promise<number[]> {
    const response = await fetch(streamUrl)
    if (!response.ok) {
      throw new Error(`Waveform fetch failed (${response.status})`)
    }

    const payload = await response.arrayBuffer()

    const decodeContext = new AudioContext()
    try {
      const audioBuffer = await decodeContext.decodeAudioData(payload.slice(0))

      const bars = 260
      const blockSize = Math.max(1, Math.floor(audioBuffer.length / bars))
      const peaks = new Array(bars).fill(0)

      for (let bar = 0; bar < bars; bar += 1) {
        const start = bar * blockSize
        const end = Math.min(audioBuffer.length, start + blockSize)

        let peak = 0

        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
          const channelData = audioBuffer.getChannelData(channel)
          for (let i = start; i < end; i += 1) {
            const sample = Math.abs(channelData[i] ?? 0)
            if (sample > peak) {
              peak = sample
            }
          }
        }

        peaks[bar] = peak
      }

      const maxPeak = peaks.reduce((max, value) => Math.max(max, value), 0)
      if (maxPeak <= 0) {
        return peaks.map(() => 0)
      }

      return peaks.map((value) => value / maxPeak)
    } finally {
      await decodeContext.close()
    }
  }

  function getTrackById(trackId: string): JellyfinAudioItem | undefined {
    return tracks.find((track) => track.Id === trackId)
  }

  async function ensureTrackBuffered(trackId: string): Promise<void> {
    if (bufferedTrackUrlCacheRef.current[trackId] || bufferingTasksRef.current[trackId]) {
      return
    }

    const track = getTrackById(trackId)
    if (!track) {
      return
    }

    const task = (async () => {
      try {
        const streamUrl = buildStreamUrl(serverUrl, trackId, token, userId)
        const response = await fetch(streamUrl)
        if (!response.ok) {
          return
        }

        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        bufferedTrackUrlCacheRef.current[trackId] = objectUrl
      } finally {
        delete bufferingTasksRef.current[trackId]
      }
    })()

    bufferingTasksRef.current[trackId] = task
    await task
  }

  async function ensureWaveformCached(trackId: string): Promise<void> {
    if (scrubberPeakCacheRef.current[trackId] || scrubberPeakTasksRef.current[trackId]) {
      return
    }

    const task = (async () => {
      try {
        await ensureTrackBuffered(trackId)
        const bufferedUrl = bufferedTrackUrlCacheRef.current[trackId]
        const track = getTrackById(trackId)
        if (!track) {
          return
        }

        const streamUrl = bufferedUrl ?? buildStreamUrl(serverUrl, trackId, token, userId)
        const peaks = await buildSongIntensityPeaks(streamUrl)
        scrubberPeakCacheRef.current[trackId] = peaks
      } finally {
        delete scrubberPeakTasksRef.current[trackId]
      }
    })()

    scrubberPeakTasksRef.current[trackId] = task
    await task
  }

  const playbackRate = speedPercent / 100
  const frequencyMultiplier = isSpeedEnabled && adjustPitch ? playbackRate : 1
  const tempoMultiplier = isSpeedEnabled && !adjustPitch ? playbackRate : 1
  const effectiveRate = frequencyMultiplier * tempoMultiplier

  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  const isAuthenticated = token.length > 0 && userId.length > 0

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return
    }

    try {
      const stored = JSON.parse(raw) as Session
      setServerUrl(stored.serverUrl || DEFAULT_SERVER_URL)
      setUsername(stored.username || '')
      setToken(stored.token || '')
      setUserId(stored.userId || '')
      setStatus('Restored previous Jellyfin session.')
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    if (!token || !userId) {
      return
    }

    const session: Session = { serverUrl, token, userId, username }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  }, [serverUrl, token, userId, username])

  useEffect(() => {
    if (!token || !userId) {
      setHasInitialShuffleLoaded(false)
    }
  }, [token, userId])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    audio.playbackRate = effectiveRate
    applyPreservePitch(audio, tempoMultiplier !== 1)
  }, [effectiveRate, tempoMultiplier])

  useEffect(() => {
    engineRef.current.setMasterVolume(masterVolume)
  }, [masterVolume])

  useEffect(() => {
    engineRef.current.setLowPassEnabled(isLowPassEnabled)
  }, [isLowPassEnabled])

  useEffect(() => {
    engineRef.current.setLowPassFrequency(lowPassFrequency)
  }, [lowPassFrequency])

  useEffect(() => {
    engineRef.current.setLowPassQ(lowPassQ)
  }, [lowPassQ])

  useEffect(() => {
    return () => {
      engineRef.current.disconnect()
      clearBufferedTrackCache()
    }
  }, [])

  function clearPreloadCache(): void {
    const entries = Object.entries(preloadAudioCacheRef.current)

    for (const [, cachedAudio] of entries) {
      if (!cachedAudio) {
        continue
      }
      cachedAudio.pause()
      cachedAudio.removeAttribute('src')
    }

    preloadAudioCacheRef.current = {}
  }

  function clearBufferedTrackCache(): void {
    const entries = Object.entries(bufferedTrackUrlCacheRef.current)
    for (const [, objectUrl] of entries) {
      if (!objectUrl) {
        continue
      }
      URL.revokeObjectURL(objectUrl)
    }

    bufferedTrackUrlCacheRef.current = {}
    bufferingTasksRef.current = {}
    scrubberPeakCacheRef.current = {}
    scrubberPeakTasksRef.current = {}
  }

  async function loadTracks(
    query = '',
    authOverride?: { token: string; userId: string },
    fetchOptions?: { startIndex?: number; limit?: number },
  ): Promise<void> {
    const activeToken = authOverride?.token ?? token
    const activeUserId = authOverride?.userId ?? userId

    if (!activeToken || !activeUserId) {
      return
    }

    setIsLoadingTracks(true)

    try {
      const response = await fetchAudioLibrary(
        serverUrl,
        activeUserId,
        activeToken,
        query,
        fetchOptions,
      )
      const items = shuffleItems(response.items)
      setTracks(items)
      setTotalTrackCount(response.totalRecordCount)
      setStatus(`Loaded ${items.length} tracks from Jellyfin.`)
      setSelectedTrack((prev) => {
        if (!items.length) {
          return null
        }

        if (!prev) {
          return items[0]
        }

        const stillVisible = items.find((item) => item.Id === prev.Id)
        return stillVisible ?? items[0]
      })
    } catch (error) {
      setStatus(`Failed to load tracks: ${(error as Error).message}`)
    } finally {
      setIsLoadingTracks(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated || !hasInitialShuffleLoaded) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadTracks(search)
    }, 260)

    return () => window.clearTimeout(timer)
  }, [search, isAuthenticated, hasInitialShuffleLoaded])

  useEffect(() => {
    if (!isAuthenticated || hasInitialShuffleLoaded) {
      return
    }

    setHasInitialShuffleLoaded(true)
    void handleShuffleView()
  }, [isAuthenticated, hasInitialShuffleLoaded])

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setStatus('Authenticating against Jellyfin...')

    try {
      const result = await authenticate(serverUrl, username, password)
      setToken(result.AccessToken)
      setUserId(result.User.Id)
      setStatus(`Welcome ${result.User.Name}. Loading tracks...`)
      await loadTracks(search, {
        token: result.AccessToken,
        userId: result.User.Id,
      })
    } catch (error) {
      setStatus(`Authentication failed: ${(error as Error).message}`)
      setToken('')
      setUserId('')
    }
  }

  function handleLogout(): void {
    setToken('')
    setUserId('')
    setTracks([])
    setSelectedTrack(null)
    setRandomTargetId(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setScrubberPeaks([])
    localStorage.removeItem(STORAGE_KEY)
    clearPreloadCache()
    clearBufferedTrackCache()

    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }

    setStatus('Signed out from Jellyfin.')
  }

  async function handleSelectTrack(track: JellyfinAudioItem): Promise<void> {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    const streamUrl = buildStreamUrl(serverUrl, track.Id, token, userId)
    setSelectedTrack(track)
    expectedDurationRef.current = msFromTicks(track.RunTimeTicks) / 1000
    setDuration(expectedDurationRef.current)

    const cachedPeaks = scrubberPeakCacheRef.current[track.Id]
    setScrubberPeaks(cachedPeaks ?? [])

    if (!cachedPeaks) {
      void ensureWaveformCached(track.Id).then(() => {
        const refreshed = scrubberPeakCacheRef.current[track.Id]
        if (refreshed) {
          setScrubberPeaks(refreshed)
        }
      })
    }

    if (!bufferedTrackUrlCacheRef.current[track.Id]) {
      setStatus(`Buffering ${track.Name}...`)
      try {
        await ensureTrackBuffered(track.Id)
      } catch {
        // Fall back to stream URL if full buffering fails.
      }
    }

    const bufferedUrl = bufferedTrackUrlCacheRef.current[track.Id]

    audio.crossOrigin = 'anonymous'
    audio.src = bufferedUrl ?? streamUrl
    audio.load()
    audio.playbackRate = effectiveRate
    applyPreservePitch(audio, tempoMultiplier !== 1)

    engineRef.current.setupForElement(audio, {
      lowPassFrequency,
      lowPassQ,
      lowPassEnabled: isLowPassEnabled,
      masterVolume,
    })

    try {
      await engineRef.current.resume()
      await audio.play()
      setIsPlaying(true)
      setStatus(`Now playing: ${track.Name}`)
    } catch (error) {
      const reason =
        error instanceof Error && error.message
          ? error.message
          : 'Unknown playback failure'
      setStatus(`Playback failed: ${reason}`)
    }
  }

  function getSelectedIndex(): number {
    if (!selectedTrack) {
      return -1
    }

    return tracks.findIndex((track) => track.Id === selectedTrack.Id)
  }

  async function playTrackAtIndex(index: number): Promise<void> {
    if (index < 0 || index >= tracks.length) {
      return
    }

    await handleSelectTrack(tracks[index])
  }

  async function handlePrevTrack(): Promise<void> {
    const currentIndex = getSelectedIndex()
    if (currentIndex <= 0) {
      return
    }

    await playTrackAtIndex(currentIndex - 1)
  }

  async function handleNextTrack(): Promise<void> {
    const currentIndex = getSelectedIndex()
    if (currentIndex < 0 || currentIndex >= tracks.length - 1) {
      return
    }

    await playTrackAtIndex(currentIndex + 1)
  }

  async function handleRandomJump(): Promise<void> {
    if (!tracks.length) {
      return
    }

    const randomTrack =
      (randomTargetId && tracks.find((track) => track.Id === randomTargetId)) ||
      tracks[Math.floor(Math.random() * tracks.length)]

    if (!randomTrack) {
      return
    }

    await handleSelectTrack(randomTrack)
  }

  async function handleShuffleView(): Promise<void> {
    if (!isAuthenticated) {
      return
    }

    const windowSize = 220
    const maxStart = Math.max(0, totalTrackCount - windowSize)
    const randomStart = maxStart > 0 ? Math.floor(Math.random() * (maxStart + 1)) : 0

    await loadTracks(search, undefined, {
      startIndex: randomStart,
      limit: windowSize,
    })
  }

  function handleScrub(timeSec: number): void {
    const audio = audioRef.current
    if (!audio || Number.isNaN(timeSec)) {
      return
    }

    const maxTime = Number.isFinite(audio.duration) ? audio.duration : 0
    const clamped = Math.min(maxTime, Math.max(0, timeSec))
    audio.currentTime = clamped
    setCurrentTime(clamped)
  }

  async function handleTrackEnded(): Promise<void> {
    const currentIndex = getSelectedIndex()
    if (currentIndex < 0) {
      return
    }

    const nextIndex = currentIndex + 1
    if (nextIndex >= tracks.length) {
      setIsPlaying(false)
      setStatus('Reached end of current list.')
      return
    }

    await playTrackAtIndex(nextIndex)
  }

  function scrubFromPointer(event: ReactMouseEvent<HTMLCanvasElement>): void {
    if (!selectedTrack || duration <= 0) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) {
      return
    }

    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    handleScrub(ratio * duration)
  }

  function centerSelectedCard(): void {
    const card = activeCardRef.current
    const wrap = carouselWrapRef.current

    if (!card || !wrap) {
      return
    }

    const cardRect = card.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    const cardCenter = cardRect.top + cardRect.height / 2
    const wrapCenter = wrapRect.top + wrapRect.height / 2
    const delta = cardCenter - wrapCenter

    wrap.scrollTo({
      top: wrap.scrollTop + delta,
      behavior: 'smooth',
    })
  }

  useLayoutEffect(() => {
    const rafId = requestAnimationFrame(() => {
      centerSelectedCard()
    })

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [selectedTrack?.Id, tracks])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    const updateCurrentTime = (): void => {
      setCurrentTime(audio.currentTime || 0)
    }

    const updateDuration = (): void => {
      const metadataDuration = Number.isFinite(audio.duration) ? audio.duration : 0
      const stableDuration = expectedDurationRef.current || metadataDuration
      setDuration(stableDuration)
    }

    audio.addEventListener('timeupdate', updateCurrentTime)
    audio.addEventListener('loadedmetadata', updateDuration)
    audio.addEventListener('durationchange', updateDuration)

    return () => {
      audio.removeEventListener('timeupdate', updateCurrentTime)
      audio.removeEventListener('loadedmetadata', updateDuration)
      audio.removeEventListener('durationchange', updateDuration)
    }
  }, [])

  useEffect(() => {
    const backgroundCanvas = backgroundWaveformRef.current
    if (!backgroundCanvas) {
      return
    }

    const backgroundCtx = backgroundCanvas.getContext('2d')
    if (!backgroundCtx) {
      return
    }

    const waveformData = new Uint8Array(1024)
    let rafId = 0

    const syncCanvasSize = (canvas: HTMLCanvasElement): { width: number; height: number } => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      return { width, height }
    }

    const draw = (): void => {
      const size = syncCanvasSize(backgroundCanvas)
      if (!size.width || !size.height) {
        rafId = requestAnimationFrame(draw)
        return
      }

      backgroundCtx.clearRect(0, 0, size.width, size.height)
      const hasData = engineRef.current.getWaveformData(waveformData)

      if (hasData) {
        backgroundCtx.strokeStyle = 'rgba(165, 186, 212, 0.18)'
        backgroundCtx.lineWidth = 1.25
        backgroundCtx.beginPath()

        for (let i = 0; i < waveformData.length; i += 1) {
          const x = (i / (waveformData.length - 1)) * size.width
          const y = (waveformData[i] / 255) * size.height

          if (i === 0) {
            backgroundCtx.moveTo(x, y)
          } else {
            backgroundCtx.lineTo(x, y)
          }
        }

        backgroundCtx.stroke()
      }

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    const scrubberCanvas = scrubberCanvasRef.current
    if (!scrubberCanvas) {
      return
    }

    const scrubberCtx = scrubberCanvas.getContext('2d')
    if (!scrubberCtx) {
      return
    }

    let rafId = 0

    const syncCanvasSize = (canvas: HTMLCanvasElement): { width: number; height: number } => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      return { width, height }
    }

    const draw = (): void => {
      const size = syncCanvasSize(scrubberCanvas)
      if (!size.width || !size.height) {
        rafId = requestAnimationFrame(draw)
        return
      }

      scrubberCtx.fillStyle = 'rgba(8, 16, 31, 0.88)'
      scrubberCtx.fillRect(0, 0, size.width, size.height)

      const localDuration = durationRef.current
      const progress = localDuration > 0 ? currentTimeRef.current / localDuration : 0
      const peaks = scrubberPeaks.length ? scrubberPeaks : new Array(160).fill(0.18)
      const barCount = peaks.length
      const barGap = 1
      const barWidth = Math.max(1, size.width / barCount - barGap)

      for (let i = 0; i < barCount; i += 1) {
        const peak = peaks[i] ?? 0
        const barHeight = Math.max(2, peak * (size.height - 4))
        const x = i * (barWidth + barGap)
        const y = (size.height - barHeight) / 2
        const barProgress = i / barCount

        scrubberCtx.fillStyle =
          barProgress <= progress
            ? 'rgba(255, 159, 47, 0.95)'
            : 'rgba(214, 223, 236, 0.72)'
        scrubberCtx.fillRect(x, y, barWidth, barHeight)
      }

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [scrubberPeaks])

  useEffect(() => {
    if (!tracks.length) {
      setRandomTargetId(null)
      return
    }

    const pool = tracks.filter((track) => track.Id !== selectedTrack?.Id)
    if (!pool.length) {
      setRandomTargetId(null)
      return
    }

    const candidate = pool[Math.floor(Math.random() * pool.length)]
    setRandomTargetId(candidate.Id)
  }, [selectedTrack?.Id, tracks])

  useEffect(() => {
    if (!token || !selectedTrack || !tracks.length) {
      return
    }

    const currentIndex = tracks.findIndex((track) => track.Id === selectedTrack.Id)
    if (currentIndex < 0) {
      return
    }

    const keepIds = new Set<string>()

    for (let offset = -2; offset <= 2; offset += 1) {
      const track = tracks[currentIndex + offset]
      if (!track) {
        continue
      }

      keepIds.add(track.Id)

      if (!preloadAudioCacheRef.current[track.Id]) {
        const preloadAudio = new Audio()
        preloadAudio.preload = 'auto'
        preloadAudio.src =
          bufferedTrackUrlCacheRef.current[track.Id] ??
          buildStreamUrl(serverUrl, track.Id, token, userId)
        preloadAudio.load()
        preloadAudioCacheRef.current[track.Id] = preloadAudio
      }

      void ensureTrackBuffered(track.Id)
      void ensureWaveformCached(track.Id)
    }

    if (randomTargetId) {
      keepIds.add(randomTargetId)
      if (!preloadAudioCacheRef.current[randomTargetId]) {
        const preloadAudio = new Audio()
        preloadAudio.preload = 'auto'
        preloadAudio.src =
          bufferedTrackUrlCacheRef.current[randomTargetId] ??
          buildStreamUrl(serverUrl, randomTargetId, token, userId)
        preloadAudio.load()
        preloadAudioCacheRef.current[randomTargetId] = preloadAudio
      }

      void ensureTrackBuffered(randomTargetId)
      void ensureWaveformCached(randomTargetId)
    }

    for (const [id, cachedAudio] of Object.entries(preloadAudioCacheRef.current)) {
      if (keepIds.has(id) || !cachedAudio) {
        continue
      }
      cachedAudio.pause()
      cachedAudio.removeAttribute('src')
      delete preloadAudioCacheRef.current[id]
    }
  }, [selectedTrack?.Id, randomTargetId, tracks, serverUrl, token, userId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable

      if (isTypingTarget) {
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        void handlePrevTrack()
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        void handleNextTrack()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedTrack, tracks])

  async function togglePlayback(): Promise<void> {
    const audio = audioRef.current
    if (!audio || !selectedTrack) {
      return
    }

    if (audio.paused) {
      try {
        await engineRef.current.resume()
        await audio.play()
        setIsPlaying(true)
      } catch {
        setStatus('Click the page once to unlock audio playback.')
      }
      return
    }

    audio.pause()
    setIsPlaying(false)
  }

  const trackCards = useMemo(() => {
    return tracks.map((track) => {
      const isActive = selectedTrack?.Id === track.Id
      const duration = formatDuration(msFromTicks(track.RunTimeTicks))

      return (
        <motion.button
          type="button"
          key={track.Id}
          className={`track-card ${isActive ? 'active' : ''}`}
          ref={isActive ? activeCardRef : null}
          onClick={() => {
            void handleSelectTrack(track)
          }}
          whileHover={{ x: 8, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        >
          <img
            src={buildImageUrl(serverUrl, track.Id, token)}
            alt=""
            className="album-art"
            loading="lazy"
            onError={(event) => {
              const target = event.currentTarget
              target.style.visibility = 'hidden'
            }}
          />
          <span className="track-main">
            <strong>{track.Name}</strong>
            <small>{track.Artists?.join(', ') || track.Album || 'Unknown artist'}</small>
          </span>
          <span className="track-time">{duration}</span>
        </motion.button>
      )
    })
  }, [tracks, selectedTrack?.Id, serverUrl, token])

  return (
    <>
      <canvas ref={backgroundWaveformRef} className="global-background-waveform" />
      <main className="shell">
      <section className="panel left-panel">
        <h1>JellyfinOSU</h1>
        <p className="subhead">DayCore-style playback + low-pass tuning.</p>

        <form className="auth-form" onSubmit={handleLogin}>
          <label>
            Jellyfin URL
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://watch.prnt.ink"
              required
            />
          </label>
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <div className="auth-actions">
            <button type="submit">Connect</button>
            <button
              type="button"
              className="ghost"
              onClick={handleLogout}
              disabled={!isAuthenticated}
            >
              Logout
            </button>
          </div>
        </form>

        <p className="status">{status}</p>

        <div className="control-card">
          <h2>Volume</h2>

          <label>
            Global Volume ({Math.round(masterVolume * 100)}%)
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={masterVolume}
              onChange={(event) => setMasterVolume(Number(event.target.value))}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              void togglePlayback()
            }}
            disabled={!selectedTrack}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>

        <div className="control-card">
          <div className="menu-head">
            <h2>Speed</h2>
            <button
              type="button"
              onClick={() => setIsSpeedEnabled((prev) => !prev)}
            >
              {isSpeedEnabled ? 'Speed On' : 'Speed Off'}
            </button>
          </div>

          <label>
            Speed ({speedPercent}%)
            <input
              type="range"
              min={60}
              max={160}
              step={1}
              value={speedPercent}
              onChange={(event) => setSpeedPercent(Number(event.target.value))}
            />
          </label>

          <label className="inline-switch">
            <input
              type="checkbox"
              checked={adjustPitch}
              onChange={(event) => setAdjustPitch(event.target.checked)}
            />
            Adjust Pitch
          </label>
        </div>

        <div className="control-card">
          <div className="menu-head">
            <h2>Low Pass</h2>
            <button
              type="button"
              onClick={() => setIsLowPassEnabled((prev) => !prev)}
            >
              {isLowPassEnabled ? 'Low Pass On' : 'Low Pass Off'}
            </button>
          </div>

          <label>
            Low-pass cutoff ({Math.round(lowPassFrequency)} Hz)
            <input
              type="range"
              min={10}
              max={10000}
              step={1}
              value={lowPassFrequency}
              onChange={(event) => setLowPassFrequency(Number(event.target.value))}
            />
          </label>

          <label>
            Resonance / Q ({lowPassQ.toFixed(2)})
            <input
              type="range"
              min={0.01}
              max={5}
              step={0.01}
              value={lowPassQ}
              onChange={(event) => setLowPassQ(Number(event.target.value))}
            />
          </label>
        </div>
      </section>

      <section className="panel right-panel">
        <div className="playback-strip">
          <div className="playback-meta">
            <strong>{selectedTrack?.Name ?? 'No track selected'}</strong>
            <span>
              {formatDuration(currentTime * 1000)} / {formatDuration(duration * 1000)}
            </span>
          </div>
          <canvas
            ref={scrubberCanvasRef}
            className="waveform-canvas"
            onMouseDown={scrubFromPointer}
            onMouseMove={(event) => {
              if (event.buttons === 1) {
                scrubFromPointer(event)
              }
            }}
          />
        </div>

        <header className="library-head">
          <h2>Library Carousel</h2>
          <div className="library-actions">
            <button
              type="button"
              className="ghost nav-btn"
              onClick={() => {
                void handleShuffleView()
              }}
              disabled={!isAuthenticated || totalTrackCount === 0}
            >
              Shuffle View
            </button>
            <button
              type="button"
              className="ghost nav-btn"
              onClick={() => {
                void handlePrevTrack()
              }}
              disabled={!selectedTrack || getSelectedIndex() <= 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="ghost nav-btn"
              onClick={() => {
                void handleRandomJump()
              }}
              disabled={!selectedTrack || tracks.length < 2}
            >
              Random Jump
            </button>
            <button
              type="button"
              className="ghost nav-btn"
              onClick={() => {
                void handleNextTrack()
              }}
              disabled={!selectedTrack || getSelectedIndex() >= tracks.length - 1}
            >
              Next
            </button>
            <input
              placeholder="Search tracks"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={!isAuthenticated}
            />
          </div>
        </header>

        <div className="carousel-wrap">
          {isLoadingTracks ? (
            <div className="empty-state">Loading tracks...</div>
          ) : tracks.length === 0 ? (
            <div className="empty-state">No tracks loaded yet.</div>
          ) : (
            <motion.div
              className="carousel"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              ref={(node) => {
                if (!node) {
                  return
                }

                animate(node, { opacity: 1 }, { duration: 0.2 })
              }}
            >
              {trackCards}
            </motion.div>
          )}
        </div>

        <audio
          ref={audioRef}
          className="native-player"
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onEnded={() => {
            void handleTrackEnded()
          }}
        />
      </section>
    </main>
    </>
  )
}

export default App
