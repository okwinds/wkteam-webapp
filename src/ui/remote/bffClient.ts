import { z } from 'zod'

export type BffConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'auth_failed' | 'error'

export type BffConversation = {
  id: string
  title: string
  peerId: string
  pinned: boolean
  unreadCount: number
  lastMessageId: string | null
  lastActivityAt: number
  createdAt: number
  updatedAt: number
}

export type BffMessageDirection = 'inbound' | 'outbound'
export type BffMessageSource = 'human' | 'ai' | 'system' | 'webhook'

export type BffTextMessage = {
  id: string
  conversationId: string
  direction: BffMessageDirection
  source: BffMessageSource
  sentAt: number
  kind: 'text'
  text: string
}

export type BffImageMessage = {
  id: string
  conversationId: string
  direction: BffMessageDirection
  source: BffMessageSource
  sentAt: number
  kind: 'image'
  image: { dataUrl: string; alt: string }
}

export type BffFileMessage = {
  id: string
  conversationId: string
  direction: BffMessageDirection
  source: BffMessageSource
  sentAt: number
  kind: 'file'
  file: { name: string; mime: string; dataUrl: string }
}

export type BffMessage = BffTextMessage | BffImageMessage | BffFileMessage

export type BffAutomationRun = {
  id: string
  trigger: 'manual' | 'webhook' | 'human_send'
  conversationId: string
  inputMessageId: string
  outputMessageId: string | null
  status: 'success' | 'failed' | 'skipped'
  startedAt: number
  endedAt: number
  error?: { code: string; message: string }
}

export type BffClient = {
  testAuth: () => Promise<'ok' | 'auth_failed' | 'error'>
  loginLocal: (password: string) => Promise<void>
  logoutLocal: () => Promise<void>
  getMe: () => Promise<boolean>
  listConversations: () => Promise<BffConversation[]>
  createConversation: (input: { title: string; peerId: string; conversationId?: string }) => Promise<BffConversation>
  deleteConversation: (conversationId: string) => Promise<void>
  setPinned: (conversationId: string, pinned: boolean) => Promise<boolean>
  listMessages: (conversationId: string, limit?: number) => Promise<BffMessage[]>
  sendText: (conversationId: string, text: string) => Promise<BffMessage>
  sendImage: (conversationId: string, input: { dataUrl: string; alt: string }) => Promise<BffMessage>
  sendFile: (conversationId: string, input: { name: string; mime: string; dataUrl: string }) => Promise<BffMessage>
  aiReply: (conversationId: string) => Promise<BffMessage>
  getAutomationStatus: () => Promise<boolean>
  setAutomationStatus: (automationEnabled: boolean) => Promise<boolean>
  listAutomationRuns: (limit?: number) => Promise<BffAutomationRun[]>
  callUpstream: (operationId: string, params: Record<string, unknown>) => Promise<unknown>
  hydrateMessage: (messageId: string) => Promise<BffMessage>
}

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
})

/**
 * 创建 BFF 客户端
 *
 * - 功能：封装对 `/api/*` 的调用与错误解析
 * - 约束：token 只用于请求头，不在任何日志/错误信息中输出
 */
export function createBffClient(opts: { baseUrl: string; token?: string | null }): BffClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const token = (opts.token ?? '').trim()
  const authHeader: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {}

  type HeaderRecord = Record<string, string>

  const toHeaderRecord = (input?: HeadersInit): HeaderRecord => {
    const out: HeaderRecord = {}
    if (!input) return out

    if (typeof Headers !== 'undefined' && input instanceof Headers) {
      input.forEach((value, key) => {
        out[key.toLowerCase()] = value
      })
      return out
    }

    if (Array.isArray(input)) {
      for (const pair of input) {
        const [key, value] = pair
        out[String(key).toLowerCase()] = String(value)
      }
      return out
    }

    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'undefined') continue
      out[key.toLowerCase()] = String(value)
    }
    return out
  }

  const buildHeaders = (extra?: HeadersInit): HeaderRecord => {
    // 约束：为兼容 fetch mock/单测，headers 使用 plain object（可通过 `.authorization` 读取）
    // 语义：authHeader 先写入，extra 可覆盖（与之前 Headers 合并逻辑一致）
    return { ...toHeaderRecord(authHeader), ...toHeaderRecord(extra) }
  }

  const callJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const resp = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: buildHeaders(init?.headers)
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      try {
        const parsed = errorSchema.parse(JSON.parse(text))
        throw new Error(`${parsed.error.code}: ${parsed.error.message}`)
      } catch {
        throw new Error(`HTTP_${resp.status}: ${text || 'request failed'}`.slice(0, 400))
      }
    }
    return (await resp.json()) as T
  }

  return {
    async testAuth() {
      try {
        const resp = await fetch(`${baseUrl}/api/conversations`, { headers: buildHeaders(), credentials: 'include' })
        if (resp.status === 401) return 'auth_failed'
        if (!resp.ok) return 'error'
        return 'ok'
      } catch {
        return 'error'
      }
    },
    async loginLocal(password) {
      await callJson<{ ok: true }>('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      })
    },
    async logoutLocal() {
      await callJson<{ ok: true }>('/api/auth/logout', { method: 'POST' })
    },
    async getMe() {
      try {
        const resp = await fetch(`${baseUrl}/api/auth/me`, { headers: buildHeaders(), credentials: 'include' })
        return resp.ok
      } catch {
        return false
      }
    },
    async listConversations() {
      const json = await callJson<{ conversations: BffConversation[] }>('/api/conversations')
      return json.conversations
    },
    async createConversation(input) {
      const json = await callJson<{ conversation: BffConversation }>('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      })
      return json.conversation
    },
    async deleteConversation(conversationId) {
      await callJson<{ ok: true }>(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
    },
    async setPinned(conversationId, pinned) {
      const json = await callJson<{ ok: true; pinned: boolean }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/pinned`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pinned })
        }
      )
      return json.pinned
    },
    async listMessages(conversationId, limit) {
      const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : ''
      const json = await callJson<{ messages: BffMessage[] }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages${qs}`
      )
      return json.messages
    },
    async sendText(conversationId, text) {
      const json = await callJson<{ message: BffMessage }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'text', text })
        }
      )
      return json.message
    },
    async sendImage(conversationId, input) {
      const json = await callJson<{ message: BffMessage }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'image', image: input })
        }
      )
      return json.message
    },
    async sendFile(conversationId, input) {
      const json = await callJson<{ message: BffMessage }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'file', file: input })
        }
      )
      return json.message
    },
    async aiReply(conversationId) {
      const json = await callJson<{ message: BffMessage }>(
        `/api/conversations/${encodeURIComponent(conversationId)}/ai-reply`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'persist' })
        }
      )
      return json.message
    },
    async getAutomationStatus() {
      const json = await callJson<{ automationEnabled: boolean }>('/api/automation/status')
      return json.automationEnabled
    },
    async setAutomationStatus(automationEnabled) {
      const json = await callJson<{ automationEnabled: boolean }>('/api/automation/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ automationEnabled })
      })
      return json.automationEnabled
    },
    async listAutomationRuns(limit?: number) {
      const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : ''
      const json = await callJson<{ runs: BffAutomationRun[] }>(`/api/automation/runs${qs}`)
      return json.runs
    },
    async callUpstream(operationId, params) {
      const json = await callJson<{ ok: true; data: unknown }>('/api/upstream/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId, params: params ?? {} })
      })
      return json.data
    },
    async hydrateMessage(messageId: string) {
      const json = await callJson<{ message: BffMessage }>(`/api/messages/${encodeURIComponent(messageId)}/hydrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      })
      return json.message
    }
  }
}
