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

const APP_CLIENT = 'JellyfinDSP'
const APP_DEVICE = 'Web Browser'
const APP_DEVICE_ID = 'jellyfindsp-web'
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

  // Enhanced search: Search for Audio, MusicArtist, and MusicAlbum matching the term
  const searchParams = new URLSearchParams({
    Recursive: 'true',
    SearchTerm: searchTerm.trim(),
    IncludeItemTypes: 'Audio,MusicArtist,MusicAlbum',
    Fields: commonFields,
    Limit: '100', // Limit initial search results per type
  })

  const searchResults = await tryGetJson<JellyfinItemsResponse>(
    baseUrl,
    [`/Users/${userId}/Items?${searchParams.toString()}`, `/API/Users/${userId}/Items?${searchParams.toString()}`],
    token,
  )

  const audioItems = (searchResults.Items ?? []).filter((i) => i.Type === 'Audio')
  const artistIds = (searchResults.Items ?? []).filter((i) => i.Type === 'MusicArtist').map((i) => i.Id)
  const albumIds = (searchResults.Items ?? []).filter((i) => i.Type === 'MusicAlbum').map((i) => i.Id)

  // If we found artists or albums, fetch their tracks too
  if (artistIds.length > 0 || albumIds.length > 0) {
    const extraParams = new URLSearchParams({
      Recursive: 'true',
      IncludeItemTypes: 'Audio',
      Fields: commonFields,
      Limit: '200',
    })

    if (artistIds.length > 0) {
      extraParams.set('ArtistIds', artistIds.join(','))
    }
    if (albumIds.length > 0) {
      extraParams.set('AlbumIds', albumIds.join(','))
    }

    const extraResponse = await tryGetJson<JellyfinItemsResponse>(
      baseUrl,
      [`/Users/${userId}/Items?${extraParams.toString()}`, `/API/Users/${userId}/Items?${extraParams.toString()}`],
      token,
    )

    if (extraResponse.Items) {
      for (const item of extraResponse.Items) {
        if (!audioItems.some((existing) => existing.Id === item.Id)) {
          audioItems.push(item)
        }
      }
    }
  }

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
