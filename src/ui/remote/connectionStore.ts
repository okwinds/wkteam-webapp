export type ConnectionMode = 'local' | 'server'
export type TokenPersistence = 'session' | 'local'

export type ConnectionSettings = {
  mode: ConnectionMode
  baseUrl: string
  tokenPersistence: TokenPersistence
  wkteamWId: string
}

const SETTINGS_KEY = 'wkteam.connection.v1.settings'
const TOKEN_KEY = 'wkteam.connection.v1.token'

/**
 * 读取连接配置（不包含 token）
 *
 * - 功能：从 localStorage 读取连接模式与 baseUrl 等非敏感信息
 * - 返回：默认值 + 已保存值
 */
export function loadConnectionSettings(): ConnectionSettings {
  const defaults: ConnectionSettings = { mode: 'local', baseUrl: '', tokenPersistence: 'session', wkteamWId: '' }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<ConnectionSettings>
    return {
      mode: parsed.mode === 'server' ? 'server' : 'local',
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : defaults.baseUrl,
      tokenPersistence: parsed.tokenPersistence === 'local' ? 'local' : 'session',
      wkteamWId: typeof parsed.wkteamWId === 'string' ? parsed.wkteamWId : defaults.wkteamWId
    }
  } catch {
    return defaults
  }
}

/**
 * 保存连接配置（不包含 token）
 *
 * - 功能：把 mode/baseUrl/tokenPersistence 写入 localStorage
 * - 参数：partial patch（以当前值为基准合并）
 */
export function saveConnectionSettings(patch: Partial<ConnectionSettings>) {
  const current = loadConnectionSettings()
  const next: ConnectionSettings = {
    ...current,
    ...patch,
    mode: patch.mode === 'server' ? 'server' : current.mode,
    tokenPersistence: patch.tokenPersistence === 'local' ? 'local' : patch.tokenPersistence === 'session' ? 'session' : current.tokenPersistence,
    baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl.trim() : current.baseUrl,
    wkteamWId: typeof patch.wkteamWId === 'string' ? patch.wkteamWId : current.wkteamWId
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
}

/**
 * 读取 token（敏感信息）
 *
 * - 功能：根据配置决定从 sessionStorage 或 localStorage 读取 token
 * - 返回：token 字符串或 null
 */
export function loadApiToken(settings: ConnectionSettings): string | null {
  const storage = settings.tokenPersistence === 'local' ? localStorage : sessionStorage
  const t = storage.getItem(TOKEN_KEY)
  return t && t.trim() ? t : null
}

/**
 * 保存 token（敏感信息）
 *
 * - 功能：把 token 写入 sessionStorage/localStorage；并清理另一份（避免残留）
 * - 参数：token 字符串（空字符串等价于清除）；persistence 保存位置
 */
export function saveApiToken(token: string, persistence: TokenPersistence) {
  const t = token.trim()
  if (!t) {
    sessionStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
    return
  }
  if (persistence === 'local') {
    localStorage.setItem(TOKEN_KEY, t)
    sessionStorage.removeItem(TOKEN_KEY)
  } else {
    sessionStorage.setItem(TOKEN_KEY, t)
    localStorage.removeItem(TOKEN_KEY)
  }
}

/**
 * 掩码显示 token（避免泄漏）
 *
 * - 功能：仅用于 UI 展示（永远不要显示完整 token）
 * - 返回：例如 `abcd…wxyz`
 */
export function maskToken(token: string) {
  const t = token.trim()
  if (t.length <= 8) return '已设置'
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}
