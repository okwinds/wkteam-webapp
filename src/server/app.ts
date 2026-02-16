import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ServerConfig } from './config.js'
import { FileDb, makeId, type Conversation, type DbV1, type Message } from './db.js'
import { matchPath, parseUrl, readJsonBody, writeJson } from './http.js'
import { createOpenAiCompatClient } from './openaiClient.js'
import { loadWkteamCatalogMap } from './wkteamCatalog.js'

type AppDeps = {
  config: ServerConfig
  db: FileDb
  fetchImpl: typeof fetch
  nowMs: () => number
}

/**
 * 创建 BFF 应用（可测试）
 *
 * - 功能：返回一个可启动的 http server（路由/鉴权/存储/AI）
 * - 参数：依赖注入（config/db/fetch/clock）
 * - 返回：Node http server
 */
export async function createAppServer(
  deps: AppDeps
): Promise<{ server: Server; close: () => Promise<void>; drainAutomation: () => Promise<void> }> {
  let dbState: DbV1 = await deps.db.loadOrInit(deps.nowMs())
  const openai = createOpenAiCompatClient(deps.fetchImpl)
  let wkteamCatalog: Map<string, { operationId: string; method: string; path: string }> | null = null
  try {
    wkteamCatalog = await loadWkteamCatalogMap(deps.config.WKTEAM_CATALOG_PATH)
  } catch {
    // V0：允许在缺少 catalog 时启动（仅禁用上游代理能力）
    wkteamCatalog = null
  }

  const corsAllowOrigins = deps.config.CORS_ALLOW_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const requireApiAuth = (req: IncomingMessage) => {
    const auth = req.headers.authorization
    const expected = `Bearer ${deps.config.BFF_API_TOKEN}`
    return typeof auth === 'string' && auth === expected
  }

  const requireWebhookSecret = (req: IncomingMessage) => {
    const secret = req.headers['x-webhook-secret']
    return typeof secret === 'string' && secret === deps.config.WEBHOOK_SECRET
  }

  const persist = async () => {
    dbState = { ...dbState, updatedAt: deps.nowMs() }
    await deps.db.save(dbState)
  }

  let automationQueue: Promise<void> = Promise.resolve()
  const enqueueAutomation = (fn: () => Promise<void>) => {
    const run = automationQueue.then(fn)
    automationQueue = run.catch(() => {})
    return run
  }

  const drainAutomation = async () => {
    await automationQueue
  }

  const normalizeEpochMs = (ts: number | null | undefined, fallbackMs: number) => {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return fallbackMs
    // wkteam 文档样例为秒级时间戳（10 位），也可能是毫秒（13 位）；统一归一化为 ms
    return ts < 1_000_000_000_000 ? Math.trunc(ts * 1000) : Math.trunc(ts)
  }

  const parseWkConversationId = (conversationId: string) => {
    const m = /^wk:([^:]+):(u|g):(.+)$/.exec(conversationId)
    if (!m) return null
    return { wId: m[1], peerKind: m[2] as 'u' | 'g', peerId: m[3] }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = parseUrl(req)
    const { pathname } = url
    const method = (req.method ?? 'GET').toUpperCase()

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null
    const corsAllowed =
      origin != null && (corsAllowOrigins.includes('*') || corsAllowOrigins.includes(origin))
    if (corsAllowed) {
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('vary', 'origin')
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
      res.setHeader('access-control-allow-headers', 'authorization,content-type,x-webhook-secret')
    }
    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    if (method === 'GET' && pathname === '/healthz') {
      writeJson(res, 200, { ok: true, now: deps.nowMs() })
      return
    }

    if (pathname.startsWith('/api/')) {
      if (!requireApiAuth(req)) {
        writeJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'missing or invalid token' } })
        return
      }
    }

    if (pathname.startsWith('/webhooks/')) {
      const headerOk = requireWebhookSecret(req)
      const queryOk = url.searchParams.get('secret') === deps.config.WEBHOOK_SECRET
      if (!headerOk && !queryOk) {
        writeJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'missing or invalid webhook secret' } })
        return
      }
    }

    if (method === 'GET' && pathname === '/api/conversations') {
      const conversations = [...dbState.conversations].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.lastActivityAt - a.lastActivityAt
      })
      writeJson(res, 200, { conversations })
      return
    }

    if (method === 'POST' && pathname === '/api/conversations') {
      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }
      const parsed = z
        .object({
          title: z.string().min(1).max(40),
          peerId: z.string().min(1).max(80)
        })
        .safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid request body' } })
        return
      }

      const now = deps.nowMs()
      const conversation: Conversation = {
        id: makeId('c', now),
        title: parsed.data.title,
        peerId: parsed.data.peerId,
        pinned: false,
        unreadCount: 0,
        lastMessageId: null,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now
      }
      dbState.conversations = [conversation, ...dbState.conversations]
      await persist()
      writeJson(res, 200, { conversation })
      return
    }

    const conversationParams = matchPath('/api/conversations/:conversationId', pathname)
    if (conversationParams && method === 'DELETE') {
      const id = conversationParams.conversationId
      const exists = dbState.conversations.some((c) => c.id === id)
      if (!exists) {
        writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'conversation not found' } })
        return
      }
      dbState.conversations = dbState.conversations.filter((c) => c.id !== id)
      dbState.messages = dbState.messages.filter((m) => m.conversationId !== id)
      await persist()
      writeJson(res, 200, { ok: true })
      return
    }

    const pinnedParams = matchPath('/api/conversations/:conversationId/pinned', pathname)
    if (pinnedParams && method === 'POST') {
      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }
      const parsed = z.object({ pinned: z.boolean() }).safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid request body' } })
        return
      }
      const id = pinnedParams.conversationId
      const exists = dbState.conversations.some((c) => c.id === id)
      if (!exists) {
        writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'conversation not found' } })
        return
      }
      dbState.conversations = dbState.conversations.map((c) => (c.id === id ? { ...c, pinned: parsed.data.pinned } : c))
      await persist()
      writeJson(res, 200, { ok: true, pinned: parsed.data.pinned })
      return
    }

    const listMessagesParams = matchPath('/api/conversations/:conversationId/messages', pathname)
    if (listMessagesParams && method === 'GET') {
      const limitRaw = url.searchParams.get('limit')
      const limit = Math.max(1, Math.min(500, Number(limitRaw ?? '100') || 100))
      const messages = dbState.messages
        .filter((m) => m.conversationId === listMessagesParams.conversationId)
        .sort((a, b) => a.sentAt - b.sentAt)
        .slice(-limit)
      writeJson(res, 200, { messages })
      return
    }

    if (listMessagesParams && method === 'POST') {
      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }

      const baseSchema = z.object({ kind: z.union([z.literal('text'), z.literal('image'), z.literal('file')]) })
      const kindParsed = baseSchema.safeParse(body.value)
      if (!kindParsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid request body' } })
        return
      }

      const now = deps.nowMs()
      const id = makeId('m', now)
      const conversationId = listMessagesParams.conversationId

      const makeCommon = () => ({
        id,
        conversationId,
        direction: 'outbound' as const,
        source: 'human' as const,
        sentAt: now
      })

      let message: Message | null = null

      if (kindParsed.data.kind === 'text') {
        const parsed = z.object({ kind: z.literal('text'), text: z.string().min(1).max(500) }).safeParse(body.value)
        if (!parsed.success) {
          writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid text message' } })
          return
        }
        message = { ...makeCommon(), kind: 'text', text: parsed.data.text }
      }

      if (kindParsed.data.kind === 'image') {
        const parsed = z
          .object({
            kind: z.literal('image'),
            image: z.object({ dataUrl: z.string().min(1), alt: z.string().min(1).max(100) })
          })
          .safeParse(body.value)
        if (!parsed.success) {
          writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid image message' } })
          return
        }
        const sizeBytes = Buffer.byteLength(parsed.data.image.dataUrl, 'utf-8')
        if (sizeBytes > deps.config.MAX_DATAURL_BYTES) {
          writeJson(res, 400, { error: { code: 'DATAURL_TOO_LARGE', message: 'image dataUrl too large' } })
          return
        }
        message = { ...makeCommon(), kind: 'image', image: parsed.data.image }
      }

      if (kindParsed.data.kind === 'file') {
        const parsed = z
          .object({
            kind: z.literal('file'),
            file: z.object({
              name: z.string().min(1).max(200),
              mime: z.string().min(1).max(120),
              dataUrl: z.string().min(1)
            })
          })
          .safeParse(body.value)
        if (!parsed.success) {
          writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid file message' } })
          return
        }
        const sizeBytes = Buffer.byteLength(parsed.data.file.dataUrl, 'utf-8')
        if (sizeBytes > deps.config.MAX_DATAURL_BYTES) {
          writeJson(res, 400, { error: { code: 'DATAURL_TOO_LARGE', message: 'file dataUrl too large' } })
          return
        }
        message = { ...makeCommon(), kind: 'file', file: parsed.data.file }
      }

      if (!message) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'unsupported message kind' } })
        return
      }

      dbState.messages.push(message)
      dbState.conversations = dbState.conversations.map((c) => {
        if (c.id !== conversationId) return c
        return { ...c, lastMessageId: message.id, lastActivityAt: message.sentAt, updatedAt: now }
      })
      await persist()
      writeJson(res, 200, { message })
      return
    }

    if (method === 'GET' && pathname === '/api/automation/status') {
      writeJson(res, 200, { automationEnabled: dbState.automationEnabled })
      return
    }

    if (method === 'POST' && pathname === '/api/automation/status') {
      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }
      const parsed = z.object({ automationEnabled: z.boolean() }).safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid request body' } })
        return
      }
      dbState.automationEnabled = parsed.data.automationEnabled
      await persist()
      writeJson(res, 200, { automationEnabled: dbState.automationEnabled })
      return
    }

    if (method === 'POST' && pathname === '/api/upstream/call') {
      if (!wkteamCatalog) {
        writeJson(res, 503, { error: { code: 'WKTEAM_CATALOG_UNAVAILABLE', message: 'wkteam catalog unavailable' } })
        return
      }
      const upstreamBaseUrl = deps.config.UPSTREAM_BASE_URL.trim().replace(/\/$/, '')
      const upstreamAuth = deps.config.UPSTREAM_AUTHORIZATION.trim()
      if (!upstreamBaseUrl || !upstreamAuth) {
        writeJson(res, 503, { error: { code: 'UPSTREAM_NOT_CONFIGURED', message: 'upstream not configured' } })
        return
      }

      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }

      const parsed = z
        .object({
          operationId: z.string().min(1),
          params: z.record(z.string(), z.unknown())
        })
        .safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid request body' } })
        return
      }

      const ep = wkteamCatalog.get(parsed.data.operationId)
      if (!ep) {
        writeJson(res, 400, { error: { code: 'UNKNOWN_OPERATION_ID', message: 'unknown operationId' } })
        return
      }

      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), deps.config.UPSTREAM_TIMEOUT_MS)
      try {
        const resp = await deps.fetchImpl(`${upstreamBaseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            'content-type': 'application/json',
            [deps.config.UPSTREAM_AUTH_HEADER_NAME]: upstreamAuth
          },
          body: JSON.stringify(parsed.data.params),
          signal: controller.signal
        })

        const text = await resp.text().catch(() => '')
        if (!resp.ok) {
          writeJson(res, 502, {
            error: {
              code: 'UPSTREAM_HTTP_ERROR',
              message: `upstream http ${resp.status}`.slice(0, 120),
              detail: text.slice(0, 400)
            }
          })
          return
        }

        try {
          const json = text ? JSON.parse(text) : null
          writeJson(res, 200, { ok: true, data: json })
        } catch {
          writeJson(res, 200, { ok: true, data: text })
        }
        return
      } catch (e) {
        const isAbortError =
          typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError'
        if (isAbortError) {
          writeJson(res, 504, { error: { code: 'UPSTREAM_TIMEOUT', message: 'upstream timeout' } })
          return
        }
        const msg = e instanceof Error ? e.message : 'UPSTREAM_UNKNOWN_ERROR'
        writeJson(res, 502, { error: { code: 'UPSTREAM_NETWORK_ERROR', message: msg.slice(0, 200) } })
        return
      } finally {
        clearTimeout(t)
      }
    }

    const aiParams = matchPath('/api/conversations/:conversationId/ai-reply', pathname)
    if (aiParams && method === 'POST') {
      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }
      const parsed = z
        .object({
          mode: z.union([z.literal('return_only'), z.literal('persist')]).default('persist'),
          systemPrompt: z.string().max(2000).optional()
        })
        .safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid request body' } })
        return
      }

      const now = deps.nowMs()
      const conversationId = aiParams.conversationId
      const history = dbState.messages
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.sentAt - b.sentAt)
        .slice(-20)

      const messages = [
        ...(parsed.data.systemPrompt ? [{ role: 'system' as const, content: parsed.data.systemPrompt }] : []),
        ...history.map((m) => ({
          role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
          content: m.kind === 'text' ? m.text : m.kind === 'image' ? '[image]' : '[file]'
        }))
      ]

      try {
        const reply = await openai.chatCompletions({
          baseUrl: deps.config.OPENAI_BASE_URL,
          path: deps.config.OPENAI_PATH_CHAT_COMPLETIONS,
          apiKey: deps.config.OPENAI_API_KEY,
          model: deps.config.OPENAI_MODEL,
          timeoutMs: deps.config.OPENAI_TIMEOUT_MS,
          messages
        })

        if (parsed.data.mode === 'return_only') {
          writeJson(res, 200, { replyText: reply.content })
          return
        }

        const msgId = makeId('m', now)
        const aiMessage: Message = {
          id: msgId,
          conversationId,
          direction: 'outbound',
          source: 'ai',
          sentAt: now,
          kind: 'text',
          text: reply.content || '(empty)'
        }
        dbState.messages.push(aiMessage)
        dbState.conversations = dbState.conversations.map((c) => {
          if (c.id !== conversationId) return c
          return { ...c, lastMessageId: aiMessage.id, lastActivityAt: aiMessage.sentAt, updatedAt: now }
        })
        await persist()
        writeJson(res, 200, { message: aiMessage })
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI_UNKNOWN_ERROR'
        const code = msg.startsWith('AI_TIMEOUT') ? 'AI_TIMEOUT' : 'AI_UPSTREAM_ERROR'
        writeJson(res, code === 'AI_TIMEOUT' ? 504 : 502, { error: { code, message: msg } })
        return
      }
    }

    if (method === 'POST' && pathname === '/webhooks/wkteam/messages') {
      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }
      const parsed = z
        .object({
          dedupeKey: z.string().min(1).max(200),
          conversationId: z.string().min(1).max(120),
          text: z.string().min(1).max(2000).optional(),
          sentAt: z.number().optional(),
          raw: z.unknown().optional()
        })
        .safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid webhook body' } })
        return
      }

      if (dbState.webhookDedupeKeys[parsed.data.dedupeKey]) {
        writeJson(res, 200, { ok: true, deduped: true })
        return
      }

      const now = deps.nowMs()
      const conversationId = parsed.data.conversationId
      const messageId = makeId('m', now)
      const inbound: Message = {
        id: messageId,
        conversationId,
        direction: 'inbound',
        source: 'webhook',
        sentAt: parsed.data.sentAt ?? now,
        kind: 'text',
        text: parsed.data.text ?? '(empty)'
      }

      // 确保会话存在（V0：若不存在则创建一个占位会话）
      if (!dbState.conversations.some((c) => c.id === conversationId)) {
        const c: Conversation = {
          id: conversationId,
          title: `会话 ${conversationId.slice(0, 6)}`,
          peerId: 'unknown',
          pinned: false,
          unreadCount: 0,
          lastMessageId: null,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now
        }
        dbState.conversations.unshift(c)
      }

      dbState.messages.push(inbound)
      dbState.webhookDedupeKeys[parsed.data.dedupeKey] = inbound.id
      dbState.conversations = dbState.conversations.map((c) => {
        if (c.id !== conversationId) return c
        return { ...c, lastMessageId: inbound.id, lastActivityAt: inbound.sentAt, updatedAt: now }
      })

      await persist()

      // V0：若开启自动化，则直接触发一次 AI（最小通用策略：对任何新消息都回复）
      if (dbState.automationEnabled) {
        void enqueueAutomation(async () => {
          const runId = makeId('run', now)
          const startedAt = deps.nowMs()
          try {
            const reply = await openai.chatCompletions({
              baseUrl: deps.config.OPENAI_BASE_URL,
              path: deps.config.OPENAI_PATH_CHAT_COMPLETIONS,
              apiKey: deps.config.OPENAI_API_KEY,
              model: deps.config.OPENAI_MODEL,
              timeoutMs: deps.config.OPENAI_TIMEOUT_MS,
              messages: [{ role: 'user', content: inbound.text }]
            })
            const aiId = makeId('m', deps.nowMs())
            const aiMessage: Message = {
              id: aiId,
              conversationId,
              direction: 'outbound',
              source: 'ai',
              sentAt: deps.nowMs(),
              kind: 'text',
              text: reply.content || '(empty)'
            }
            dbState.messages.push(aiMessage)
            dbState.conversations = dbState.conversations.map((c) => {
              if (c.id !== conversationId) return c
              return { ...c, lastMessageId: aiMessage.id, lastActivityAt: aiMessage.sentAt, updatedAt: deps.nowMs() }
            })
            dbState.automationRuns.push({
              id: runId,
              trigger: 'webhook',
              conversationId,
              inputMessageId: inbound.id,
              outputMessageId: aiMessage.id,
              status: 'success',
              startedAt,
              endedAt: deps.nowMs(),
              model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
            })
            await persist()
          } catch (e) {
            dbState.automationRuns.push({
              id: runId,
              trigger: 'webhook',
              conversationId,
              inputMessageId: inbound.id,
              outputMessageId: null,
              status: 'failed',
              startedAt,
              endedAt: deps.nowMs(),
              error: { code: 'AI_UPSTREAM_ERROR', message: e instanceof Error ? e.message : 'AI_UNKNOWN_ERROR' },
              model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
            })
            await persist()
          }
        })
      }

      writeJson(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && pathname === '/webhooks/wkteam/callback') {
      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }

      const parsed = z
        .object({
          wcId: z.string().min(1).optional(),
          account: z.string().optional(),
          messageType: z.string().min(1),
          data: z.object({
            wId: z.string().min(1),
            fromUser: z.string().min(1),
            fromGroup: z.string().optional(),
            toUser: z.string().min(1),
            msgId: z.union([z.number(), z.string()]).optional(),
            newMsgId: z.union([z.number(), z.string()]).optional(),
            timestamp: z.union([z.number(), z.string()]).optional(),
            content: z.string().optional(),
            self: z.boolean().optional()
          })
        })
        .safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid wkteam callback body' } })
        return
      }

      const now = deps.nowMs()
      const wId = parsed.data.data.wId
      const messageType = parsed.data.messageType
      const self = parsed.data.data.self === true
      const fromGroup = parsed.data.data.fromGroup?.trim()
      const peerKind: 'u' | 'g' = fromGroup ? 'g' : 'u'
      const peerId =
        peerKind === 'g'
          ? fromGroup!
          : self
            ? parsed.data.data.toUser
            : parsed.data.data.fromUser

      const tsRaw = parsed.data.data.timestamp
      const tsNum = typeof tsRaw === 'string' ? Number(tsRaw) : tsRaw
      const sentAt = normalizeEpochMs(tsNum, now)

      const newMsgIdRaw = parsed.data.data.newMsgId ?? parsed.data.data.msgId ?? parsed.data.data.timestamp ?? now
      const dedupeKey = `wk:${wId}:${String(newMsgIdRaw)}`
      if (dbState.webhookDedupeKeys[dedupeKey]) {
        writeJson(res, 200, { ok: true, deduped: true })
        return
      }

      const conversationId = `wk:${wId}:${peerKind}:${peerId}`
      const messageId = makeId('m', now)
      const inboundText = parsed.data.data.content ?? '(empty)'
      const inbound: Message = {
        id: messageId,
        conversationId,
        direction: 'inbound',
        source: 'webhook',
        sentAt,
        kind: 'text',
        text: inboundText
      }

      if (!dbState.conversations.some((c) => c.id === conversationId)) {
        const c: Conversation = {
          id: conversationId,
          title: peerKind === 'g' ? `群聊 ${peerId}` : peerId,
          peerId,
          pinned: false,
          unreadCount: 0,
          lastMessageId: null,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now
        }
        dbState.conversations.unshift(c)
      }

      dbState.messages.push(inbound)
      dbState.webhookDedupeKeys[dedupeKey] = inbound.id
      dbState.conversations = dbState.conversations.map((c) => {
        if (c.id !== conversationId) return c
        return { ...c, lastMessageId: inbound.id, lastActivityAt: inbound.sentAt, updatedAt: now }
      })
      await persist()

      const shouldAutomate = dbState.automationEnabled && !self && (messageType === '60001' || messageType === '80001')
      if (shouldAutomate) {
        void enqueueAutomation(async () => {
          const runId = makeId('run', deps.nowMs())
          const startedAt = deps.nowMs()
          try {
            const reply = await openai.chatCompletions({
              baseUrl: deps.config.OPENAI_BASE_URL,
              path: deps.config.OPENAI_PATH_CHAT_COMPLETIONS,
              apiKey: deps.config.OPENAI_API_KEY,
              model: deps.config.OPENAI_MODEL,
              timeoutMs: deps.config.OPENAI_TIMEOUT_MS,
              messages: [{ role: 'user', content: inbound.text }]
            })
            const aiId = makeId('m', deps.nowMs())
            const aiMessage: Message = {
              id: aiId,
              conversationId,
              direction: 'outbound',
              source: 'ai',
              sentAt: deps.nowMs(),
              kind: 'text',
              text: reply.content || '(empty)'
            }
            dbState.messages.push(aiMessage)
            dbState.conversations = dbState.conversations.map((c) => {
              if (c.id !== conversationId) return c
              return { ...c, lastMessageId: aiMessage.id, lastActivityAt: aiMessage.sentAt, updatedAt: deps.nowMs() }
            })
            await persist()

            if (!wkteamCatalog) {
              dbState.automationRuns.push({
                id: runId,
                trigger: 'webhook',
                conversationId,
                inputMessageId: inbound.id,
                outputMessageId: aiMessage.id,
                status: 'failed',
                startedAt,
                endedAt: deps.nowMs(),
                error: { code: 'WKTEAM_CATALOG_UNAVAILABLE', message: 'wkteam catalog unavailable' },
                model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
              })
              await persist()
              return
            }

            const upstreamBaseUrl = deps.config.UPSTREAM_BASE_URL.trim().replace(/\/$/, '')
            const upstreamAuth = deps.config.UPSTREAM_AUTHORIZATION.trim()
            if (!upstreamBaseUrl || !upstreamAuth) {
              dbState.automationRuns.push({
                id: runId,
                trigger: 'webhook',
                conversationId,
                inputMessageId: inbound.id,
                outputMessageId: aiMessage.id,
                status: 'failed',
                startedAt,
                endedAt: deps.nowMs(),
                error: { code: 'UPSTREAM_NOT_CONFIGURED', message: 'upstream not configured' },
                model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
              })
              await persist()
              return
            }

            const info = parseWkConversationId(conversationId)
            if (!info) {
              dbState.automationRuns.push({
                id: runId,
                trigger: 'webhook',
                conversationId,
                inputMessageId: inbound.id,
                outputMessageId: aiMessage.id,
                status: 'failed',
                startedAt,
                endedAt: deps.nowMs(),
                error: { code: 'BAD_CONVERSATION_ID', message: 'invalid wk conversationId' },
                model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
              })
              await persist()
              return
            }

            const ep = wkteamCatalog.get('xiao_xi_fa_song_fa_song_wen_ben_xiao_xi')
            if (!ep) {
              dbState.automationRuns.push({
                id: runId,
                trigger: 'webhook',
                conversationId,
                inputMessageId: inbound.id,
                outputMessageId: aiMessage.id,
                status: 'failed',
                startedAt,
                endedAt: deps.nowMs(),
                error: { code: 'UNKNOWN_OPERATION_ID', message: 'sendText operationId not found in catalog' },
                model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
              })
              await persist()
              return
            }

            const controller = new AbortController()
            const t = setTimeout(() => controller.abort(), deps.config.UPSTREAM_TIMEOUT_MS)
            try {
              const resp = await deps.fetchImpl(`${upstreamBaseUrl}${ep.path}`, {
                method: ep.method,
                headers: {
                  'content-type': 'application/json',
                  [deps.config.UPSTREAM_AUTH_HEADER_NAME]: upstreamAuth
                },
                body: JSON.stringify({ wId: info.wId, wcId: info.peerId, content: aiMessage.text }),
                signal: controller.signal
              })
              if (!resp.ok) {
                const text = await resp.text().catch(() => '')
                dbState.automationRuns.push({
                  id: runId,
                  trigger: 'webhook',
                  conversationId,
                  inputMessageId: inbound.id,
                  outputMessageId: aiMessage.id,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'UPSTREAM_SEND_FAILED', message: `upstream http ${resp.status}: ${text}`.slice(0, 200) },
                  model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
                })
                await persist()
                return
              }
            } catch (e) {
              const isAbortError =
                typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError'
              dbState.automationRuns.push({
                id: runId,
                trigger: 'webhook',
                conversationId,
                inputMessageId: inbound.id,
                outputMessageId: aiMessage.id,
                status: 'failed',
                startedAt,
                endedAt: deps.nowMs(),
                error: {
                  code: isAbortError ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_SEND_FAILED',
                  message: e instanceof Error ? e.message : 'UPSTREAM_UNKNOWN_ERROR'
                },
                model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
              })
              await persist()
              return
            } finally {
              clearTimeout(t)
            }

            dbState.automationRuns.push({
              id: runId,
              trigger: 'webhook',
              conversationId,
              inputMessageId: inbound.id,
              outputMessageId: aiMessage.id,
              status: 'success',
              startedAt,
              endedAt: deps.nowMs(),
              model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
            })
            await persist()
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'AI_UNKNOWN_ERROR'
            const code = msg.startsWith('AI_TIMEOUT') ? 'AI_TIMEOUT' : 'AI_UPSTREAM_ERROR'
            dbState.automationRuns.push({
              id: runId,
              trigger: 'webhook',
              conversationId,
              inputMessageId: inbound.id,
              outputMessageId: null,
              status: 'failed',
              startedAt,
              endedAt: deps.nowMs(),
              error: { code, message: msg },
              model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
            })
            await persist()
          }
        })
      }

      writeJson(res, 200, { ok: true })
      return
    }

    writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
  }

  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((e) => {
      writeJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'unknown error' } })
    })
  })

  return {
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      }),
    drainAutomation
  }
}
