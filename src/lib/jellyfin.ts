export type JellyfinUser = {
  Id: string
  Name: string
  ServerId?: string
}

export type JellyfinAuthResult = {
  AccessToken: string
  User: JellyfinUser
  ServerId?: string
}

export type JellyfinAudioItem = {
  Id: string
  Name: string
  Album?: string
  Artists?: string[]
  RunTimeTicks?: number
  ServerId?: string
  Type?: string
}

type JellyfinItemsResponse = {
  Items: JellyfinAudioItem[]
  TotalRecordCount: number
}

export type JellyfinAudioLibraryPage = {
  items: JellyfinAudioItem[]
  totalRecordCount: number
}

export type FetchAudioLibraryOptions = {
  startIndex?: number
  limit?: number
}

export type JellyfinTranscodingOptions = {
  maxStreamingBitrate?: number
  container?: string
  audioCodec?: string
  transcodingProtocol?: 'http' | 'hls'
  audioChannels?: number
}

export type QuickConnectResult = {
  Authenticated: boolean
  Secret: string
  Code: string
  DeviceId?: string
  DeviceName?: string
  AppName?: string
  AppVersion?: string
  DateAdded?: string
}

const APP_CLIENT = 'JellyfinDSP'
const APP_DEVICE = 'JellyfinDSP Web'
const APP_VERSION = '0.2.0'
const DEVICE_ID_KEY = 'jellyfindsp.deviceId'

export class JellyfinApiError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, message: string, url: string) {
    super(message)
    this.name = 'JellyfinApiError'
    this.status = status
    this.url = url
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

let cachedDeviceId: string | null = null

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `jellyfindsp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Jellyfin 12 keys sessions by device. A stable, per-browser device id avoids
 * sessions fighting over a shared hard-coded id.
 */
export function getDeviceId(): string {
  if (cachedDeviceId) {
    return cachedDeviceId
  }

  try {
    const saved = localStorage.getItem(DEVICE_ID_KEY)
    if (saved) {
      cachedDeviceId = saved
      return saved
    }

    const created = createDeviceId()
    localStorage.setItem(DEVICE_ID_KEY, created)
    cachedDeviceId = created
    return created
  } catch {
    cachedDeviceId = createDeviceId()
    return cachedDeviceId
  }
}

export function normalizeServerUrl(serverUrl: string): string {
  let value = serverUrl.trim()

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`
  }

  return value.replace(/\/+$/, '')
}

/**
 * Builds the modern Jellyfin authorization header. Jellyfin 10.9+ only reads the
 * device info and token from this header unless EnableLegacyAuthorization is on,
 * and the values are percent-decoded by the server.
 */
export function authHeader(token?: string): string {
  const parts = [
    `Client="${encodeURIComponent(APP_CLIENT)}"`,
    `Device="${encodeURIComponent(APP_DEVICE)}"`,
    `DeviceId="${encodeURIComponent(getDeviceId())}"`,
    `Version="${encodeURIComponent(APP_VERSION)}"`,
  ]

  if (token) {
    parts.push(`Token="${encodeURIComponent(token)}"`)
  }

  return `MediaBrowser ${parts.join(', ')}`
}

export function authHeaders(token?: string): HeadersInit {
  return {
    Authorization: authHeader(token),
    Accept: 'application/json',
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = response.statusText || `Request failed (${response.status})`

  try {
    const text = await response.text()
    if (!text) {
      return fallback
    }

    try {
      const parsed = JSON.parse(text) as {
        title?: string
        detail?: string
        message?: string
      }
      return parsed.detail || parsed.message || parsed.title || fallback
    } catch {
      return text
    }
  } catch {
    return fallback
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)

  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw new JellyfinApiError(response.status, message, url)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

function withQuery(baseUrl: string, path: string, params: URLSearchParams): string {
  return `${baseUrl}${path}?${params.toString()}`
}

export async function authenticate(
  serverUrl: string,
  username: string,
  password: string,
): Promise<JellyfinAuthResult> {
  const baseUrl = normalizeServerUrl(serverUrl)

  try {
    return await requestJson<JellyfinAuthResult>(
      `${baseUrl}/Users/AuthenticateByName`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Username: username,
          Pw: password,
        }),
      },
    )
  } catch (error) {
    if (error instanceof JellyfinApiError && error.status === 401) {
      throw new JellyfinApiError(
        401,
        'Invalid username or password. If this account uses SSO or Quick Connect, use Quick Connect instead.',
        error.url,
      )
    }

    throw error
  }
}

export async function fetchCurrentUser(
  serverUrl: string,
  token: string,
): Promise<JellyfinUser> {
  const baseUrl = normalizeServerUrl(serverUrl)

  return requestJson<JellyfinUser>(`${baseUrl}/Users/Me`, {
    headers: authHeaders(token),
  })
}

export async function logoutSession(serverUrl: string, token: string): Promise<void> {
  const baseUrl = normalizeServerUrl(serverUrl)

  try {
    await fetch(`${baseUrl}/Sessions/Logout`, {
      method: 'POST',
      headers: authHeaders(token),
    })
  } catch {
    // Best effort: local state is cleared regardless.
  }
}

export async function isQuickConnectEnabled(serverUrl: string): Promise<boolean> {
  const baseUrl = normalizeServerUrl(serverUrl)

  try {
    return await requestJson<boolean>(`${baseUrl}/QuickConnect/Enabled`, {
      headers: authHeaders(),
    })
  } catch {
    return false
  }
}

export async function initiateQuickConnect(serverUrl: string): Promise<QuickConnectResult> {
  const baseUrl = normalizeServerUrl(serverUrl)

  return requestJson<QuickConnectResult>(`${baseUrl}/QuickConnect/Initiate`, {
    method: 'POST',
    headers: authHeaders(),
  })
}

export async function getQuickConnectState(
  serverUrl: string,
  secret: string,
): Promise<QuickConnectResult> {
  const baseUrl = normalizeServerUrl(serverUrl)
  const params = new URLSearchParams({ secret })

  return requestJson<QuickConnectResult>(
    withQuery(baseUrl, '/QuickConnect/Connect', params),
    { headers: authHeaders() },
  )
}

export async function authenticateWithQuickConnect(
  serverUrl: string,
  secret: string,
): Promise<JellyfinAuthResult> {
  const baseUrl = normalizeServerUrl(serverUrl)

  return requestJson<JellyfinAuthResult>(
    `${baseUrl}/Users/AuthenticateWithQuickConnect`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ Secret: secret }),
    },
  )
}

async function fetchItems(
  serverUrl: string,
  token: string,
  params: URLSearchParams,
): Promise<JellyfinItemsResponse> {
  const baseUrl = normalizeServerUrl(serverUrl)

  return requestJson<JellyfinItemsResponse>(
    withQuery(baseUrl, '/Items', params),
    { headers: authHeaders(token) },
  )
}

export async function fetchAudioLibrary(
  serverUrl: string,
  userId: string,
  token: string,
  searchTerm: string,
  options?: FetchAudioLibraryOptions,
): Promise<JellyfinAudioLibraryPage> {
  const startIndex = Math.max(0, Math.floor(options?.startIndex ?? 0))
  const limit = Math.max(1, Math.min(500, Math.floor(options?.limit ?? 220)))
  const commonFields = 'Path,RunTimeTicks,PrimaryImageAspectRatio,Artists,Album,ServerId'

  if (!searchTerm.trim()) {
    const params = new URLSearchParams({
      userId,
      Recursive: 'true',
      IncludeItemTypes: 'Audio',
      Fields: commonFields,
      Limit: String(limit),
      StartIndex: String(startIndex),
    })

    const response = await fetchItems(serverUrl, token, params)

    return {
      items: response.Items ?? [],
      totalRecordCount: response.TotalRecordCount ?? 0,
    }
  }

  // Search/Hints finds matches across titles, artists, and albums.
  const baseUrl = normalizeServerUrl(serverUrl)
  const hintParams = new URLSearchParams({
    searchTerm: searchTerm.trim(),
    includeItemTypes: 'Audio,MusicArtist,MusicAlbum',
    limit: '40',
    userId,
  })

  const hintsResponse = await requestJson<{ SearchHints: Array<{ Id: string; Type: string }> }>(
    withQuery(baseUrl, '/Search/Hints', hintParams),
    { headers: authHeaders(token) },
  )

  const hints = hintsResponse.SearchHints ?? []
  const directAudioIds = hints.filter((hint) => hint.Type === 'Audio').map((hint) => hint.Id)
  const artistIds = hints.filter((hint) => hint.Type === 'MusicArtist').map((hint) => hint.Id)
  const albumIds = hints.filter((hint) => hint.Type === 'MusicAlbum').map((hint) => hint.Id)

  const audioItems: JellyfinAudioItem[] = []
  const fetchTasks: Promise<void>[] = []

  if (directAudioIds.length > 0) {
    const params = new URLSearchParams({
      userId,
      ids: directAudioIds.join(','),
      Fields: commonFields,
    })

    fetchTasks.push(
      fetchItems(serverUrl, token, params).then((response) => {
        if (response.Items) {
          audioItems.push(...response.Items)
        }
      }),
    )
  }

  if (artistIds.length > 0 || albumIds.length > 0) {
    const params = new URLSearchParams({
      userId,
      Recursive: 'true',
      IncludeItemTypes: 'Audio',
      Fields: commonFields,
      Limit: '150',
    })

    if (artistIds.length > 0) params.set('artistIds', artistIds.join(','))
    if (albumIds.length > 0) params.set('albumIds', albumIds.join(','))

    fetchTasks.push(
      fetchItems(serverUrl, token, params).then((response) => {
        if (response.Items) {
          for (const item of response.Items) {
            if (!audioItems.some((existing) => existing.Id === item.Id)) {
              audioItems.push(item)
            }
          }
        }
      }),
    )
  }

  await Promise.all(fetchTasks)

  return {
    items: audioItems,
    totalRecordCount: audioItems.length,
  }
}

export function buildStreamUrl(
  serverUrl: string,
  itemId: string,
  token: string,
  userId: string,
  transcodingOptions?: JellyfinTranscodingOptions,
  playSessionId?: string,
): string {
  const baseUrl = normalizeServerUrl(serverUrl)

  if (transcodingOptions) {
    const bitrate = Math.max(16_000, Math.floor(transcodingOptions.maxStreamingBitrate || 320_000))
    const params = new URLSearchParams({
      UserId: userId,
      DeviceId: getDeviceId(),
      MaxStreamingBitrate: String(bitrate),
      Container: transcodingOptions.container || 'mp3',
      AudioCodec: transcodingOptions.audioCodec || transcodingOptions.container || 'mp3',
      TranscodingContainer: transcodingOptions.container || 'mp3',
      TranscodingProtocol: transcodingOptions.transcodingProtocol || 'http',
      AudioBitRate: String(bitrate),
      EnableAutoStreamCopy: 'false',
      EnableDirectPlay: 'false',
      EnableDirectStream: 'false',
      ApiKey: token,
    })

    if (transcodingOptions.audioChannels) {
      params.set('MaxAudioChannels', String(transcodingOptions.audioChannels))
      params.set('TranscodingAudioChannels', String(transcodingOptions.audioChannels))
    }

    if (playSessionId) {
      params.set('PlaySessionId', playSessionId)
    }

    return `${baseUrl}/Audio/${itemId}/universal?${params.toString()}`
  }

  const params = new URLSearchParams({
    Static: 'true',
    DeviceId: getDeviceId(),
    ApiKey: token,
  })

  if (playSessionId) {
    params.set('PlaySessionId', playSessionId)
  }

  return `${baseUrl}/Audio/${itemId}/stream?${params.toString()}`
}

export function buildImageUrl(
  serverUrl: string,
  itemId: string,
  token: string,
): string {
  const baseUrl = normalizeServerUrl(serverUrl)
  const params = new URLSearchParams({
    ApiKey: token,
    maxHeight: '280',
    maxWidth: '280',
  })

  return `${baseUrl}/Items/${itemId}/Images/Primary?${params.toString()}`
}

export function buildWebUrl(
  serverUrl: string,
  itemId: string,
  serverId?: string,
): string {
  const baseUrl = normalizeServerUrl(serverUrl)
  const params = new URLSearchParams({ id: itemId })

  if (serverId) {
    params.set('serverId', serverId)
  }

  return `${baseUrl}/web/#/details?${params.toString()}`
}

export function buildQuickConnectUrl(serverUrl: string): string {
  return `${normalizeServerUrl(serverUrl)}/web/#/quickconnect`
}

export function msFromTicks(ticks?: number): number {
  if (!ticks) {
    return 0
  }

  return Math.floor(ticks / 10_000)
}
