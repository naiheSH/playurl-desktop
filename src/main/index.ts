import { app, BrowserWindow, clipboard, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

type Provider = 'netease' | 'qq' | 'kugou' | 'qishui'

let apiBase = ''

function runtimePath(...parts: string[]): string {
  return join(app.getAppPath(), 'runtime', ...parts)
}

async function startApi(): Promise<string> {
  const userData = app.getPath('userData')
  process.env.PLAYURL_CLIENT = '1'
  process.env.HOST = '127.0.0.1'
  process.env.PORT = '0'
  process.env.COOKIE_FILE = join(userData, 'accounts', 'netease.cookie')
  process.env.QQ_COOKIE_FILE = join(userData, 'accounts', 'qq.cookie')
  process.env.KUGOU_COOKIE_FILE = join(userData, 'accounts', 'kugou.cookie')
  process.env.QISHUI_COOKIE_FILE = join(userData, 'accounts', 'qishui.cookie')
  process.env.QISHUI_TOKEN_FILE = join(userData, 'accounts', 'qishui-token.json')
  process.env.QISHUI_QR_CONFIG_FILE = join(userData, 'accounts', 'qishui-qr.json')
  process.env.MINERADIO_SPOTIFY_TOKEN_FILE = join(userData, 'accounts', 'spotify-token.json')
  process.env.MINERADIO_BEAT_CACHE_DIR = join(userData, 'cache', 'beatmaps')
  process.env.MINERADIO_LISTEN_SYNC_FILE = join(userData, 'data', 'listen-sync.json')
  process.env.CUEFIELD_FEEDBACK_FILE = join(userData, 'data', 'cuefield-feedback.jsonl')

  const moduleUrl = pathToFileURL(runtimePath('server.js')).href
  const loaded = await import(moduleUrl)
  const server = loaded.default ?? loaded
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local API did not expose a TCP port')
  return `http://127.0.0.1:${address.port}`
}

const loginConfig: Record<Provider, { url: string; endpoint: string; domains: string[]; priority: string[] }> = {
  netease: {
    url: 'https://music.163.com/#/login', endpoint: '/api/login/cookie',
    domains: ['163.com', 'netease.com'],
    priority: ['MUSIC_U', '__csrf', 'NMTID', 'MUSIC_A', '__remember_me', '_ntes_nuid', '_ntes_nnid', 'WEVNSM', 'WNMCID', 'JSESSIONID-WYYY']
  },
  qq: {
    url: 'https://y.qq.com/n/ryqq/profile', endpoint: '/api/qq/login/cookie',
    domains: ['qq.com', 'qqmusic.com'],
    priority: ['uin', 'qqmusic_uin', 'wxuin', 'login_type', 'qm_keyst', 'qqmusic_key', 'music_key', 'p_skey', 'skey', 'wxskey', 'p_uin', 'ptcz', 'RK']
  },
  kugou: {
    url: 'https://www.kugou.com/', endpoint: '/api/kugou/login/cookie',
    domains: ['kugou.com'],
    priority: ['KuGoo', 'token', 'userid', 'KugooID', 'kugouID', 'UserId', 'kg_mid', 'kg_dfid', 'Kugou', 'NickName']
  },
  qishui: {
    url: 'https://music.douyin.com/', endpoint: '/api/qishui/login/cookie',
    domains: ['douyin.com', 'qishui.com'], priority: []
  }
}

async function postCookie(provider: Provider, cookie: string): Promise<void> {
  const config = loginConfig[provider]
  const response = await fetch(apiBase + config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cookie })
  })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || '登录态保存失败')
}

function cookieHeader(cookies: Electron.Cookie[], config: (typeof loginConfig)[Provider]): string {
  const allowed = (domain: string) => {
    const value = domain.replace(/^\./, '').toLowerCase()
    return config.domains.some((item) => value === item || value.endsWith(`.${item}`))
  }
  const picked = new Map<string, Electron.Cookie>()
  for (const cookie of cookies) {
    const domain = cookie.domain || ''
    const path = cookie.path || ''
    if (!allowed(domain) || !cookie.value) continue
    const previous = picked.get(cookie.name)
    if (!previous || (domain.length + path.length) > ((previous.domain || '').length + (previous.path || '').length)) picked.set(cookie.name, cookie)
  }
  const ordered: Array<[string, string]> = []
  for (const name of config.priority) {
    const item = picked.get(name)
    if (item) { ordered.push([name, item.value]); picked.delete(name) }
  }
  picked.forEach((item, name) => ordered.push([name, item.value]))
  return ordered.map(([name, value]) => `${name}=${value}`).join('; ')
}

function parseCookie(value: string): Record<string, string> {
  return Object.fromEntries(value.split(';').map((item) => item.trim().split(/=(.*)/s)).filter((item) => item[0] && item[1]))
}

function loginReady(provider: Provider, value: string): boolean {
  const cookie = parseCookie(value)
  if (provider === 'netease') return Boolean(cookie.MUSIC_U)
  if (provider === 'qq') {
    const uin = cookie.uin || cookie.qqmusic_uin || cookie.wxuin || cookie.p_uin
    const key = cookie.qm_keyst || cookie.qqmusic_key || cookie.music_key || cookie.wxskey
    return Boolean(uin && key)
  }
  if (provider === 'kugou') return Boolean(cookie.KuGoo || cookie.Kugou || ((cookie.userid || cookie.KugooID) && cookie.token))
  return false
}

function trustedQQUrl(target: string): boolean {
  try {
    const host = new URL(target).hostname.toLowerCase()
    return ['qq.com', 'tencent.com', 'qqmusic.com', 'gtimg.com', 'qpic.cn', 'weixin.qq.com']
      .some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch { return false }
}

async function openLogin(provider: Provider): Promise<{ ok: boolean; message: string }> {
  const config = loginConfig[provider]
  if (!config || provider === 'qishui') return { ok: false, message: '汽水音乐请使用客户端内扫码登录' }
  const partition = `persist:playurl-login-${provider}`
  const loginSession = session.fromPartition(partition)
  const win = new BrowserWindow({
    width: 940, height: 760, minWidth: 760, minHeight: 560,
    title: `${provider === 'netease' ? '网易云音乐' : provider === 'qq' ? 'QQ 音乐' : '酷狗音乐'}登录`,
    autoHideMenuBar: true, show: false, backgroundColor: '#111318',
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  return await new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setInterval> | undefined
    let qqWarmup: BrowserWindow | null = null
    let kugouWarmupStarted = false

    const read = async () => cookieHeader(await loginSession.cookies.get({}), config)
    const finish = async (result: { ok: boolean; message: string }) => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      if (qqWarmup && !qqWarmup.isDestroyed()) qqWarmup.close()
      try { await loginSession.flushStorageData() } catch { /* best effort */ }
      if (!win.isDestroyed()) win.close()
      resolve(result)
    }
    const check = async () => {
      try {
        const cookie = await read()
        if (!loginReady(provider, cookie)) return
        await postCookie(provider, cookie)
        await finish({ ok: true, message: '登录成功，播放权益已同步' })
      } catch (error) {
        console.warn(`[${provider} login]`, error)
      }
    }

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (provider === 'qq' && trustedQQUrl(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 760, height: 640, parent: win, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } } }
      }
      if (provider !== 'qq' && /^https?:\/\//i.test(url)) void win.loadURL(url)
      else if (!trustedQQUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('did-create-window', (child) => child.webContents.on('did-finish-load', check))
    win.webContents.on('did-finish-load', () => {
      void check()
      if (!win.isVisible()) win.show()
      void win.webContents.executeJavaScript(`setTimeout(() => {
        const node = [...document.querySelectorAll('a,button,span,div')].find(el => /登录|登陆/.test((el.textContent || '').trim()) && el.getBoundingClientRect().width > 0);
        if (node) node.click();
      }, 800)`, true).catch(() => {})
    })
    win.on('closed', async () => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      if (qqWarmup && !qqWarmup.isDestroyed()) qqWarmup.close()
      try {
        const cookie = await read()
        if (loginReady(provider, cookie)) {
          await postCookie(provider, cookie)
          resolve({ ok: true, message: '登录成功，播放权益已同步' })
        } else {
          resolve({ ok: false, message: provider === 'qq' ? '登录窗口已关闭，但尚未取得 QQ 音乐播放授权，请完成扫码和手机确认后等待窗口自动关闭' : '登录未完成，请扫码并确认后等待窗口自动关闭' })
        }
      } catch (error) { resolve({ ok: false, message: error instanceof Error ? error.message : '登录失败' }) }
    })
    timer = setInterval(async () => {
      await check()
      if (provider === 'qq' && !qqWarmup) {
        const cookie = await read().catch(() => '')
        const parsed = parseCookie(cookie)
        if ((parsed.uin || parsed.qqmusic_uin || parsed.wxuin) && !loginReady('qq', cookie)) {
          qqWarmup = new BrowserWindow({ show: false, webPreferences: { partition, sandbox: true, contextIsolation: true } })
          qqWarmup.webContents.on('did-finish-load', check)
          void qqWarmup.loadURL('https://y.qq.com/n/ryqq/player')
        }
      }
      if (provider === 'kugou') {
        const cookie = await read().catch(() => '')
        if (cookie && !loginReady('kugou', cookie) && !kugouWarmupStarted && !win.isDestroyed()) {
          kugouWarmupStarted = true
          void win.loadURL('https://www.kugou.com/newuc/user/uc/type=edit').catch(() => {})
        }
      }
    }, 1200)
    void win.loadURL(config.url).catch((error) => finish({ ok: false, message: error.message }))
  })
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 680,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  apiBase = await startApi()
  ipcMain.handle('app:config', () => ({ apiBase, platform: process.platform, version: app.getVersion() }))
  ipcMain.handle('app:copy', (_event, value: string) => clipboard.writeText(String(value || '')))
  ipcMain.handle('app:login', (_event, provider: Provider) => openLogin(provider))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
