export type JellyfinAuthResult = {
  AccessToken: string
  User: {
    Id: string
    Name: string
  }
}

export type JellyfinAudioItem = {
  Id: string
  Name: string
  Album?: string
  Artists?: string[]
  RunTimeTicks?: number
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

const APP_CLIENT = 'JellyfinOSU'
const APP_DEVICE = 'Web Browser'
const APP_DEVICE_ID = 'jellyfinosu-web'
const APP_VERSION = '0.1.0'

function cleanUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/$/, '')
}

function authHeader(token?: string): string {
  const tokenPart = token ? `, Token="${token}"` : ''
  return `MediaBrowser Client="${APP_CLIENT}", Device="${APP_DEVICE}", DeviceId="${APP_DEVICE_ID}", Version="${APP_VERSION}"${tokenPart}`
}

async function tryPostJson<T>(
  baseUrl: string,
  paths: string[],
  payload: unknown,
): Promise<T> {
  let lastError: unknown

  for (const path of paths) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': authHeader(),
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        lastError = new Error(`Auth failed (${response.status})`)
        continue
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed')
}

async function tryGetJson<T>(
  baseUrl: string,
  paths: string[],
  token: string,
): Promise<T> {
  let lastError: unknown

  for (const path of paths) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          'X-Emby-Token': token,
          'X-Emby-Authorization': authHeader(token),
        },
      })

      if (!response.ok) {
        lastError = new Error(`Request failed (${response.status})`)
        continue
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed')
}

export async function authenticate(
  serverUrl: string,
  username: string,
  password: string,
): Promise<JellyfinAuthResult> {
  const baseUrl = cleanUrl(serverUrl)

  return tryPostJson<JellyfinAuthResult>(
    baseUrl,
    ['/Users/AuthenticateByName', '/API/Users/AuthenticateByName'],
    {
      Username: username,
      Pw: password,
    },
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

  const baseUrl = cleanUrl(serverUrl)
  const params = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Audio',
    Limit: String(limit),
    StartIndex: String(startIndex),
    Fields: 'Path,RunTimeTicks,PrimaryImageAspectRatio,MediaSources',
  })

  if (searchTerm.trim()) {
    params.set('SearchTerm', searchTerm.trim())
  }

  const response = await tryGetJson<JellyfinItemsResponse>(
    baseUrl,
    [
      `/Users/${userId}/Items?${params.toString()}`,
      `/API/Users/${userId}/Items?${params.toString()}`,
    ],
    token,
  )

  return {
    items: response.Items ?? [],
    totalRecordCount: response.TotalRecordCount ?? 0,
  }
}

export function buildStreamUrl(
  serverUrl: string,
  itemId: string,
  token: string,
  userId: string,
): string {
  const baseUrl = cleanUrl(serverUrl)

  const params = new URLSearchParams({
    UserId: userId,
    DeviceId: APP_DEVICE_ID,
    MaxStreamingBitrate: '320000',
    Container: 'mp3',
    AudioCodec: 'mp3',
    TranscodingProtocol: 'http',
    api_key: token,
  })

  return `${baseUrl}/Audio/${itemId}/universal?${params.toString()}`
}

export function buildImageUrl(
  serverUrl: string,
  itemId: string,
  token: string,
): string {
  const baseUrl = cleanUrl(serverUrl)

  return `${baseUrl}/Items/${itemId}/Images/Primary?api_key=${encodeURIComponent(token)}&maxHeight=280&maxWidth=280`
}

export function msFromTicks(ticks?: number): number {
  if (!ticks) {
    return 0
  }

  return Math.floor(ticks / 10_000)
}
