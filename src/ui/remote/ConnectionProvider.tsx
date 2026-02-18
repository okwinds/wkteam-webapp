import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import type { ConnectionSettings, TokenPersistence } from './connectionStore'
import { loadApiToken, loadConnectionSettings, saveApiToken, saveConnectionSettings } from './connectionStore'
import { createBffClient, type BffClient, type BffConnectionStatus } from './bffClient'

export type ConnectionState = {
  settings: ConnectionSettings
  tokenMasked: string | null
  status: BffConnectionStatus
  lastError: string | null
  client: BffClient | null
}

export type ConnectionActions = {
  setMode: (mode: ConnectionSettings['mode']) => void
  setBaseUrl: (baseUrl: string) => void
  setWkteamWId: (wId: string) => void
  setToken: (token: string, persistence: TokenPersistence) => void
  setTokenPersistence: (persistence: TokenPersistence) => void
  loginLocal: (password: string) => Promise<boolean>
  logoutLocal: () => Promise<void>
  testConnection: () => Promise<{ status: BffConnectionStatus; error: string | null }>
}

const StateContext = createContext<ConnectionState | null>(null)
const ActionsContext = createContext<ConnectionActions | null>(null)

/**
 * 连接配置 Provider（V0：连接后端）
 *
 * - 功能：管理 baseUrl/token（敏感信息不进入导出数据），并提供“测试连接”
 * - 约束：token 永远不以明文展示；仅在本地存储
 */
export function ConnectionProvider(props: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ConnectionSettings>(() => loadConnectionSettings())
  const [status, setStatus] = useState<BffConnectionStatus>('disconnected')
  const [lastError, setLastError] = useState<string | null>(null)

  const token = useMemo(() => loadApiToken(settings), [settings])

  const client = useMemo(() => {
    if (settings.mode !== 'server') return null
    // token 允许为空：此时可走“本地登录 session cookie”
    return createBffClient({ baseUrl: settings.baseUrl, token })
  }, [settings.baseUrl, settings.mode, token])

  const tokenMasked = useMemo(() => {
    if (!token) return null
    if (token.length <= 8) return '已设置'
    return `${token.slice(0, 4)}…${token.slice(-4)}`
  }, [token])

  useEffect(() => {
    saveConnectionSettings(settings)
  }, [settings])

  const testConnection = useCallback(async () => {
    if (settings.mode !== 'server') {
      setStatus('disconnected')
      setLastError(null)
      return { status: 'disconnected' as const, error: null }
    }
    setStatus('connecting')
    setLastError(null)

    try {
      const baseUrl = settings.baseUrl.trim()
      // baseUrl 允许为空：表示走同源路径（用于 Vite proxy 或同域部署）
      const t = loadApiToken(settings)
      const c = createBffClient({ baseUrl, token: t })
      const result = await c.testAuth()
      if (result === 'ok') {
        setStatus('connected')
        setLastError(null)
        return { status: 'connected' as const, error: null }
      }
      if (result === 'auth_failed') {
        setStatus('auth_failed')
        const err = t ? '鉴权失败，请检查 token 或重新登录' : '未登录（请先登录或设置 token）'
        setLastError(err)
        return { status: 'auth_failed' as const, error: err }
      }
      setStatus('error')
      const err = '网络错误或服务不可用'
      setLastError(err)
      return { status: 'error' as const, error: err }
    } catch (e) {
      setStatus('error')
      const err = e instanceof Error ? e.message : '未知错误'
      setLastError(err)
      return { status: 'error' as const, error: err }
    }
  }, [settings])

  const actions = useMemo<ConnectionActions>(() => {
    return {
      setMode: (mode) => setSettings((s) => ({ ...s, mode })),
      setBaseUrl: (baseUrl) => setSettings((s) => ({ ...s, baseUrl })),
      setWkteamWId: (wId) => setSettings((s) => ({ ...s, wkteamWId: wId })),
      setToken: (tokenValue, persistence) => {
        saveApiToken(tokenValue, persistence)
        setSettings((s) => ({ ...s, tokenPersistence: persistence }))
      },
      setTokenPersistence: (persistence) => {
        const currentToken = loadApiToken(settings)
        if (currentToken) saveApiToken(currentToken, persistence)
        setSettings((s) => ({ ...s, tokenPersistence: persistence }))
      },
      loginLocal: async (password) => {
        if (settings.mode !== 'server') return false
        const baseUrl = settings.baseUrl.trim()
        const t = loadApiToken(settings)
        const c = createBffClient({ baseUrl, token: t })
        try {
          await c.loginLocal(password)
          const r = await testConnection()
          return r.status === 'connected'
        } catch (e) {
          setStatus('auth_failed')
          const err = e instanceof Error ? e.message : '登录失败'
          setLastError(err)
          return false
        }
      },
      logoutLocal: async () => {
        if (settings.mode !== 'server') return
        const baseUrl = settings.baseUrl.trim()
        const t = loadApiToken(settings)
        const c = createBffClient({ baseUrl, token: t })
        await c.logoutLocal().catch(() => {})
        setStatus('disconnected')
        setLastError(null)
      },
      testConnection
    }
  }, [settings, testConnection])

  const state = useMemo<ConnectionState>(() => {
    return { settings, tokenMasked, status, lastError, client }
  }, [settings, tokenMasked, status, lastError, client])

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{props.children}</StateContext.Provider>
    </ActionsContext.Provider>
  )
}

export function useConnectionState() {
  const ctx = React.useContext(StateContext)
  if (!ctx) throw new Error('useConnectionState must be used within ConnectionProvider')
  return ctx
}

export function useConnectionActions() {
  const ctx = React.useContext(ActionsContext)
  if (!ctx) throw new Error('useConnectionActions must be used within ConnectionProvider')
  return ctx
}
