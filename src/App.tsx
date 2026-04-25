import { animate, motion, AnimatePresence } from 'framer-motion'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import { AudioEngine } from './lib/audioEngine'
import { Knob } from './components/Knob'
import { RangeSlider } from './components/RangeSlider'
import { Transport } from './components/Transport'
import { FullscreenButton } from './components/FullscreenButton'
import {
  authenticate,
  authHeader,
  buildImageUrl,
  buildStreamUrl,
  buildWebUrl,
  fetchAudioLibrary,
  msFromTicks,
} from './lib/jellyfin'
import type { JellyfinAudioItem } from './lib/jellyfin'
import type { JellyfinTranscodingOptions } from './lib/jellyfin'

const DEFAULT_SERVER_URL = 'https://watch.prnt.ink'
const STORAGE_KEY = 'jellyfindsp.session'
const SETTINGS_KEY = 'jellyfindsp.settings'
const STATS_KEY = 'jellyfindsp.stats'

type CacheMode = 'queue-nearby-random' | 'queue-nearby' | 'queue-only' | 'none'

type CachedTrackInfo = {
  id: string
  name: string
  bytes: number
}

type PersistedStats = {
  totalDataBytes: number
  totalSongsPlayed: number
}

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

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  const decimals = exponent === 0 ? 0 : value < 10 ? 2 : 1
  return `${value.toFixed(decimals)} ${units[exponent]}`
}

function loadPersistedStats(): PersistedStats {
  const raw = localStorage.getItem(STATS_KEY)
  if (!raw) {
    return { totalDataBytes: 0, totalSongsPlayed: 0 }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedStats>
    return {
      totalDataBytes: Math.max(0, Number(parsed.totalDataBytes ?? 0)),
      totalSongsPlayed: Math.max(0, Number(parsed.totalSongsPlayed ?? 0)),
    }
  } catch {
    return { totalDataBytes: 0, totalSongsPlayed: 0 }
  }
}

const initialSettings = (() => {
  const saved = localStorage.getItem(SETTINGS_KEY)
  if (saved) {
    try {
      return JSON.parse(saved)
    } catch {}
  }
  return {}
})()

function App() {
  const initialStats = loadPersistedStats()
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL)
  const [username, setUsername] = useState('Guest')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [status, setStatus] = useState('Sign in to Jellyfin to load your music library.')
  const [search, setSearch] = useState('')
  const [isLoadingTracks, setIsLoadingTracks] = useState(false)
  const [tracks, setTracks] = useState<JellyfinAudioItem[]>([])
  const [totalTrackCount, setTotalTrackCount] = useState(0)
  const [selectedTrack, setSelectedTrack] = useState<JellyfinAudioItem | null>(null)
  const [masterVolume, setMasterVolume] = useState(initialSettings.masterVolume ?? 1.00)
  const [isSpeedEnabled, setIsSpeedEnabled] = useState(initialSettings.isSpeedEnabled ?? true)
  const [speedPercent, setSpeedPercent] = useState(initialSettings.speedPercent ?? 80)
  const [adjustPitch, setAdjustPitch] = useState(initialSettings.adjustPitch ?? true)
  const [isLowPassEnabled, setIsLowPassEnabled] = useState(initialSettings.isLowPassEnabled ?? true)
  const [isReduceClippingEnabled, setIsReduceClippingEnabled] = useState(initialSettings.isReduceClippingEnabled ?? true)
  const [lowPassFrequency, setLowPassFrequency] = useState(initialSettings.lowPassFrequency ?? 55)
  const [lowPassQ, setLowPassQ] = useState(initialSettings.lowPassQ ?? 0.80)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPhaserEnabled, setIsPhaserEnabled] = useState(initialSettings.isPhaserEnabled ?? false)
  const [phaserMinFreq, setPhaserMinFreq] = useState(initialSettings.phaserMinFreq ?? 440)
  const [phaserMaxFreq, setPhaserMaxFreq] = useState(initialSettings.phaserMaxFreq ?? 1600)
  const [phaserRate, setPhaserRate] = useState(initialSettings.phaserRate ?? 0.5)
  const [phaserDepth, setPhaserDepth] = useState(initialSettings.phaserDepth ?? 1.0)
  const [phaserFeedback, setPhaserFeedback] = useState(initialSettings.phaserFeedback ?? 0.7)
  const [randomTargetId, setRandomTargetId] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrubberPeaks, setScrubberPeaks] = useState<number[]>([])
  const [hasInitialShuffleLoaded, setHasInitialShuffleLoaded] = useState(false)
  const [isSpeedExpanded, setIsSpeedExpanded] = useState(initialSettings.isSpeedExpanded ?? true)
  const [isLowPassExpanded, setIsLowPassExpanded] = useState(initialSettings.isLowPassExpanded ?? true)
  const [isPhaserExpanded, setIsPhaserExpanded] = useState(false)
  const [isQueueExpanded, setIsQueueExpanded] = useState(initialSettings.isQueueExpanded ?? true)
  const [isTranscodingExpanded, setIsTranscodingExpanded] = useState(false)
  const [isTranscodingEnabled, setIsTranscodingEnabled] = useState(initialSettings.isTranscodingEnabled ?? false)
  const [transcodeBitrateKbps, setTranscodeBitrateKbps] = useState(initialSettings.transcodeBitrateKbps ?? 192)
  const [transcodeContainer, setTranscodeContainer] = useState<'mp3' | 'aac' | 'opus'>(initialSettings.transcodeContainer ?? 'mp3')
  const [transcodeProtocol, setTranscodeProtocol] = useState<'http' | 'hls'>(initialSettings.transcodeProtocol ?? 'http')
  const [transcodeChannels, setTranscodeChannels] = useState<1 | 2>(initialSettings.transcodeChannels ?? 2)
  const [isCachingExpanded, setIsCachingExpanded] = useState(false)
  const [cachingMode, setCachingMode] = useState<CacheMode>(initialSettings.cachingMode ?? 'queue-nearby-random')
  const [cacheLimitMb, setCacheLimitMb] = useState(initialSettings.cacheLimitMb ?? 1024)
  const [isCacheLimitTextOnly, setIsCacheLimitTextOnly] = useState(initialSettings.isCacheLimitTextOnly ?? true)
  const [cachedTracks, setCachedTracks] = useState<CachedTrackInfo[]>([])
  const [isStatsExpanded, setIsStatsExpanded] = useState(initialSettings.isStatsExpanded ?? true)
  const [sessionDataBytes, setSessionDataBytes] = useState(0)
  const [totalDataBytes, setTotalDataBytes] = useState(initialStats.totalDataBytes)
  const [sessionSongsPlayed, setSessionSongsPlayed] = useState(0)
  const [totalSongsPlayed, setTotalSongsPlayed] = useState(initialStats.totalSongsPlayed)
  const [isPlaybackEcoMode, setIsPlaybackEcoMode] = useState(initialSettings.isPlaybackEcoMode ?? false)
  const [isVolumeHidden, setIsVolumeHidden] = useState(false)
  const [isFullscreenActive, setIsFullscreenActive] = useState(false)
  
  const [queue, setQueue] = useState<JellyfinAudioItem[]>(() => {
    const savedQueue = localStorage.getItem('jellyfindsp.queue')
    const savedServer = localStorage.getItem('jellyfindsp.queueServerUrl')
    
    // Determine the current expected server URL from session
    const currentServer = (() => {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try {
          return (JSON.parse(saved) as Session).serverUrl
        } catch {}
      }
      return DEFAULT_SERVER_URL
    })()

    if (savedQueue && savedServer === currentServer) {
      try {
        return JSON.parse(savedQueue) as JellyfinAudioItem[]
      } catch {
        return []
      }
    }
    return []
  })

  const audioRef = useRef<HTMLAudioElement>(null)
  const scrubberCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const backgroundWaveformRef = useRef<HTMLCanvasElement | null>(null)
  const currentTimeRef = useRef(0)
  const durationRef = useRef(0)
  const expectedDurationRef = useRef(0)
  const leftPanelRef = useRef<HTMLElement | null>(null)
  const rightPanelRef = useRef<HTMLElement | null>(null)
  const activeCardRef = useRef<HTMLButtonElement | null>(null)
  const carouselWrapRef = useRef<HTMLDivElement | null>(null)
  const preloadAudioCacheRef = useRef<Record<string, HTMLAudioElement | undefined>>({})
  const bufferedTrackUrlCacheRef = useRef<Record<string, string | undefined>>({})
  const bufferingTasksRef = useRef<Record<string, Promise<void> | undefined>>({})
  const scrubberPeakCacheRef = useRef<Record<string, number[] | undefined>>({})
  const scrubberPeakTasksRef = useRef<Record<string, Promise<void> | undefined>>({})
  const cachedTrackInfoRef = useRef<Record<string, CachedTrackInfo | undefined>>({})
  const cacheOrderRef = useRef<string[]>([])
  const playedTrackIdsRef = useRef<Set<string>>(new Set())
  const totalDataBytesRef = useRef(initialStats.totalDataBytes)
  const totalSongsPlayedRef = useRef(initialStats.totalSongsPlayed)
  const engineRef = useRef(new AudioEngine())
  const lastSearchIdRef = useRef(0)
  const draggedItemRef = useRef<number | null>(null)

  function addStreamedBytes(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return
    }

    setSessionDataBytes((prev) => prev + bytes)
    setTotalDataBytes((prev) => {
      const next = prev + bytes
      totalDataBytesRef.current = next
      return next
    })
  }

  function persistStats(totalBytes: number, songsPlayed: number): void {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        totalDataBytes: totalBytes,
        totalSongsPlayed: songsPlayed,
      }),
    )
  }

  function getCachedBytesTotal(): number {
    return Object.values(cachedTrackInfoRef.current).reduce((sum, info) => sum + (info?.bytes ?? 0), 0)
  }

  function syncCachedTracksState(): void {
    const ordered = cacheOrderRef.current
      .map((id) => cachedTrackInfoRef.current[id])
      .filter((entry): entry is CachedTrackInfo => Boolean(entry))
    setCachedTracks(ordered)
  }

  function getProtectedCacheIds(): Set<string> {
    const protectedIds = new Set<string>()

    if (selectedTrack?.Id) {
      protectedIds.add(selectedTrack.Id)
    }

    if (cachingMode === 'queue-only' || cachingMode === 'queue-nearby' || cachingMode === 'queue-nearby-random') {
      for (const queuedTrack of queue) {
        protectedIds.add(queuedTrack.Id)
      }
    }

    if (selectedTrack?.Id && (cachingMode === 'queue-nearby' || cachingMode === 'queue-nearby-random')) {
      const selectedIndex = tracks.findIndex((track) => track.Id === selectedTrack.Id)
      if (selectedIndex >= 0) {
        const nearby = tracks[selectedIndex + 1]
        if (nearby) {
          protectedIds.add(nearby.Id)
        }
      }
    }

    if (randomTargetId && cachingMode === 'queue-nearby-random') {
      protectedIds.add(randomTargetId)
    }

    return protectedIds
  }

  function evictCacheEntry(trackId: string): void {
    const objectUrl = bufferedTrackUrlCacheRef.current[trackId]
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      delete bufferedTrackUrlCacheRef.current[trackId]
    }

    const cachedAudio = preloadAudioCacheRef.current[trackId]
    if (cachedAudio) {
      cachedAudio.pause()
      cachedAudio.removeAttribute('src')
      delete preloadAudioCacheRef.current[trackId]
    }

    delete cachedTrackInfoRef.current[trackId]
    cacheOrderRef.current = cacheOrderRef.current.filter((id) => id !== trackId)
  }

  function pruneBufferedCache(limitOverrideMb?: number): void {
    if (cachingMode === 'none') {
      for (const trackId of [...cacheOrderRef.current]) {
        evictCacheEntry(trackId)
      }
      syncCachedTracksState()
      return
    }

    const hardLimitBytes = Math.max(1, Math.floor((limitOverrideMb ?? cacheLimitMb) * 1024 * 1024))
    let total = getCachedBytesTotal()
    if (total <= hardLimitBytes) {
      syncCachedTracksState()
      return
    }

    const protectedIds = getProtectedCacheIds()
    for (const trackId of [...cacheOrderRef.current]) {
      if (total <= hardLimitBytes) {
        break
      }
      if (protectedIds.has(trackId)) {
        continue
      }

      const bytes = cachedTrackInfoRef.current[trackId]?.bytes ?? 0
      evictCacheEntry(trackId)
      total -= bytes
    }

    syncCachedTracksState()
  }

  async function buildSongIntensityPeaks(trackId: string, authToken: string): Promise<number[]> {
    // Using the official Jellyfin Waveform endpoint is much faster than decoding locally
    const url = `${serverUrl}/Audio/${trackId}/WaveformSamples?api_key=${authToken}`
    
    try {
      const response = await fetch(url, {
        headers: {
          'X-Emby-Token': authToken,
          'X-Emby-Authorization': authHeader(authToken),
        }
      })
      
      if (!response.ok) {
        throw new Error(`Waveform endpoint failed (${response.status})`)
      }

      const lengthHeader = Number(response.headers.get('content-length') || 0)
      if (lengthHeader > 0) {
        addStreamedBytes(lengthHeader)
      }

      const data = await response.json()
      // Jellyfin samples are typically integers (0-255 or similar)
      const samples: number[] = data.Samples || []
      
      if (samples.length === 0) return new Array(260).fill(0)

      const maxSample = Math.max(...samples) || 1
      return samples.map(s => s / maxSample)
    } catch (err) {
      console.warn('Failed to fetch server-side waveform, using fallback:', err)
      return new Array(260).fill(0)
    }
  }

  function getTrackById(trackId: string): JellyfinAudioItem | undefined {
    return tracks.find((track) => track.Id === trackId)
  }

  async function ensureTrackBuffered(trackId: string): Promise<void> {
    if (cachingMode === 'none') {
      return
    }

    if (bufferedTrackUrlCacheRef.current[trackId] || bufferingTasksRef.current[trackId]) {
      return
    }

    const track = getTrackById(trackId)
    if (!track) {
      return
    }

    const task = (async () => {
      try {
        pruneBufferedCache(cacheLimitMb)

        const sid = Math.random().toString(36).substring(2, 10)
        const streamUrl = buildStreamUrl(serverUrl, trackId, token, userId, transcodingOptions, sid)
        const response = await fetch(streamUrl, {
          headers: {
            'X-Emby-Token': token,
            'X-Emby-Authorization': authHeader(token),
          }
        })
        if (!response.ok) {
          const details = await response.text().catch(() => 'N/A')
          console.warn(`Buffer Fetch Failed for ${trackId}:`, details)
          return
        }

        const blob = await response.blob()
        const bytes = blob.size
        addStreamedBytes(bytes)

        const objectUrl = URL.createObjectURL(blob)
        bufferedTrackUrlCacheRef.current[trackId] = objectUrl
        const trackName = track.Name || `Track ${trackId}`
        cachedTrackInfoRef.current[trackId] = {
          id: trackId,
          name: trackName,
          bytes,
        }
        cacheOrderRef.current = [...cacheOrderRef.current.filter((id) => id !== trackId), trackId]
        pruneBufferedCache(cacheLimitMb)
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
        const track = getTrackById(trackId)
        if (!track) {
          return
        }

        const peaks = await buildSongIntensityPeaks(trackId, token)
        scrubberPeakCacheRef.current[trackId] = peaks
      } finally {
        delete scrubberPeakTasksRef.current[trackId]
      }
    })()

    scrubberPeakTasksRef.current[trackId] = task
    await task
  }

  const playbackRate = speedPercent / 100
  const frequencyMultiplier = isSpeedEnabled && adjustPitch && !isPlaybackEcoMode ? playbackRate : 1
  const tempoMultiplier = isSpeedEnabled && !adjustPitch ? playbackRate : 1
  const effectiveRate = isSpeedEnabled ? frequencyMultiplier * tempoMultiplier : 1
  const lowPassSliderPercent = Math.min(
    100,
    Math.max(0, ((lowPassFrequency - 10) / (10000 - 10)) * 100),
  )
  const transcodingOptions = useMemo<JellyfinTranscodingOptions | undefined>(() => {
    if (!isTranscodingEnabled) {
      return undefined
    }

    return {
      maxStreamingBitrate: Math.max(16_000, Math.floor(transcodeBitrateKbps * 1000)),
      container: transcodeContainer,
      audioCodec: transcodeContainer,
      transcodingProtocol: transcodeProtocol,
      audioChannels: transcodeChannels,
    }
  }, [
    isTranscodingEnabled,
    transcodeBitrateKbps,
    transcodeContainer,
    transcodeProtocol,
    transcodeChannels,
  ])

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
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw || token) {
      return
    }

    const timer = window.setTimeout(() => {
      const fakeEvent = { preventDefault: () => { } } as React.FormEvent<HTMLFormElement>
      void handleLogin(fakeEvent)
    }, 800)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    if (isPlaybackEcoMode && isSpeedEnabled) {
      audio.playbackRate = playbackRate
      applyPreservePitch(audio, false)
      return
    }

    audio.playbackRate = effectiveRate
    applyPreservePitch(audio, tempoMultiplier !== 1 && !isPlaybackEcoMode)
  }, [effectiveRate, tempoMultiplier, isPlaybackEcoMode, isSpeedEnabled, playbackRate])

  useEffect(() => {
    engineRef.current.setMasterVolume(masterVolume)
  }, [masterVolume])

  useEffect(() => {
    engineRef.current.setLowPassEnabled(isLowPassEnabled)
  }, [isLowPassEnabled])

  useEffect(() => {
    engineRef.current.setLowPassClipGuard(isReduceClippingEnabled)
  }, [isReduceClippingEnabled])

  useEffect(() => {
    engineRef.current.setLowPassFrequency(lowPassFrequency)
  }, [lowPassFrequency])

  useEffect(() => {
    engineRef.current.setLowPassQ(lowPassQ)
  }, [lowPassQ])

  useEffect(() => {
    engineRef.current.setPhaserEnabled(isPhaserEnabled)
  }, [isPhaserEnabled])

  useEffect(() => {
    engineRef.current.setPhaserParams({
      phaserMinFreq,
      phaserMaxFreq,
      phaserRate,
      phaserDepth,
      phaserFeedback,
    })
  }, [phaserMinFreq, phaserMaxFreq, phaserRate, phaserDepth, phaserFeedback])

  function addToQueue(track: JellyfinAudioItem): void {
    setQueue((prev: JellyfinAudioItem[]) => [...prev, track])
    setStatus(`Added to queue: ${track.Name}`)
  }

  function removeFromQueue(index: number): void {
    setQueue((prev: JellyfinAudioItem[]) => prev.filter((_, i) => i !== index))
  }

  function handleSeek(delta: number): void {
    const audio = audioRef.current
    if (!audio) return
    const newTime = Math.min(audio.duration, Math.max(0, audio.currentTime + delta))
    audio.currentTime = newTime
    setCurrentTime(newTime)
  }

  async function handleRestartOrPrev(): Promise<void> {
    const audio = audioRef.current
    if (!audio) return

    if (audio.currentTime > 3) {
      audio.currentTime = 0
      setCurrentTime(0)
    } else {
      await handlePrevTrack()
    }
  }

  async function playNextInQueue(): Promise<void> {
    if (queue.length === 0) {
      await handleNextTrack()
      return
    }

    const nextTrack = queue[0]
    setQueue((prev: JellyfinAudioItem[]) => prev.slice(1))
    await handleSelectTrack(nextTrack)
  }


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
    cachedTrackInfoRef.current = {}
    cacheOrderRef.current = []
    setCachedTracks([])
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

    const currentSearchId = ++lastSearchIdRef.current
    setIsLoadingTracks(true)

    try {
      const response = await fetchAudioLibrary(
        serverUrl,
        activeUserId,
        activeToken,
        query,
        fetchOptions,
      )

      if (currentSearchId !== lastSearchIdRef.current) {
        return
      }

      const items = query.trim() ? response.items : shuffleItems(response.items)
      setTracks(items)
      setTotalTrackCount(response.totalRecordCount)
      setStatus(
        query.trim()
          ? `Found ${items.length} matches for "${query}".`
          : `Loaded ${items.length} tracks from Jellyfin.`,
      )
      setSelectedTrack((prev: JellyfinAudioItem | null) => {
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
      const message = (error as Error).message || ''
      const shouldRetryAuth =
        query.trim().length > 0 &&
        message.includes('404') &&
        username.trim().length > 0 &&
        password.trim().length > 0 &&
        !authOverride

      if (shouldRetryAuth) {
        try {
          setStatus('Search endpoint returned 404. Re-authenticating and retrying...')
          const refreshed = await authenticate(serverUrl, username, password)
          setToken(refreshed.AccessToken)
          setUserId(refreshed.User.Id)
          await loadTracks(query, {
            token: refreshed.AccessToken,
            userId: refreshed.User.Id,
          }, fetchOptions)
          return
        } catch (retryError) {
          setStatus(`Re-auth failed after 404: ${(retryError as Error).message}`)
          return
        }
      }

      if (currentSearchId === lastSearchIdRef.current) {
        setStatus(`Failed to load tracks: ${(error as Error).message}`)
      }
    } finally {
      if (currentSearchId === lastSearchIdRef.current) {
        setIsLoadingTracks(false)
      }
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
    setQueue([])
    setSelectedTrack(null)
    setRandomTargetId(null)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setScrubberPeaks([])
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('jellyfindsp.queue')
    localStorage.removeItem('jellyfindsp.queueServerUrl')
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

    const sid = Math.random().toString(36).substring(2, 10)
    const streamUrl = buildStreamUrl(serverUrl, track.Id, token, userId, transcodingOptions, sid)
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

    if (cachingMode !== 'none' && !bufferedTrackUrlCacheRef.current[track.Id]) {
      setStatus(`Buffering ${track.Name}...`)
      try {
        await ensureTrackBuffered(track.Id)
      } catch {
        // Fall back to stream URL if full buffering fails.
      }
    }

    const bufferedUrl = bufferedTrackUrlCacheRef.current[track.Id]

    audio.crossOrigin = 'anonymous'
    audio.setAttribute('playsinline', 'true')
    audio.src = bufferedUrl ?? streamUrl
    audio.load()
    if (isPlaybackEcoMode && isSpeedEnabled) {
      audio.playbackRate = playbackRate
      applyPreservePitch(audio, false)
    } else {
      audio.playbackRate = effectiveRate
      applyPreservePitch(audio, tempoMultiplier !== 1 && !isPlaybackEcoMode)
    }

    await engineRef.current.setupForElement(audio, {
      lowPassFrequency,
      lowPassQ,
      lowPassEnabled: isLowPassEnabled,
      lowPassClipGuardEnabled: isReduceClippingEnabled,
      masterVolume,
      phaserEnabled: isPhaserEnabled,
      phaserMinFreq,
      phaserMaxFreq,
      phaserRate,
      phaserDepth,
      phaserFeedback,
    })


    try {
      await engineRef.current.resume()
      await audio.play()
      setIsPlaying(true)
      if (!playedTrackIdsRef.current.has(track.Id)) {
        playedTrackIdsRef.current.add(track.Id)
        setSessionSongsPlayed((prev) => prev + 1)
        setTotalSongsPlayed((prev) => {
          const next = prev + 1
          totalSongsPlayedRef.current = next
          return next
        })
      }
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
    if (queue.length > 0) {
      await playNextInQueue()
      return
    }

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
    if (queue.length > 0) {
      await playNextInQueue()
      return
    }

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

  function scrubFromPointer(event: ReactMouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): void {
    if (!selectedTrack || duration <= 0) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) {
      return
    }

    let clientX = 0
    if ('touches' in event) {
      clientX = event.touches[0].clientX
    } else {
      clientX = (event as ReactMouseEvent).clientX
    }

    const offsetX = clientX - rect.left
    const peaks = scrubberPeaks.length ? scrubberPeaks : new Array(160).fill(0.18)
    const barCount = peaks.length
    const barGap = 1
    const barWidth = Math.max(1, rect.width / barCount - barGap)
    const renderedWidth = barCount * (barWidth + barGap) - barGap
    const ratio = Math.min(1, Math.max(0, offsetX / Math.max(1, renderedWidth)))
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

  useLayoutEffect(() => {
    const left = leftPanelRef.current
    const right = rightPanelRef.current
    if (!left || !right) {
      return
    }

    const syncRightMaxHeight = () => {
      const nextHeight = Math.ceil(left.getBoundingClientRect().height)
      if (nextHeight > 0) {
        right.style.maxHeight = `${nextHeight}px`
      }
    }

    syncRightMaxHeight()

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        syncRightMaxHeight()
      })
      observer.observe(left)
    }

    window.addEventListener('resize', syncRightMaxHeight)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', syncRightMaxHeight)
    }
  }, [])

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
        backgroundCtx.strokeStyle = 'rgba(215, 235, 255, 0.45)'
        backgroundCtx.lineWidth = isFullscreenActive ? 1.75 : 1.35
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
  }, [isFullscreenActive])

  useEffect(() => {
    const volumeHideBreakpoint = 1160

    const syncVolumeVisibility = () => {
      const shouldHideVolume = window.innerWidth <= volumeHideBreakpoint
      setIsVolumeHidden(shouldHideVolume)

      if (shouldHideVolume) {
        setMasterVolume(1)
      }
    }

    window.addEventListener('resize', syncVolumeVisibility)
    syncVolumeVisibility()

    return () => window.removeEventListener('resize', syncVolumeVisibility)
  }, [])

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreenActive(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', syncFullscreenState)
    syncFullscreenState()

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState)
    }
  }, [])

  useEffect(() => {
    if (isFullscreenActive) {
      document.body.classList.add('is-fullscreen')
    } else {
      document.body.classList.remove('is-fullscreen')
    }
    return () => document.body.classList.remove('is-fullscreen')
  }, [isFullscreenActive])

  useEffect(() => {
    if (serverUrl) {
      localStorage.setItem('jellyfindsp.queue', JSON.stringify(queue))
      localStorage.setItem('jellyfindsp.queueServerUrl', serverUrl)
    }
  }, [queue, serverUrl])

  useEffect(() => {
    const settings = {
      masterVolume,
      isSpeedEnabled,
      speedPercent,
      isPlaybackEcoMode,
      adjustPitch,
      isLowPassEnabled,
      isReduceClippingEnabled,
      lowPassFrequency,
      lowPassQ,
      isPhaserEnabled,
      phaserMinFreq,
      phaserMaxFreq,
      phaserRate,
      phaserDepth,
      phaserFeedback,
      isSpeedExpanded,
      isLowPassExpanded,
      isQueueExpanded,
      isStatsExpanded,
      isTranscodingEnabled,
      transcodeBitrateKbps,
      transcodeContainer,
      transcodeProtocol,
      transcodeChannels,
      cachingMode,
      cacheLimitMb,
      isCacheLimitTextOnly,
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [
    masterVolume,
    isSpeedEnabled,
    speedPercent,
    isPlaybackEcoMode,
    adjustPitch,
    isLowPassEnabled,
    isReduceClippingEnabled,
    lowPassFrequency,
    lowPassQ,
    isPhaserEnabled,
    phaserMinFreq,
    phaserMaxFreq,
    phaserRate,
    phaserDepth,
    phaserFeedback,
    isSpeedExpanded,
    isLowPassExpanded,
    isQueueExpanded,
    isStatsExpanded,
    isTranscodingEnabled,
    transcodeBitrateKbps,
    transcodeContainer,
    transcodeProtocol,
    transcodeChannels,
    cachingMode,
    cacheLimitMb,
    isCacheLimitTextOnly,
  ])

  useEffect(() => {
    persistStats(totalDataBytes, totalSongsPlayed)
  }, [totalDataBytes, totalSongsPlayed])

  useEffect(() => {
    pruneBufferedCache()
  }, [cacheLimitMb, cachingMode, queue, selectedTrack?.Id, randomTargetId])

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

    if (cachingMode === 'none') {
      clearPreloadCache()
      return
    }

    const currentIndex = tracks.findIndex((track) => track.Id === selectedTrack.Id)
    if (currentIndex < 0) {
      return
    }

    const keepIds = new Set<string>()
    const preloadTimer = window.setTimeout(() => {
      const enqueuePreload = (trackId: string) => {
        keepIds.add(trackId)
        if (!preloadAudioCacheRef.current[trackId]) {
          const preloadAudio = new Audio()
          preloadAudio.preload = 'auto'
          preloadAudio.src =
            bufferedTrackUrlCacheRef.current[trackId] ??
            buildStreamUrl(serverUrl, trackId, token, userId, transcodingOptions)
          preloadAudio.load()
          preloadAudioCacheRef.current[trackId] = preloadAudio
        }

        void ensureTrackBuffered(trackId)
        void ensureWaveformCached(trackId)
      }

      if (cachingMode === 'queue-nearby' || cachingMode === 'queue-nearby-random') {
        const track = tracks[currentIndex + 1]
        if (track) {
          enqueuePreload(track.Id)
        }
      }

      if (cachingMode === 'queue-nearby-random' && randomTargetId) {
        enqueuePreload(randomTargetId)
      }

      for (const queuedTrack of queue.slice(0, 6)) {
        enqueuePreload(queuedTrack.Id)
      }

      if (randomTargetId && cachingMode === 'queue-nearby-random') {
        keepIds.add(randomTargetId)
      }

      for (const [id, cachedAudio] of Object.entries(preloadAudioCacheRef.current)) {
        if (keepIds.has(id) || !cachedAudio) {
          continue
        }
        cachedAudio.pause()
        cachedAudio.removeAttribute('src')
        delete preloadAudioCacheRef.current[id]
      }
    }, 1000)

    return () => window.clearTimeout(preloadTimer)
  }, [selectedTrack?.Id, randomTargetId, tracks, queue, serverUrl, token, userId, transcodingOptions, cachingMode])

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

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return
    }

    const mediaSession = navigator.mediaSession

    if (selectedTrack) {
      mediaSession.metadata = new MediaMetadata({
        title: selectedTrack.Name,
        artist: selectedTrack.Artists?.join(', ') || 'Unknown artist',
        album: selectedTrack.Album || 'Jellyfin Library',
        artwork: [
          {
            src: buildImageUrl(serverUrl, selectedTrack.Id, token),
            sizes: '512x512',
            type: 'image/jpeg',
          },
        ],
      })
    }

    mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    mediaSession.setActionHandler('play', () => {
      void togglePlayback()
    })
    mediaSession.setActionHandler('pause', () => {
      void togglePlayback()
    })
    mediaSession.setActionHandler('previoustrack', () => {
      void handleRestartOrPrev()
    })
    mediaSession.setActionHandler('nexttrack', () => {
      void handleNextTrack()
    })
    mediaSession.setActionHandler('seekbackward', () => handleSeek(-10))
    mediaSession.setActionHandler('seekforward', () => handleSeek(10))
    mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        handleScrub(details.seekTime)
      }
    })

    return () => {
      mediaSession.setActionHandler('play', null)
      mediaSession.setActionHandler('pause', null)
      mediaSession.setActionHandler('previoustrack', null)
      mediaSession.setActionHandler('nexttrack', null)
      mediaSession.setActionHandler('seekbackward', null)
      mediaSession.setActionHandler('seekforward', null)
      mediaSession.setActionHandler('seekto', null)
    }
  }, [selectedTrack, isPlaying, currentTime, duration, serverUrl, token])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isPlaying) {
        void engineRef.current.resume()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isPlaying])

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

  async function toggleFullscreenMode(): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        const element = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void> | void
        }

        if (element.requestFullscreen) {
          await element.requestFullscreen()
        } else if (element.webkitRequestFullscreen) {
          await element.webkitRequestFullscreen()
        } else {
          setIsFullscreenActive(true)
        }
      } else {
        const doc = document as Document & {
          webkitExitFullscreen?: () => Promise<void> | void
        }

        if (doc.exitFullscreen) {
          await doc.exitFullscreen()
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen()
        } else {
          setIsFullscreenActive(false)
        }
      }
    } catch (error) {
      setStatus(`Fullscreen failed: ${(error as Error).message}`)
    }
  }

  const trackCards = useMemo(() => {
    const filtered = tracks.filter((track) => {
      const term = search.toLowerCase().trim()
      if (!term) {
        return true
      }

      const matchName = track.Name.toLowerCase().includes(term)
      const matchAlbum = track.Album?.toLowerCase().includes(term)
      const matchArtist = track.Artists?.some((a) => a.toLowerCase().includes(term))

      return matchName || matchAlbum || matchArtist
    })

    return filtered.map((track) => {
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
          <div className="track-actions">
            <button
              type="button"
              className="add-queue-btn"
              onClick={(e) => {
                e.stopPropagation()
                addToQueue(track)
              }}
              title="Add to queue"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <a
              href={buildWebUrl(serverUrl, track.Id, track.ServerId)}
              target="_blank"
              rel="noreferrer"
              className="jellyfin-link"
              onClick={(e) => e.stopPropagation()}
              title="Open in Jellyfin"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        </motion.button>
      )
    })
  }, [tracks, selectedTrack?.Id, serverUrl, token, search])

  return (
    <>
      <canvas 
        ref={backgroundWaveformRef} 
        className={`global-background-waveform ${isFullscreenActive ? 'fullscreen-mode' : ''}`} 
      />
      <main className={`shell ${isFullscreenActive ? 'fullscreen-hidden' : ''}`}>
        <section className="panel left-panel" ref={leftPanelRef}>
          <h1>JellyfinDSP</h1>

          <p className="status">{status}</p>

          <details className="auth-section">
            <summary>Jellyfin + Data Settings</summary>
            <div className="control-card login-mod">
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
            </div>

            <div className="connection-mods">
              <div className="control-card">
                <div className={`menu-head ${isTranscodingExpanded ? 'expanded' : ''}`}>
                  <h2 onClick={() => setIsTranscodingExpanded((prev: boolean) => !prev)}>Transcoding</h2>
                  <div className="menu-actions">
                    <button
                      type="button"
                      className="reset-btn"
                      onClick={() => {
                        setTranscodeBitrateKbps(192)
                        setTranscodeContainer('mp3')
                        setTranscodeProtocol('http')
                        setTranscodeChannels(2)
                      }}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className={isTranscodingEnabled ? '' : 'off-btn'}
                      onClick={() => setIsTranscodingEnabled((prev: boolean) => !prev)}
                    >
                      {isTranscodingEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {isTranscodingExpanded && (
                    <motion.div
                      className="menu-content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      <label>
                        <div className="label-header">
                          <span>Max bitrate (kbps)</span>
                          <input
                            type="number"
                            className="param-input"
                            min="4"
                            max="320"
                            step="4"
                            value={transcodeBitrateKbps}
                            onChange={(event) => setTranscodeBitrateKbps(Math.max(4, Math.min(320, Number(event.target.value))))}
                          />
                        </div>
                        <input
                          type="range"
                          min={4}
                          max={320}
                          step={4}
                          value={transcodeBitrateKbps}
                          onChange={(event) => setTranscodeBitrateKbps(Number(event.target.value))}
                        />
                      </label>

                      <label>
                        Container
                        <select
                          value={transcodeContainer}
                          onChange={(event) => setTranscodeContainer(event.target.value as 'mp3' | 'aac' | 'opus')}
                        >
                          <option value="mp3">MP3</option>
                          <option value="aac">AAC</option>
                          <option value="opus">Opus</option>
                        </select>
                      </label>

                      <label>
                        Protocol
                        <select
                          value={transcodeProtocol}
                          onChange={(event) => setTranscodeProtocol(event.target.value as 'http' | 'hls')}
                        >
                          <option value="http">HTTP</option>
                          <option value="hls">HLS</option>
                        </select>
                      </label>

                      <label>
                        Channels
                        <select
                          value={transcodeChannels}
                          onChange={(event) => setTranscodeChannels(Number(event.target.value) as 1 | 2)}
                        >
                          <option value={1}>Mono</option>
                          <option value={2}>Stereo</option>
                        </select>
                      </label>

                      <p className="subhead" style={{ marginTop: 0 }}>
                        Session streamed data: {formatBytes(sessionDataBytes)}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="control-card">
                <div className={`menu-head ${isCachingExpanded ? 'expanded' : ''}`}>
                  <h2 onClick={() => setIsCachingExpanded((prev: boolean) => !prev)}>Caching</h2>
                </div>

                <AnimatePresence>
                  {isCachingExpanded && (
                    <motion.div
                      className="menu-content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      <label>
                        Strategy
                        <select
                          value={cachingMode}
                          onChange={(event) => setCachingMode(event.target.value as CacheMode)}
                        >
                          <option value="queue-nearby-random">Queue + Nearby + Random</option>
                          <option value="queue-nearby">Queue + Nearby</option>
                          <option value="queue-only">Queue Only</option>
                          <option value="none">None</option>
                        </select>
                      </label>

                      <label className="inline-switch">
                        <input
                          type="checkbox"
                          checked={isCacheLimitTextOnly}
                          onChange={(event) => setIsCacheLimitTextOnly(event.target.checked)}
                        />
                        Text-only cache limit editor
                      </label>

                      <label>
                        Cache limit (MB)
                        <input
                          type="number"
                          className="param-input"
                          min={64}
                          max={128000}
                          step={64}
                          value={Math.round(cacheLimitMb)}
                          onChange={(event) => setCacheLimitMb(Math.max(64, Number(event.target.value) || 4096))}
                        />
                      </label>

                      {!isCacheLimitTextOnly && (
                        <input
                          type="range"
                          min={64}
                          max={128000}
                          step={64}
                          value={cacheLimitMb}
                          onChange={(event) => setCacheLimitMb(Number(event.target.value))}
                        />
                      )}

                      <p className="subhead" style={{ marginTop: 0 }}>
                        Cached songs: {cachedTracks.length} ({formatBytes(cachedTracks.reduce((sum, item) => sum + item.bytes, 0))})
                      </p>

                      {cachedTracks.length === 0 ? (
                        <div className="empty-state">No tracks cached in this session.</div>
                      ) : (
                        <div className="queue-list">
                          {cachedTracks.map((cached) => (
                            <div key={cached.id} className="queue-item">
                              <div className="info">
                                <div className="name">{cached.name}</div>
                              </div>
                              <span className="track-time">{formatBytes(cached.bytes)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="control-card">
                <div className={`menu-head ${isStatsExpanded ? 'expanded' : ''}`}>
                  <h2 onClick={() => setIsStatsExpanded((prev: boolean) => !prev)}>Stats</h2>
                </div>

                <AnimatePresence>
                  {isStatsExpanded && (
                    <motion.div
                      className="menu-content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      <p className="subhead">Data Streamed (Total): {formatBytes(totalDataBytes)}</p>
                      <p className="subhead">Data Streamed (Session): {formatBytes(sessionDataBytes)}</p>
                      <p className="subhead">Songs Played: {totalSongsPlayed} total / {sessionSongsPlayed} session</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </details>

          <div className="control-card">
            <div className="queue-panel" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
              <div className={`menu-head ${isQueueExpanded ? 'expanded' : ''}`}>
                <h2 onClick={() => setIsQueueExpanded((prev: boolean) => !prev)}>
                  Queue {queue.length > 0 ? `(${queue.length})` : ''}
                </h2>
              </div>

              <AnimatePresence>
                {isQueueExpanded && (
                  <motion.div
                    className="menu-content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                  >
                    {queue.length === 0 ? (
                      <div className="empty-state">Nothing in Queue</div>
                    ) : (
                      <div className="queue-list">
                        {queue.map((track, i) => (
                          <div
                            key={`${track.Id}-${i}`}
                            className="queue-item"
                            draggable
                            onDragStart={(e) => {
                              draggedItemRef.current = i
                              e.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragOver={(e) => {
                              e.preventDefault()
                              e.dataTransfer.dropEffect = 'move'
                            }}
                            onDrop={(e) => {
                              e.preventDefault()
                              const draggedIndex = draggedItemRef.current
                              if (draggedIndex === null || draggedIndex === i) return
                              setQueue((prev: JellyfinAudioItem[]) => {
                                const newQueue = [...prev]
                                const draggedItem = newQueue[draggedIndex]
                                newQueue.splice(draggedIndex, 1)
                                newQueue.splice(i, 0, draggedItem)
                                return newQueue
                              })
                              draggedItemRef.current = null
                            }}
                          >
                            <div className="drag-handle" style={{ cursor: 'grab', opacity: 0.5, padding: '0 4px' }}>
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <circle cx="9" cy="6" r="1.5"></circle>
                                <circle cx="15" cy="6" r="1.5"></circle>
                                <circle cx="9" cy="12" r="1.5"></circle>
                                <circle cx="15" cy="12" r="1.5"></circle>
                                <circle cx="9" cy="18" r="1.5"></circle>
                                <circle cx="15" cy="18" r="1.5"></circle>
                              </svg>
                            </div>
                            <img src={buildImageUrl(serverUrl, track.Id, token)} alt="" />
                            <div className="info">
                              <div className="name">{track.Name}</div>
                            </div>
                            <button
                              type="button"
                              className="remove-btn"
                              onClick={() => removeFromQueue(i)}
                            >
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="control-card">
            <div className={`menu-head ${isSpeedExpanded ? 'expanded' : ''}`}>
              <h2 onClick={() => setIsSpeedExpanded((prev: boolean) => !prev)}>Speed</h2>
              <div className="menu-actions">
                <button
                  type="button"
                  className="reset-btn"
                  onClick={() => {
                    setSpeedPercent(80)
                    setAdjustPitch(true)
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className={isSpeedEnabled ? '' : 'off-btn'}
                  onClick={() => setIsSpeedEnabled((prev: boolean) => !prev)}
                >
                  {isSpeedEnabled ? 'On' : 'Off'}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {isSpeedExpanded && (
                <motion.div
                  className="menu-content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: '1rem', marginBottom: '0.5rem' }}>
                    <div style={{ flex: '0 0 33%', display: 'flex', alignItems: 'center' }}>
                      <Knob
                        label="Speed %"
                        value={speedPercent / 100}
                        min={0.6}
                        max={1.6}
                        step={0.01}
                        onChange={(val) => setSpeedPercent(val * 100)}
                        onReset={() => setSpeedPercent(100)}
                      />
                    </div>

                    <div style={{ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
                      <label className="inline-switch">
                        <input
                          type="checkbox"
                          checked={adjustPitch}
                          onChange={(event) => setAdjustPitch(event.target.checked)}
                        />
                        Adjust Pitch
                      </label>

                      <label className="inline-switch">
                        <input
                          type="checkbox"
                          checked={isPlaybackEcoMode}
                          onChange={(event) => setIsPlaybackEcoMode(event.target.checked)}
                        />
                        Performance Saver
                      </label>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="control-card">
            <div className={`menu-head ${isLowPassExpanded ? 'expanded' : ''}`}>
              <h2 onClick={() => setIsLowPassExpanded((prev: boolean) => !prev)}>Low Pass</h2>
              <div className="menu-actions">
                <button
                  type="button"
                  className="reset-btn"
                  onClick={() => {
                    setLowPassFrequency(55)
                    setLowPassQ(0.80)
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className={isLowPassEnabled ? '' : 'off-btn'}
                  onClick={() => setIsLowPassEnabled((prev: boolean) => !prev)}
                >
                  {isLowPassEnabled ? 'On' : 'Off'}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {isLowPassExpanded && (
                <motion.div
                  className="menu-content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <div className="range-slider-container low-pass-cutoff-slider">
                    <div className="range-slider-header">
                      <span className="range-slider-label">Low-pass Cutoff (Hz)</span>
                      <div className="range-slider-values">
                        <input
                          type="number"
                          className="param-input"
                          min="10"
                          max="10000"
                          value={Math.round(lowPassFrequency)}
                          onChange={(e) => setLowPassFrequency(Math.max(10, Math.min(10000, Number(e.target.value))))}
                        />
                      </div>
                    </div>
                    <div className="range-slider-wrap">
                      <input
                        type="range"
                        min={10}
                        max={10000}
                        step={1}
                        value={lowPassFrequency}
                        onChange={(event) => setLowPassFrequency(Number(event.target.value))}
                        className="thumb thumb--single"
                      />
                      <div className="slider">
                        <div className="slider__track" />
                        <div
                          className="slider__range"
                          style={{ left: 0, width: `${lowPassSliderPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ flex: '0 0 33%', display: 'flex', alignItems: 'center' }}>
                      <Knob
                        label="Q / Resonance"
                        value={lowPassQ}
                        min={0.01}
                        max={5}
                        step={0.01}
                        onChange={(val) => setLowPassQ(val)}
                        onReset={() => setLowPassQ(0.80)}
                      />
                    </div>

                    <div style={{ flex: '1', display: 'flex', alignItems: 'center' }}>
                      <label className="inline-switch">
                        <input
                          type="checkbox"
                          checked={isReduceClippingEnabled}
                          onChange={(event) => setIsReduceClippingEnabled(event.target.checked)}
                        />
                        Reduce Clipping
                      </label>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="control-card">
            <div className={`menu-head ${isPhaserExpanded ? 'expanded' : ''}`}>
              <h2 onClick={() => setIsPhaserExpanded((prev: boolean) => !prev)}>Phase Shifter</h2>
              <div className="menu-actions">
                <button
                  type="button"
                  className="reset-btn"
                  onClick={() => {
                    setPhaserMinFreq(440)
                    setPhaserMaxFreq(1600)
                    setPhaserRate(0.5)
                    setPhaserDepth(1.0)
                    setPhaserFeedback(0.7)
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className={isPhaserEnabled ? '' : 'off-btn'}
                  onClick={() => setIsPhaserEnabled((prev: boolean) => !prev)}
                >
                  {isPhaserEnabled ? 'On' : 'Off'}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {isPhaserExpanded && (
                <motion.div
                  className="menu-content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <RangeSlider
                    label="Frequency Range (Hz)"
                    min={10}
                    max={20000}
                    minVal={phaserMinFreq}
                    maxVal={phaserMaxFreq}
                    onChange={(vals) => {
                      setPhaserMinFreq(vals.min);
                      setPhaserMaxFreq(vals.max);
                    }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', marginTop: '1rem' }}>
                    <Knob
                      label="Rate"
                      value={phaserRate}
                      min={0}
                      max={10}
                      step={0.1}
                      onChange={(val) => setPhaserRate(val)}
                      onReset={() => setPhaserRate(0.5)}
                    />
                    <Knob
                      label="Depth %"
                      value={phaserDepth}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(val) => setPhaserDepth(val)}
                      onReset={() => setPhaserDepth(1.0)}
                    />
                    <Knob
                      label="Feedback %"
                      value={phaserFeedback}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(val) => setPhaserFeedback(val)}
                      onReset={() => setPhaserFeedback(0.7)}
                    />
                  </div>

                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        <section className="panel right-panel" ref={rightPanelRef}>
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
              onTouchStart={(event) => {
                event.preventDefault()
                scrubFromPointer(event)
              }}
              onTouchMove={(event) => {
                event.preventDefault()
                scrubFromPointer(event)
              }}
              onMouseMove={(event) => {
                if (event.buttons === 1) {
                  scrubFromPointer(event)
                }
              }}
            />
          </div>

          <header className="library-head">
            <h2>Library</h2>
            <div className="library-actions">
              <button
                type="button"
                className="ghost nav-btn"
                onClick={() => {
                  void handleShuffleView()
                }}
                disabled={!isAuthenticated || totalTrackCount === 0}
              >
                Shuffle
              </button>
              <button
                type="button"
                className="ghost nav-btn"
                onClick={() => {
                  void handleRandomJump()
                }}
                disabled={!selectedTrack || tracks.length < 2}
              >
                Random
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

      <aside className="bottom-player-bar">
        <div className="player-bar-content">
          <div className="player-left">
            {selectedTrack && (
              <>
                <img 
                  src={buildImageUrl(serverUrl, selectedTrack.Id, token)} 
                  alt="" 
                  className="player-album-art"
                />
                <div className="player-meta">
                  <div className="player-track-name">{selectedTrack.Name}</div>
                  <div className="player-artist-name">{selectedTrack.Artists?.join(', ') || selectedTrack.Album || 'Unknown artist'}</div>
                  <div className="time-display">
                    {formatDuration(currentTime * 1000)} / {formatDuration(duration * 1000)}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="player-center">
            <Transport 
              isPlaying={isPlaying}
              onTogglePlay={() => { void togglePlayback() }}
              onSeek={handleSeek}
              onNext={() => { void handleNextTrack() }}
              onPrev={() => { void handleRestartOrPrev() }}
              disabled={!selectedTrack}
            />
          </div>

          <div className="player-right">
            {!isVolumeHidden && (
              <div className="player-volume">
                <Knob
                  label="Volume"
                  value={masterVolume}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(val) => setMasterVolume(val)}
                />
              </div>
            )}
            <FullscreenButton
              isActive={isFullscreenActive}
              onToggle={() => { void toggleFullscreenMode() }}
              className="playbar-fullscreen-btn"
            />
          </div>
        </div>
      </aside>
    </>
  )
}

export default App
