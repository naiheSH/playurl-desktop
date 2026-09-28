export type Provider = 'all' | 'netease' | 'qq' | 'kugou' | 'qishui'

export type Song = Record<string, unknown> & {
  provider: Exclude<Provider, 'all'>
  id: string
  name: string
  artist: string
  album: string
  cover: string
  duration: number
}

export type Playlist = Record<string, unknown> & {
  provider: Exclude<Provider, 'all'>
  id: string
  name: string
  cover: string
  creator: string
  trackCount: number
}

export function endpointFor(id: string, kind: 'search' | 'status' | 'url'): string {
  const prefix = id === 'netease' ? '' : `/${id}`
  if (kind === 'search') return `/api${prefix}/search`
  if (kind === 'status') return `/api${prefix}/login/status`
  return id === 'netease' ? '/api/song/url' : `/api/${id}/song/url`
}

export function playlistEndpointFor(id: Exclude<Provider, 'all'>, kind: 'list' | 'tracks'): string {
  const prefix = id === 'netease' ? '' : `/${id}`
  return kind === 'list' ? `/api${prefix}/user/playlists` : `/api${prefix}/playlist/tracks`
}

export function text(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === 'object' && item !== null ? text((item as { name?: unknown }).name) : text(item))
      .filter(Boolean)
      .join(' / ')
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function normalizeSong(raw: Record<string, any>, source: Exclude<Provider, 'all'>): Song {
  const artists = raw.artists || raw.ar || raw.singer || raw.singers || raw.author || raw.artist
  const albumValue = raw.album || raw.al
  return {
    ...raw,
    provider: source,
    id: text(raw.id || raw.songmid || raw.mid || raw.hash || raw.FileHash || raw.item_id),
    name: text(raw.name || raw.songname || raw.title || raw.filename) || '未知歌曲',
    artist: text(artists) || '未知歌手',
    album: typeof albumValue === 'object' ? text(albumValue?.name) : text(albumValue),
    cover: text(raw.cover || raw.picUrl || raw.pic || raw.albumCover || albumValue?.picUrl || albumValue?.cover),
    duration: Number(raw.duration || raw.dt || raw.interval || 0)
  }
}

export function normalizePlaylist(raw: Record<string, any>, source: Exclude<Provider, 'all'>): Playlist {
  return {
    ...raw,
    provider: source,
    id: text(raw.id || raw.playlistId || raw.disstid || raw.global_collection_id),
    name: text(raw.name || raw.title || raw.diss_name) || '未命名歌单',
    cover: text(raw.cover || raw.coverImgUrl || raw.logo || raw.pic || raw.img),
    creator: typeof raw.creator === 'object' ? text(raw.creator?.nickname || raw.creator?.name) : text(raw.creator || raw.nickname),
    trackCount: Number(raw.trackCount || raw.songCount || raw.song_cnt || raw.count || raw.total || 0)
  }
}
