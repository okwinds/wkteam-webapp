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

export type BffClient = {
  testAuth: () => Promise<'ok' | 'auth_failed' | 'error'>
  listConversations: () => Promise<BffConversation[]>
  createConversation: (input: { title: string; peerId: string }) => Promise<BffConversation>
  deleteConversation: (conversationId: string) => Promise<void>
  setPinned: (conversationId: string, pinned: boolean) => Promise<boolean>
  listMessages: (conversationId: string, limit?: number) => Promise<BffMessage[]>
  sendText: (conversationId: string, text: string) => Promise<BffMessage>
  sendImage: (conversationId: string, input: { dataUrl: string; alt: string }) => Promise<BffMessage>
  sendFile: (conversationId: string, input: { name: string; mime: string; dataUrl: string }) => Promise<BffMessage>
  aiReply: (conversationId: string) => Promise<BffMessage>
  getAutomationStatus: () => Promise<boolean>
  setAutomationStatus: (automationEnabled: boolean) => Promise<boolean>
  callUpstream: (operationId: string, params: Record<string, unknown>) => Promise<unknown>
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
export function createBffClient(opts: { baseUrl: string; token: string }): BffClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, '')
  const authHeader = { authorization: `Bearer ${opts.token}` }

  const callJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const resp = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...authHeader,
        ...(init?.headers ?? {})
      }
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
        const resp = await fetch(`${baseUrl}/api/conversations`, { headers: authHeader })
        if (resp.status === 401) return 'auth_failed'
        if (!resp.ok) return 'error'
        return 'ok'
      } catch {
        return 'error'
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
    async callUpstream(operationId, params) {
      const json = await callJson<{ ok: true; data: unknown }>('/api/upstream/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId, params: params ?? {} })
      })
      return json.data
    }
  }
}
