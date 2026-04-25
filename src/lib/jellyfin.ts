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

const APP_CLIENT = 'JellyfinDSP'
const APP_DEVICE = 'Web Browser'
const APP_DEVICE_ID = 'jellyfindsp-web'
const APP_VERSION = '0.1.0'

function cleanUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/$/, '')
}

export function authHeader(token?: string): string {
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

  const commonFields = 'Path,RunTimeTicks,PrimaryImageAspectRatio,Artists,Album,ServerId'

  // If no search term, use simple recursive fetch
  if (!searchTerm.trim()) {
    const params = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: 'Audio',
      Fields: commonFields,
      Limit: String(limit),
      StartIndex: String(startIndex),
    })

    const response = await tryGetJson<JellyfinItemsResponse>(
      baseUrl,
      [`/Users/${userId}/Items?${params.toString()}`, `/API/Users/${userId}/Items?${params.toString()}`],
      token,
    )

    return {
      items: response.Items ?? [],
      totalRecordCount: response.TotalRecordCount ?? 0,
    }
  }

  // Enhanced search: Use Search/Hints to find any matching items across metadata
  const hintParams = new URLSearchParams({
    searchTerm: searchTerm.trim(),
    includeItemTypes: 'Audio,MusicArtist,MusicAlbum',
    limit: '40',
    userId: userId,
  })

  type Hint = { Id: string; Type: string }
  type HintsResponse = { SearchHints: Hint[] }

  const hintsResponse = await tryGetJson<HintsResponse>(
    baseUrl,
    [`/Search/Hints?${hintParams.toString()}`, `/API/Search/Hints?${hintParams.toString()}`],
    token,
  )

  const hints = hintsResponse.SearchHints ?? []
  const directAudioIds = hints.filter((h) => h.Type === 'Audio').map((h) => h.Id)
  const artistIds = hints.filter((h) => h.Type === 'MusicArtist').map((h) => h.Id)
  const albumIds = hints.filter((h) => h.Type === 'MusicAlbum').map((h) => h.Id)

  // Fetch the actual audio items for these hints
  const audioItems: JellyfinAudioItem[] = []
  const fetchTasks: Promise<void>[] = []

  // 1. Fetch direct audio matches (to get full metadata)
  if (directAudioIds.length > 0) {
    const params = new URLSearchParams({
      Ids: directAudioIds.join(','),
      Fields: commonFields,
    })
    fetchTasks.push(
      tryGetJson<JellyfinItemsResponse>(
        baseUrl,
        [`/Users/${userId}/Items?${params.toString()}`, `/API/Users/${userId}/Items?${params.toString()}`],
        token,
      ).then((res) => {
        if (res.Items) audioItems.push(...res.Items)
      }),
    )
  }

  // 2. Fetch tracks for matching artists/albums
  if (artistIds.length > 0 || albumIds.length > 0) {
    const params = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: 'Audio',
      Fields: commonFields,
      Limit: '150',
    })
    if (artistIds.length > 0) params.set('ArtistIds', artistIds.join(','))
    if (albumIds.length > 0) params.set('AlbumIds', albumIds.join(','))

    fetchTasks.push(
      tryGetJson<JellyfinItemsResponse>(
        baseUrl,
        [`/Users/${userId}/Items?${params.toString()}`, `/API/Users/${userId}/Items?${params.toString()}`],
        token,
      ).then((res) => {
        if (res.Items) {
          for (const item of res.Items) {
            if (!audioItems.some((e) => e.Id === item.Id)) {
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
  const baseUrl = cleanUrl(serverUrl)

  // If Transcoding is explicitly requested
  if (transcodingOptions) {
    const bitrate = Math.max(16_000, Math.floor(transcodingOptions.maxStreamingBitrate || 320_000))
    const params = new URLSearchParams({
      UserId: userId,
      DeviceId: APP_DEVICE_ID,
      MaxStreamingBitrate: String(bitrate),
      Container: transcodingOptions.container || 'mp3',
      AudioCodec: transcodingOptions.audioCodec || transcodingOptions.container || 'mp3',
      TranscodingContainer: transcodingOptions.container || 'mp3',
      TranscodingProtocol: transcodingOptions.transcodingProtocol || 'http',
      AudioBitRate: String(bitrate),
      EnableAutoStreamCopy: 'false',
      EnableDirectPlay: 'false',
      EnableDirectStream: 'false',
      api_key: token,
    })

    if (transcodingOptions.audioChannels) {
      params.set('AudioChannels', String(transcodingOptions.audioChannels))
    }

    if (playSessionId) {
      params.set('PlaySessionId', playSessionId)
    }

    return `${baseUrl}/Audio/${itemId}/universal?${params.toString()}`
  }

  // Direct play fallback (Transcoding OFF)
  const params = new URLSearchParams({
    Static: 'true',
    api_key: token,
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
  const baseUrl = cleanUrl(serverUrl)

  return `${baseUrl}/Items/${itemId}/Images/Primary?api_key=${encodeURIComponent(token)}&maxHeight=280&maxWidth=280`
}

export function buildWebUrl(
  serverUrl: string,
  itemId: string,
  serverId?: string,
): string {
  const baseUrl = cleanUrl(serverUrl)
  const serverPart = serverId ? `&serverId=${serverId}` : ''
  return `${baseUrl}/web/index.html#!/details?id=${itemId}${serverPart}`
}

export function msFromTicks(ticks?: number): number {
  if (!ticks) {
    return 0
  }

  return Math.floor(ticks / 10_000)
}
