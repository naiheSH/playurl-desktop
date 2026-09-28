<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { endpointFor, normalizePlaylist, normalizeSong, playlistEndpointFor, text, type Playlist, type Provider, type Song } from './providers'

type MusicProvider = Exclude<Provider, 'all'>
type Account = { loggedIn: boolean; isVip?: boolean; isSvip?: boolean; vipLabel?: string }
type Quality = { id: string; name: string; detail: string; required?: 'VIP' | 'SVIP' }
type RowState = { quality: string; url: string; actual: string; loading: boolean; error: string; trial: boolean }

const providers = [
  { id: 'all', name: '聚合搜索', mark: '✦' },
  { id: 'netease', name: '网易云', mark: '云' },
  { id: 'qq', name: 'QQ 音乐', mark: 'Q' },
  { id: 'kugou', name: '酷狗', mark: 'K' },
  { id: 'qishui', name: '汽水', mark: '汽' }
] as const

const qualityMap: Record<MusicProvider, Quality[]> = {
  netease: [
    { id: 'jymaster', name: '母带', detail: 'Master', required: 'SVIP' },
    { id: 'hires', name: 'Hi-Res', detail: '高解析', required: 'VIP' },
    { id: 'lossless', name: '无损', detail: 'FLAC', required: 'VIP' },
    { id: 'exhigh', name: '极高', detail: '320k', required: 'VIP' },
    { id: 'standard', name: '标准', detail: '128k' }
  ],
  qq: [
    { id: 'hires', name: 'Hi-Res', detail: '高解析', required: 'SVIP' },
    { id: 'lossless', name: '无损', detail: 'FLAC', required: 'VIP' },
    { id: 'exhigh', name: '极高', detail: '320k', required: 'VIP' },
    { id: 'standard', name: '标准', detail: '128k' },
    { id: 'aac', name: 'AAC', detail: '节省流量' }
  ],
  kugou: [
    { id: 'jymaster', name: '母带', detail: 'Master', required: 'SVIP' },
    { id: 'hires', name: 'Hi-Res', detail: '高解析', required: 'SVIP' },
    { id: 'lossless', name: '无损', detail: 'FLAC', required: 'VIP' },
    { id: 'exhigh', name: '极高', detail: '320k', required: 'VIP' },
    { id: 'standard', name: '标准', detail: '128k' }
  ],
  qishui: [{ id: 'auto', name: '自动最佳', detail: '按账号权益' }]
}

const apiBase = ref('')
const version = ref('')
const provider = ref<Provider>('all')
const query = ref('')
const songs = ref<Song[]>([])
const loading = ref(false)
const message = ref('输入歌名、歌手或专辑开始搜索')
const libraryOpen = ref(false)
const libraryLoading = ref(false)
const libraryMessage = ref('')
const playlists = ref<Playlist[]>([])
const selectedPlaylist = ref<Playlist | null>(null)
const discoveryOpen = ref(false)
const discoveryLoading = ref(false)
const discoveryMessage = ref('')
const discoveryCategory = ref('全部')
const discoveryCategories = ref<Array<{ name: string; hot?: boolean }>>([])
const discoveryCharts = ref<Playlist[]>([])
const discoveryPlaylists = ref<Playlist[]>([])
const now = ref<(Song & { url: string; actualQuality: string; trial: boolean }) | null>(null)
const audio = ref<HTMLAudioElement | null>(null)
const login = ref({ open: false, qr: '', token: '', status: '' })
const accounts = ref<Record<MusicProvider, Account>>({
  netease: { loggedIn: false }, qq: { loggedIn: false }, kugou: { loggedIn: false }, qishui: { loggedIn: false }
})
const rows = reactive<Record<string, RowState>>({})
let loginTimer: number | undefined

const activeProviderName = computed(() => selectedPlaylist.value?.name || providers.find((item) => item.id === provider.value)?.name || '')

async function getJson(path: string): Promise<any> {
  const response = await fetch(apiBase.value + path)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || body.error || `请求失败 (${response.status})`)
  return body
}

function rowKey(song: Song): string { return `${song.provider}:${song.id}` }
function qualitiesFor(song: Song): Quality[] { return qualityMap[song.provider] }

function defaultQuality(id: MusicProvider): string {
  const account = accounts.value[id]
  const choices = qualityMap[id]
  const fallback = choices[choices.length - 1]!
  if (account.isSvip) return choices[0]?.id || fallback.id
  if (account.isVip) return (choices.find((item) => item.required !== 'SVIP') || fallback).id
  return (choices.find((item) => !item.required) || fallback).id
}

function stateFor(song: Song): RowState {
  const key = rowKey(song)
  return rows[key] || (rows[key] = { quality: defaultQuality(song.provider), url: '', actual: '', loading: false, error: '', trial: false })
}

function selectQuality(song: Song, id: string): void {
  const state = stateFor(song)
  state.quality = id
  state.url = ''
  state.actual = ''
  state.error = ''
  state.trial = false
}

function accountLabel(id: MusicProvider): string {
  const account = accounts.value[id]
  if (!account.loggedIn) return '登录'
  return account.vipLabel || (account.isSvip ? 'SVIP' : account.isVip ? 'VIP' : '已登录')
}

function entitled(id: MusicProvider, quality: Quality): boolean {
  if (!quality.required) return true
  const account = accounts.value[id]
  return quality.required === 'VIP' ? Boolean(account.isVip || account.isSvip) : Boolean(account.isSvip)
}

async function searchOne(id: MusicProvider): Promise<Song[]> {
  const params = new URLSearchParams({ keywords: query.value.trim(), limit: '12' })
  const body = await getJson(`${endpointFor(id, 'search')}?${params}`)
  return (body.songs || body.data || []).map((item: Record<string, unknown>) => normalizeSong(item, id)).filter((item: Song) => item.id)
}

async function runSearch(): Promise<void> {
  if (!query.value.trim() || loading.value) return
  loading.value = true
  selectedPlaylist.value = null
  songs.value = []
  for (const key of Object.keys(rows)) delete rows[key]
  message.value = `正在${activeProviderName.value}中寻找…`
  try {
    const targets: MusicProvider[] = provider.value === 'all' ? ['netease', 'qq', 'kugou', 'qishui'] : [provider.value]
    const results = await Promise.allSettled(targets.map(searchOne))
    songs.value = results.flatMap((item) => item.status === 'fulfilled' ? item.value : [])
    const failed = results.filter((item) => item.status === 'rejected').length
    message.value = songs.value.length ? `找到 ${songs.value.length} 首${failed ? `，${failed} 个来源暂不可用` : ''}` : '没有找到结果，试试更短的关键词'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '搜索失败'
  } finally { loading.value = false }
}

async function loadLibrary(): Promise<void> {
  libraryOpen.value = true
  discoveryOpen.value = false
  libraryLoading.value = true
  libraryMessage.value = '正在同步各平台歌单…'
  playlists.value = []
  const ids: MusicProvider[] = ['netease', 'qq', 'kugou', 'qishui']
  const connected = ids.filter((id) => accounts.value[id].loggedIn)
  if (!connected.length) {
    libraryLoading.value = false
    libraryMessage.value = '请先登录至少一个音乐平台'
    return
  }
  const results = await Promise.allSettled(connected.map(async (id) => {
    const body = await getJson(playlistEndpointFor(id, 'list'))
    return (body.playlists || []).map((item: Record<string, unknown>) => normalizePlaylist(item, id)).filter((item: Playlist) => item.id)
  }))
  playlists.value = results.flatMap((item) => item.status === 'fulfilled' ? item.value : [])
  const failed = results.filter((item) => item.status === 'rejected').length
  libraryMessage.value = playlists.value.length
    ? `已同步 ${playlists.value.length} 个歌单${failed ? `，${failed} 个平台暂不可用` : ''}`
    : '登录已连接，但暂未取得歌单，请稍后刷新'
  libraryLoading.value = false
}

async function loadDiscovery(category = discoveryCategory.value): Promise<void> {
  discoveryOpen.value = true
  libraryOpen.value = false
  discoveryLoading.value = true
  discoveryCategory.value = category
  discoveryMessage.value = `正在加载“${category}”榜单与歌单…`
  try {
    const body = await getJson(`/api/discover/browse?category=${encodeURIComponent(category)}`)
    discoveryCategories.value = body.categories || []
    discoveryCharts.value = (body.charts || []).map((item: Record<string, unknown>) => normalizePlaylist(item, 'netease')).filter((item: Playlist) => item.id)
    discoveryPlaylists.value = (body.playlists || []).map((item: Record<string, unknown>) => normalizePlaylist(item, 'netease')).filter((item: Playlist) => item.id)
    discoveryMessage.value = `网易云官方榜单 ${discoveryCharts.value.length} 个 · ${category}歌单 ${discoveryPlaylists.value.length} 个`
  } catch (error) {
    discoveryMessage.value = error instanceof Error ? error.message : '发现内容加载失败'
  } finally { discoveryLoading.value = false }
}

async function openPlaylist(item: Playlist): Promise<void> {
  if (loading.value) return
  loading.value = true
  selectedPlaylist.value = item
  songs.value = []
  for (const key of Object.keys(rows)) delete rows[key]
  message.value = `正在加载《${item.name}》…`
  try {
    const params = new URLSearchParams({ id: item.id, limit: '50', offset: '0' })
    const body = await getJson(`${playlistEndpointFor(item.provider, 'tracks')}?${params}`)
    songs.value = (body.tracks || body.songs || []).map((song: Record<string, unknown>) => normalizeSong(song, item.provider)).filter((song: Song) => song.id)
    message.value = songs.value.length ? `已载入 ${songs.value.length} 首歌曲` : (body.message || '这个歌单暂时没有可读取的歌曲')
  } catch (error) {
    message.value = error instanceof Error ? error.message : '歌单加载失败'
  } finally { loading.value = false }
}

function songParams(song: Song, quality: string): URLSearchParams {
  const params = new URLSearchParams({ id: song.id, quality, name: song.name, artist: song.artist })
  const aliases: Record<string, string[]> = {
    mid: ['mid', 'songmid'], mediaMid: ['mediaMid', 'media_mid'], hash: ['hash', 'FileHash'],
    albumId: ['albumId', 'album_id', 'AlbumID'], albumAudioId: ['albumAudioId', 'album_audio_id', 'MixSongID'],
    hqHash: ['hqHash', 'hq_hash'], sqHash: ['sqHash', 'sq_hash'], resHash: ['resHash', 'res_hash']
  }
  for (const [target, sources] of Object.entries(aliases)) {
    const value = sources.map((key) => text(song[key])).find(Boolean)
    if (value) params.set(target, value)
  }
  return params
}

async function resolveSong(song: Song, action: 'play' | 'copy'): Promise<void> {
  const state = stateFor(song)
  if (state.loading) return
  state.loading = true
  state.error = ''
  try {
    if (!state.url) {
      const body = await getJson(`${endpointFor(song.provider, 'url')}?${songParams(song, state.quality)}`)
      const url = text(body.url)
      if (!url || body.playable === false) throw new Error(body.message || body.restriction?.message || body.error || '当前账号或曲目无法使用该音质')
      state.url = url
      state.actual = text(body.quality || body.level || body.requestedQuality || state.quality)
      state.trial = Boolean(body.trial)
    }
    if (action === 'copy') {
      await window.playurl.copy(state.url)
      message.value = `${song.name} 的真实播放 URL 已复制`
    } else {
      now.value = { ...song, url: state.url, actualQuality: state.actual, trial: state.trial }
      if (audio.value) {
        audio.value.src = `${apiBase.value}/api/audio?url=${encodeURIComponent(state.url)}`
        await audio.value.play()
      }
      message.value = state.trial ? '正在播放试听片段' : `正在播放 · ${state.actual}`
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : '解析失败'
    message.value = state.error
  } finally { state.loading = false }
}

async function copyCurrent(): Promise<void> {
  if (!now.value?.url) return
  await window.playurl.copy(now.value.url)
  message.value = '播放 URL 已复制到剪贴板'
}

async function refreshAccounts(): Promise<void> {
  const ids: MusicProvider[] = ['netease', 'qq', 'kugou', 'qishui']
  await Promise.all(ids.map(async (id) => {
    try {
      const body = await getJson(endpointFor(id, 'status'))
      accounts.value[id] = {
        loggedIn: Boolean(body.loggedIn),
        isVip: Boolean(body.isVip || body.vip || Number(body.vipType) > 0),
        isSvip: Boolean(body.isSvip || body.svip || Number(body.vipType) >= 11),
        vipLabel: text(body.vipLabel || body.levelName || body.vipName)
      }
    } catch { accounts.value[id] = { loggedIn: false } }
  }))
}

async function beginLogin(id: MusicProvider): Promise<void> {
  if (id !== 'qishui') {
    message.value = `请在新窗口完成${providers.find((item) => item.id === id)?.name}登录；授权完成后窗口会自动关闭`
    const result = await window.playurl.login(id)
    message.value = result.message
    await refreshAccounts()
    return
  }
  clearInterval(loginTimer)
  login.value = { open: true, qr: '', token: '', status: '正在创建二维码…' }
  try {
    const body = await getJson('/api/qishui/login/qrcode')
    login.value.qr = body.qrcode || body.qrcodeIndexUrl || ''
    login.value.token = body.token || ''
    login.value.status = body.message || '请使用抖音 App 扫码'
    loginTimer = window.setInterval(pollQishuiLogin, 2500)
  } catch (error) { login.value.status = error instanceof Error ? error.message : '二维码创建失败' }
}

async function pollQishuiLogin(): Promise<void> {
  if (!login.value.token) return
  try {
    const body = await getJson(`/api/qishui/login/check?token=${encodeURIComponent(login.value.token)}`)
    login.value.status = body.message || body.status || '等待扫码'
    if (body.loggedIn) {
      clearInterval(loginTimer)
      login.value.open = false
      await refreshAccounts()
      message.value = '汽水音乐登录成功'
    }
    if (body.status === 'expired') clearInterval(loginTimer)
  } catch (error) { login.value.status = error instanceof Error ? error.message : '登录状态检查失败' }
}

function closeLogin(): void { clearInterval(loginTimer); login.value.open = false }
function clock(value: number): string {
  const seconds = value > 10000 ? value / 1000 : value
  if (!Number.isFinite(seconds) || seconds <= 0) return '—:—'
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

onMounted(async () => {
  const config = await window.playurl.config()
  apiBase.value = config.apiBase
  version.value = config.version
  await refreshAccounts()
})
onUnmounted(() => clearInterval(loginTimer))
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-orbit"></span><div><strong>PLAYURL</strong><small>DESKTOP</small></div></div>
      <nav>
        <button v-for="item in providers" :key="item.id" :class="{ active: provider === item.id }" @click="provider = item.id">
          <span class="provider-mark">{{ item.mark }}</span><span>{{ item.name }}</span>
        </button>
      </nav>
      <div class="accounts-title">账号与权益</div>
      <div class="accounts">
        <button v-for="item in providers.slice(1)" :key="item.id" @click="beginLogin(item.id as MusicProvider)">
          <span :class="['status-dot', { online: accounts[item.id as MusicProvider].loggedIn }]" />
          <span>{{ item.name }}</span><small>{{ accountLabel(item.id as MusicProvider) }}</small>
        </button>
      </div>
      <button class="library-entry" :class="{ active: discoveryOpen }" @click="loadDiscovery()">
        <span>◈</span><strong>排行榜 · 分类</strong><small>发现</small>
      </button>
      <button class="library-entry secondary" :class="{ active: libraryOpen }" @click="loadLibrary">
        <span>▤</span><strong>我的歌单</strong><small>{{ playlists.length || '' }}</small>
      </button>
      <div class="version">v{{ version }} · Electron / Node</div>
    </aside>

    <main>
      <header>
        <div><p class="eyebrow">URL FIRST MUSIC CLIENT</p><h1>每一首歌，都把音质和链接讲清楚。</h1></div>
        <form class="search" @submit.prevent="runSearch">
          <span>⌕</span><input v-model="query" placeholder="搜索歌曲、歌手或专辑" autofocus />
          <button :disabled="loading">{{ loading ? '搜索中' : '搜索' }}</button>
        </form>
      </header>

      <div class="notice"><strong>独立音质</strong><span>每个平台只显示自身支持的档位；VIP / SVIP 是权益提示，曲目版权与接口返回的实际音质优先。</span></div>

      <section v-if="discoveryOpen" class="library-panel discover-panel">
        <div class="library-head">
          <div><span class="eyebrow">DISCOVER</span><h2>排行榜与分类</h2><small>{{ discoveryMessage }}</small></div>
          <div><button :disabled="discoveryLoading" @click="loadDiscovery()">{{ discoveryLoading ? '加载中…' : '刷新' }}</button><button @click="discoveryOpen = false">收起</button></div>
        </div>
        <div v-if="discoveryCategories.length" class="category-strip">
          <button v-for="item in discoveryCategories" :key="item.name" :class="{ selected: discoveryCategory === item.name }" @click="loadDiscovery(item.name)">{{ item.name }}<i v-if="item.hot">HOT</i></button>
        </div>
        <h3 v-if="discoveryCharts.length" class="shelf-title"><span>官方排行榜</span><small>网易云音乐</small></h3>
        <div v-if="discoveryCharts.length" class="playlist-grid chart-grid">
          <button v-for="item in discoveryCharts" :key="`chart-${item.id}`" class="playlist-card" @click="openPlaylist(item)">
            <span class="playlist-cover" :style="item.cover ? { backgroundImage: `url(${item.cover})` } : {}"><i>榜</i></span>
            <span class="playlist-copy"><strong>{{ item.name }}</strong><small>排行榜 · {{ item.trackCount || '—' }} 首</small><em>{{ item.creator || '网易云音乐' }}</em></span>
          </button>
        </div>
        <h3 v-if="discoveryPlaylists.length" class="shelf-title"><span>{{ discoveryCategory }}歌单</span><small>热门分类</small></h3>
        <div v-if="discoveryPlaylists.length" class="playlist-grid">
          <button v-for="item in discoveryPlaylists" :key="`discover-${item.id}`" class="playlist-card" @click="openPlaylist(item)">
            <span class="playlist-cover" :style="item.cover ? { backgroundImage: `url(${item.cover})` } : {}"><i>{{ item.name.slice(0, 1) }}</i></span>
            <span class="playlist-copy"><strong>{{ item.name }}</strong><small>{{ item.trackCount || '—' }} 首</small><em>{{ item.creator || discoveryCategory }}</em></span>
          </button>
        </div>
        <div v-if="!discoveryLoading && !discoveryCharts.length && !discoveryPlaylists.length" class="library-empty">{{ discoveryMessage }}</div>
      </section>

      <section v-if="libraryOpen" class="library-panel">
        <div class="library-head">
          <div><span class="eyebrow">YOUR LIBRARY</span><h2>我的歌单</h2><small>{{ libraryMessage }}</small></div>
          <div><button :disabled="libraryLoading" @click="loadLibrary">{{ libraryLoading ? '同步中…' : '刷新' }}</button><button @click="libraryOpen = false">收起</button></div>
        </div>
        <div v-if="playlists.length" class="playlist-grid">
          <button v-for="item in playlists" :key="`${item.provider}-${item.id}`" :class="['playlist-card', { selected: selectedPlaylist?.id === item.id && selectedPlaylist?.provider === item.provider }]" @click="openPlaylist(item)">
            <span class="playlist-cover" :style="item.cover ? { backgroundImage: `url(${item.cover})` } : {}"><i>{{ item.name.slice(0, 1) }}</i></span>
            <span class="playlist-copy"><strong>{{ item.name }}</strong><small>{{ providers.find(source => source.id === item.provider)?.name }} · {{ item.trackCount || '—' }} 首</small><em>{{ item.creator || '我的歌单' }}</em></span>
          </button>
        </div>
        <div v-else class="library-empty">{{ libraryLoading ? '正在读取创建、收藏、喜欢与最近播放…' : libraryMessage }}</div>
      </section>

      <section class="results">
        <div class="results-head"><h2>{{ activeProviderName }}</h2><span>{{ message }}</span></div>
        <div v-if="songs.length" class="song-list">
          <article v-for="(song, index) in songs" :key="`${song.provider}-${song.id}-${index}`" class="song-row">
            <div class="song-summary">
              <span class="index">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="cover" :style="song.cover ? { backgroundImage: `url(${song.cover})` } : {}"><i>{{ song.name.slice(0, 1) }}</i></span>
              <span class="song-copy"><strong>{{ song.name }}</strong><small>{{ song.artist }} · {{ song.album || '未知专辑' }}</small></span>
              <span class="source">{{ providers.find(item => item.id === song.provider)?.name }}</span>
              <span class="duration">{{ clock(song.duration) }}</span>
            </div>
            <div class="song-controls">
              <div class="row-qualities">
                <button v-for="item in qualitiesFor(song)" :key="item.id" :class="{ selected: stateFor(song).quality === item.id, entitled: entitled(song.provider, item) }" :title="`${item.name} · ${item.detail}${item.required ? ` · ${item.required}` : ''}`" @click="selectQuality(song, item.id)">
                  <span>{{ item.name }}</span><em v-if="item.required">{{ item.required }}</em>
                </button>
              </div>
              <div :class="['resolved', { error: stateFor(song).error }]" :title="stateFor(song).url || stateFor(song).error">
                <template v-if="stateFor(song).error">{{ stateFor(song).error }}</template>
                <template v-else-if="stateFor(song).url"><b>{{ stateFor(song).actual }}</b><code>{{ stateFor(song).url }}</code></template>
                <template v-else-if="song.provider === 'qishui' && !accounts.qishui.loggedIn">需登录后按账号权益解析</template>
                <template v-else>选择音质后解析真实 URL</template>
              </div>
              <button class="row-action primary" :disabled="stateFor(song).loading" @click="resolveSong(song, 'play')">{{ stateFor(song).loading ? '解析中' : '播放' }}</button>
              <button class="row-action" :disabled="stateFor(song).loading" @click="resolveSong(song, 'copy')">复制 URL</button>
            </div>
          </article>
        </div>
        <div v-else class="empty"><div class="empty-disc"><span></span></div><p>{{ loading ? '正在连接音乐世界…' : '你的下一首歌，从一个链接开始。' }}</p></div>
      </section>
    </main>

    <footer :class="{ ready: now }">
      <div class="now-cover" :style="now?.cover ? { backgroundImage: `url(${now.cover})` } : {}"><span>{{ now?.name?.slice(0, 1) || '♪' }}</span></div>
      <div class="now-title"><strong>{{ now?.name || '尚未播放' }}</strong><small>{{ now ? `${now.artist} · ${now.actualQuality}${now.trial ? ' · 试听' : ''}` : '真实播放 URL 会显示在歌曲行与这里' }}</small></div>
      <audio ref="audio" controls preload="metadata" />
      <div class="url-box" :title="now?.url || ''"><span>URL</span><code>{{ now?.url || 'https://…' }}</code></div>
      <button class="copy" :disabled="!now" @click="copyCurrent">复制链接</button>
    </footer>

    <div v-if="login.open" class="modal" @click.self="closeLogin">
      <section><button class="modal-close" @click="closeLogin">×</button><p class="eyebrow">ACCOUNT CONNECT</p><h2>汽水音乐扫码登录</h2>
        <img v-if="login.qr" :src="login.qr" alt="汽水音乐登录二维码" /><div v-else class="qr-loading">生成中…</div>
        <p>{{ login.status }}</p><small>凭据仅保存在这台设备的应用数据目录中</small>
      </section>
    </div>
  </div>
</template>
