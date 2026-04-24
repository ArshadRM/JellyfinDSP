import { animate, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
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
  const [selectedTrack, setSelectedTrack] = useState<JellyfinAudioItem | null>(null)
  const [playbackRate, setPlaybackRate] = useState(0.8)
  const [preservePitch, setPreservePitch] = useState(true)
  const [lowPassFrequency, setLowPassFrequency] = useState(4200)
  const [lowPassQ, setLowPassQ] = useState(1.2)
  const [isPlaying, setIsPlaying] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  const engineRef = useRef(new AudioEngine())

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
    const audio = audioRef.current
    if (!audio) {
      return
    }

    audio.playbackRate = playbackRate
    applyPreservePitch(audio, preservePitch)
  }, [playbackRate, preservePitch])

  useEffect(() => {
    engineRef.current.setLowPassFrequency(lowPassFrequency)
  }, [lowPassFrequency])

  useEffect(() => {
    engineRef.current.setLowPassQ(lowPassQ)
  }, [lowPassQ])

  useEffect(() => {
    return () => {
      engineRef.current.disconnect()
    }
  }, [])

  async function loadTracks(query = ''): Promise<void> {
    if (!isAuthenticated) {
      return
    }

    setIsLoadingTracks(true)

    try {
      const items = await fetchAudioLibrary(serverUrl, userId, token, query)
      setTracks(items)
      setStatus(`Loaded ${items.length} tracks from Jellyfin.`)
      if (!selectedTrack && items[0]) {
        setSelectedTrack(items[0])
      }
    } catch (error) {
      setStatus(`Failed to load tracks: ${(error as Error).message}`)
    } finally {
      setIsLoadingTracks(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadTracks(search)
    }, 260)

    return () => window.clearTimeout(timer)
  }, [search, isAuthenticated])

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setStatus('Authenticating against Jellyfin...')

    try {
      const result = await authenticate(serverUrl, username, password)
      setToken(result.AccessToken)
      setUserId(result.User.Id)
      setStatus(`Welcome ${result.User.Name}. Loading tracks...`)
      await loadTracks(search)
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
    setIsPlaying(false)
    localStorage.removeItem(STORAGE_KEY)

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

    const streamUrl = buildStreamUrl(serverUrl, track.Id, token)
    setSelectedTrack(track)

    audio.src = streamUrl
    audio.playbackRate = playbackRate
    applyPreservePitch(audio, preservePitch)

    engineRef.current.setupForElement(audio, {
      lowPassFrequency,
      lowPassQ,
    })

    try {
      await engineRef.current.resume()
      await audio.play()
      setIsPlaying(true)
      setStatus(`Now playing: ${track.Name}`)
    } catch {
      setStatus('Playback blocked until you interact with the page.')
    }
  }

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
          <h2>DSP</h2>

          <label>
            Speed ({playbackRate.toFixed(2)}x)
            <input
              type="range"
              min={0.6}
              max={0.99}
              step={0.01}
              value={playbackRate}
              onChange={(event) => setPlaybackRate(Number(event.target.value))}
            />
          </label>

          <label className="inline-switch">
            <input
              type="checkbox"
              checked={preservePitch}
              onChange={(event) => setPreservePitch(event.target.checked)}
            />
            Preserve pitch
          </label>

          <label>
            Low-pass cutoff ({Math.round(lowPassFrequency)} Hz)
            <input
              type="range"
              min={120}
              max={12000}
              step={10}
              value={lowPassFrequency}
              onChange={(event) => setLowPassFrequency(Number(event.target.value))}
            />
          </label>

          <label>
            Resonance / Q ({lowPassQ.toFixed(2)})
            <input
              type="range"
              min={0.2}
              max={12}
              step={0.1}
              value={lowPassQ}
              onChange={(event) => setLowPassQ(Number(event.target.value))}
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
      </section>

      <section className="panel right-panel">
        <header className="library-head">
          <h2>Library Carousel</h2>
          <input
            placeholder="Search tracks"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={!isAuthenticated}
          />
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
          controls
          className="native-player"
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />
      </section>
    </main>
  )
}

export default App
