export type Provider = 'all' | 'netease' | 'qq' | 'kugou' | 'qishui'

export type Song = Record<string, unknown> & {
  provider: Exclude<Provider, 'all'>
  id: string
  name: string
  artist: string
  album: string
  cover: string
  duration: number
  accessTier: 'free' | 'vip' | 'svip' | 'paid' | 'unknown'
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

export function normalizeAccessTier(raw: Record<string, any>, source: Exclude<Provider, 'all'>): Song['accessTier'] {
  const restriction = raw.restriction && typeof raw.restriction === 'object' ? raw.restriction : {}
  const required = text(raw.requiredTier || raw.required_tier || restriction.requiredTier || restriction.required_tier).toLowerCase()
  if (raw.svipRequired === true || raw.only_svip_playable === true || required === 'svip') return 'svip'
  if (raw.vipRequired === true || raw.only_vip_playable === true || required === 'vip') return 'vip'
  const feeValue = raw.fee ?? raw.payPlay ?? raw.pay_play
  if (feeValue !== undefined && feeValue !== null && feeValue !== '') {
    const fee = Number(feeValue)
    if (source === 'netease' && fee === 4) return 'paid'
    if (Number.isFinite(fee)) return fee > 0 ? 'vip' : 'free'
  }
  if (source === 'kugou' && raw.privilege !== undefined) return Number(raw.privilege) >= 10 ? 'vip' : 'free'
  return 'unknown'
}

export function normalizeDurationMs(raw: Record<string, any>, source: Exclude<Provider, 'all'>): number {
  if (raw.dt !== undefined) return Math.max(0, Number(raw.dt) || 0)
  if (raw.interval !== undefined && raw.duration === undefined) return Math.max(0, (Number(raw.interval) || 0) * 1000)
  const duration = Math.max(0, Number(raw.duration || 0) || 0)
  return source === 'qishui' && duration > 0 && duration < 10000 ? duration * 1000 : duration
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
    duration: normalizeDurationMs(raw, source),
    accessTier: normalizeAccessTier(raw, source)
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
