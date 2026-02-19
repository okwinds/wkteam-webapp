import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
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

  const sessionCookieName = 'wkteam_session'
  const loginPassword = (deps.config.LOCAL_LOGIN_PASSWORD || '').trim() || deps.config.BFF_API_TOKEN
  const sessions = new Map<string, { createdAt: number }>()

  const parseCookieHeader = (header: string | null) => {
    if (!header) return new Map<string, string>()
    const out = new Map<string, string>()
    for (const part of header.split(';')) {
      const raw = part.trim()
      if (!raw) continue
      const idx = raw.indexOf('=')
      if (idx < 0) continue
      const k = raw.slice(0, idx).trim()
      const v = raw.slice(idx + 1).trim()
      if (!k) continue
      try {
        out.set(k, decodeURIComponent(v))
      } catch {
        out.set(k, v)
      }
    }
    return out
  }

  const pickSessionId = (req: IncomingMessage) => {
    const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : null
    const cookies = parseCookieHeader(cookieHeader)
    const sid = cookies.get(sessionCookieName)
    return typeof sid === 'string' && sid.trim() ? sid.trim() : null
  }

  const requireSessionAuth = (req: IncomingMessage) => {
    const sid = pickSessionId(req)
    return sid != null && sessions.has(sid)
  }

  const requireApiAuth = (req: IncomingMessage) => {
    const auth = req.headers.authorization
    const expected = `Bearer ${deps.config.BFF_API_TOKEN}`
    if (typeof auth === 'string' && auth === expected) return true
    return requireSessionAuth(req)
  }

  const requireWebhookSecret = (req: IncomingMessage) => {
    const secret = req.headers['x-webhook-secret']
    return typeof secret === 'string' && secret === deps.config.WEBHOOK_SECRET
  }

  const webhookIpAllowlist = deps.config.WEBHOOK_IP_ALLOWLIST.split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const webhookRateLimitPerMin = Number.isFinite(deps.config.WEBHOOK_RATE_LIMIT_PER_MIN)
    ? deps.config.WEBHOOK_RATE_LIMIT_PER_MIN
    : 0

  const webhookRateState = new Map<string, { windowStart: number; count: number }>()

  const pickClientIp = (req: IncomingMessage) => {
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string') {
      const first = xff.split(',')[0]?.trim()
      if (first) return first
    }
    const ra = req.socket.remoteAddress
    return typeof ra === 'string' && ra.trim() ? ra.trim() : null
  }

  const normalizeIp = (ip: string) => {
    let v = ip.trim()
    if (v.startsWith('::ffff:')) v = v.slice('::ffff:'.length)
    const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(v)
    if (m?.[1]) v = m[1]
    return v
  }

  const persist = async () => {
    dbState = { ...dbState, updatedAt: deps.nowMs() }
    await deps.db.save(dbState)
  }

  const sseClients = new Set<ServerResponse>()

  const writeSse = (res: ServerResponse, event: string, data: unknown) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const emitMessageCreated = (message: Message) => {
    if (sseClients.size === 0) return
    const payload = { conversationId: message.conversationId, messageId: message.id, kind: message.kind, ts: deps.nowMs() }
    for (const client of sseClients) {
      try {
        writeSse(client, 'message.created', payload)
      } catch {
        sseClients.delete(client)
      }
    }
  }

  const emitMessageUpdated = (message: Message) => {
    if (sseClients.size === 0) return
    const payload = { conversationId: message.conversationId, messageId: message.id, kind: message.kind, ts: deps.nowMs() }
    for (const client of sseClients) {
      try {
        writeSse(client, 'message.updated', payload)
      } catch {
        sseClients.delete(client)
      }
    }
  }

  const emitConversationChanged = (conversationId: string, action: 'created' | 'updated' | 'deleted') => {
    if (sseClients.size === 0) return
    const payload = { conversationId, action, ts: deps.nowMs() }
    for (const client of sseClients) {
      try {
        writeSse(client, 'conversation.changed', payload)
      } catch {
        sseClients.delete(client)
      }
    }
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

  const isValidWkConversationId = (conversationId: string) => {
    if (conversationId.length > 120) return false
    return parseWkConversationId(conversationId) != null
  }

  const pickStringByKeyAliases = (root: unknown, keys: string[]) => {
    const want = new Set(keys.map((k) => k.toLowerCase()))
    const queue: Array<{ v: unknown; depth: number }> = [{ v: root, depth: 0 }]
    const seen = new Set<any>()
    let steps = 0
    while (queue.length > 0 && steps < 2000) {
      steps += 1
      const cur = queue.shift()!
      if (cur.depth > 6) continue
      const v: any = cur.v
      if (!v || typeof v !== 'object') continue
      if (seen.has(v)) continue
      seen.add(v)
      for (const [k, child] of Object.entries(v)) {
        if (want.has(k.toLowerCase()) && typeof child === 'string') {
          const s = child.trim()
          if (s) return s
        }
        if (child && typeof child === 'object') queue.push({ v: child, depth: cur.depth + 1 })
      }
    }
    return null
  }

  const normalizeBase64 = (input: string) => {
    let s = input.trim()
    if (!s) return null
    if (s.startsWith('data:')) {
      const m = /^data:[^;]+;base64,([\s\S]+)$/i.exec(s)
      s = (m?.[1] ?? '').trim()
    }
    s = s.replace(/\s+/g, '')
    if (!s) return null
    // 允许 base64 与 base64url（兼容上游差异）
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null
    if (s.length < 4) return null
    return s
  }

  const extractHydrateParamsFromRaw = (raw: string | null | undefined) => {
    if (!raw) return { cdnUrl: null as string | null, aeskey: null as string | null }
    const tryParse = () => {
      const t = raw.trim()
      if (!t.startsWith('{') && !t.startsWith('[')) return null
      try {
        return JSON.parse(t) as unknown
      } catch {
        return null
      }
    }
    const obj = tryParse()

    const cdnUrl =
      (obj ? pickStringByKeyAliases(obj, ['cdnUrl', 'cdn_url', 'url', 'path']) : null) ??
      (() => {
        const m = /(?:cdnUrl|cdn_url)\s*["']?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i.exec(raw)
        if (m?.[1]) return m[1]
        const u = /(https?:\/\/[^\s"'<>]+)\b/i.exec(raw)
        return u?.[1] ?? null
      })()

    const aeskey =
      (obj ? pickStringByKeyAliases(obj, ['aeskey', 'aesKey', 'aes_key']) : null) ??
      (() => {
        const m = /(?:aeskey|aesKey|aes_key)\s*["']?\s*[:=]\s*["']([^"']+)["']/i.exec(raw)
        return m?.[1] ?? null
      })()

    return { cdnUrl: cdnUrl?.trim() || null, aeskey: aeskey?.trim() || null }
  }

  const extractBase64FromUpstreamResponse = (data: unknown) => {
    if (typeof data === 'string') return normalizeBase64(data)
    if (!data || typeof data !== 'object') return null
    const s =
      pickStringByKeyAliases(data, ['base64', 'fileBase64', 'content', 'data']) ??
      (() => {
        const v: any = data as any
        const nested =
          (v?.data && typeof v.data === 'object' ? pickStringByKeyAliases(v.data, ['base64', 'fileBase64', 'content']) : null) ?? null
        return nested
      })()
    return typeof s === 'string' ? normalizeBase64(s) : null
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = parseUrl(req)
    let pathname = url.pathname
    const method = (req.method ?? 'GET').toUpperCase()

    // 兼容：/webhooks/<secret>/wkteam/* 形态（剥离 path secret，路由归一到原路径，避免破坏现有 handler）
    let pathSecret: string | null = null
    if (pathname.startsWith('/webhooks/')) {
      const segs = pathname.split('/').filter(Boolean)
      // segs: ["webhooks", <maybeSecret>, "wkteam", ...]
      if (segs.length >= 4 && segs[0] === 'webhooks' && segs[2] === 'wkteam') {
        const raw = segs[1] ?? ''
        try {
          pathSecret = decodeURIComponent(raw)
        } catch {
          pathSecret = raw
        }
        pathname = `/${['webhooks', ...segs.slice(2)].join('/')}`
      }
    }

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
      const queryToken = url.searchParams.get('token')
      const isAuthRoute = pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/auth/me'
      if (!isAuthRoute) {
        const ok =
          pathname === '/api/events'
            ? requireApiAuth(req) || queryToken === deps.config.BFF_API_TOKEN
            : requireApiAuth(req)
        if (!ok) {
          writeJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'missing or invalid token' } })
          return
        }
      }
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJsonBody(req, deps.config.MAX_BODY_BYTES)
      if (!body.ok) {
        writeJson(res, 400, { error: body.error })
        return
      }
      const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid request body' } })
        return
      }
      if (parsed.data.password !== loginPassword) {
        writeJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'invalid password' } })
        return
      }

      const sid = randomUUID()
      sessions.set(sid, { createdAt: deps.nowMs() })
      res.setHeader(
        'set-cookie',
        `${sessionCookieName}=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`
      )
      writeJson(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const sid = pickSessionId(req)
      if (sid) sessions.delete(sid)
      res.setHeader('set-cookie', `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
      writeJson(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && pathname === '/api/auth/me') {
      const ok = requireApiAuth(req)
      if (!ok) {
        writeJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'not logged in' } })
        return
      }
      writeJson(res, 200, { ok: true })
      return
    }

    if (pathname.startsWith('/webhooks/')) {
      const ipRaw = pickClientIp(req)
      const ip = ipRaw ? normalizeIp(ipRaw) : null

      if (webhookIpAllowlist.length > 0) {
        if (!ip || !webhookIpAllowlist.includes(ip)) {
          writeJson(res, 403, { error: { code: 'FORBIDDEN', message: 'webhook ip not allowlisted' } })
          return
        }
      }

      if (webhookRateLimitPerMin > 0) {
        const key = ip ?? 'unknown'
        const windowStart = Math.floor(deps.nowMs() / 60_000) * 60_000
        const cur = webhookRateState.get(key)
        if (!cur || cur.windowStart !== windowStart) {
          webhookRateState.set(key, { windowStart, count: 1 })
        } else {
          cur.count += 1
        }
        const next = webhookRateState.get(key)!
        if (next.count > webhookRateLimitPerMin) {
          writeJson(res, 429, { error: { code: 'RATE_LIMITED', message: 'webhook rate limit exceeded' } })
          return
        }
      }

      const headerOk = requireWebhookSecret(req)
      const queryOk = url.searchParams.get('secret') === deps.config.WEBHOOK_SECRET
      const pathOk = typeof pathSecret === 'string' && pathSecret === deps.config.WEBHOOK_SECRET
      if (!headerOk && !queryOk && !pathOk) {
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

    if (method === 'GET' && pathname === '/api/events') {
      res.statusCode = 200
      res.setHeader('content-type', 'text/event-stream; charset=utf-8')
      res.setHeader('cache-control', 'no-cache')
      res.setHeader('connection', 'keep-alive')

      req.socket.setTimeout(0)
      res.write(': ok\n\n')

      sseClients.add(res)
      const heartbeat = setInterval(() => {
        try {
          res.write(`: ping ${deps.nowMs()}\n\n`)
        } catch {
          // ignore
        }
      }, 15000)
      ;(heartbeat as any).unref?.()

      req.on('close', () => {
        clearInterval(heartbeat)
        sseClients.delete(res)
      })
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
          peerId: z.string().min(1).max(80),
          conversationId: z.string().min(1).max(120).optional()
        })
        .safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid request body' } })
        return
      }

      const requestedConversationId = parsed.data.conversationId?.trim() ?? null
      if (requestedConversationId && !isValidWkConversationId(requestedConversationId)) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid conversationId' } })
        return
      }

      const requestedWk = requestedConversationId ? parseWkConversationId(requestedConversationId) : null
      if (requestedWk && requestedWk.peerId !== parsed.data.peerId) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'peerId not match conversationId' } })
        return
      }

      if (requestedConversationId) {
        const existed = dbState.conversations.find((c) => c.id === requestedConversationId)
        if (existed) {
          writeJson(res, 200, { conversation: existed })
          return
        }
      }

      const now = deps.nowMs()
      const conversation: Conversation = {
        id: requestedConversationId ?? makeId('c', now),
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
      emitConversationChanged(conversation.id, 'created')
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
      emitConversationChanged(id, 'deleted')
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
      emitConversationChanged(id, 'updated')
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
      emitMessageCreated(message)

      const wkInfo = message.kind === 'text' ? parseWkConversationId(conversationId) : null
      if (message.kind === 'text' && wkInfo) {
        const upstreamBaseUrl = deps.config.UPSTREAM_BASE_URL.trim().replace(/\/$/, '')
        const upstreamAuth = deps.config.UPSTREAM_AUTHORIZATION.trim()
        if (wkteamCatalog && upstreamBaseUrl && upstreamAuth) {
          const inputMessageId = message.id
          const content = message.text
          void enqueueAutomation(async () => {
            const runId = makeId('run', deps.nowMs())
            const startedAt = deps.nowMs()
            const sendTextEp = wkteamCatalog.get('xiao_xi_fa_song_fa_song_wen_ben_xiao_xi')
            if (!sendTextEp) {
              dbState.automationRuns.push({
                id: runId,
                trigger: 'human_send',
                conversationId,
                inputMessageId,
                outputMessageId: inputMessageId,
                status: 'failed',
                startedAt,
                endedAt: deps.nowMs(),
                error: { code: 'UNKNOWN_OPERATION_ID', message: 'sendText operationId not found in catalog' }
              })
              await persist()
              return
            }
            const controller = new AbortController()
            const t = setTimeout(() => controller.abort(), deps.config.UPSTREAM_TIMEOUT_MS)
            try {
              const resp = await deps.fetchImpl(`${upstreamBaseUrl}${sendTextEp.path}`, {
                method: sendTextEp.method,
                headers: {
                  'content-type': 'application/json',
                  [deps.config.UPSTREAM_AUTH_HEADER_NAME]: upstreamAuth
                },
                body: JSON.stringify({ wId: wkInfo.wId, wcId: wkInfo.peerId, content }),
                signal: controller.signal
              })
              const text = await resp.text().catch(() => '')

              dbState.automationRuns.push(
                resp.ok
                  ? {
                      id: runId,
                      trigger: 'human_send',
                      conversationId,
                      inputMessageId,
                      outputMessageId: inputMessageId,
                      status: 'success',
                      startedAt,
                      endedAt: deps.nowMs()
                    }
                  : {
                      id: runId,
                      trigger: 'human_send',
                      conversationId,
                      inputMessageId,
                      outputMessageId: inputMessageId,
                      status: 'failed',
                      startedAt,
                      endedAt: deps.nowMs(),
                      error: {
                        code: 'UPSTREAM_HTTP_ERROR',
                        message: `upstream http ${resp.status}: ${text}`.slice(0, 200)
                      }
                    }
              )
            } catch (e) {
              const isAbortError =
                typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError'
              dbState.automationRuns.push({
                id: runId,
                trigger: 'human_send',
                conversationId,
                inputMessageId,
                outputMessageId: inputMessageId,
                status: 'failed',
                startedAt,
                endedAt: deps.nowMs(),
                error: {
                  code: isAbortError ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR',
                  message: (e instanceof Error ? e.message : 'UPSTREAM_UNKNOWN_ERROR').slice(0, 200)
                }
              })
            } finally {
              clearTimeout(t)
              await persist()
            }
          })
        }
      }
      writeJson(res, 200, { message })
      return
    }

    const hydrateParams = matchPath('/api/messages/:messageId/hydrate', pathname)
    if (hydrateParams && method === 'POST') {
      const messageId = hydrateParams.messageId
      const idx = dbState.messages.findIndex((m) => m.id === messageId)
      if (idx < 0) {
        writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'message not found' } })
        return
      }

      const msg = dbState.messages[idx]!
      if (msg.kind !== 'image' && msg.kind !== 'file') {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'only image/file messages can be hydrated' } })
        return
      }

      const existingDataUrl = msg.kind === 'image' ? msg.image.dataUrl : msg.file.dataUrl
      if (existingDataUrl.startsWith('data:')) {
        writeJson(res, 200, { ok: true, message: msg })
        return
      }

      const info = parseWkConversationId(msg.conversationId)
      if (!info) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid wk conversationId' } })
        return
      }

      const { cdnUrl, aeskey } = extractHydrateParamsFromRaw(msg.raw)
      if (!cdnUrl || !/^https?:\/\//i.test(cdnUrl)) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'missing or invalid cdnUrl in message.raw' } })
        return
      }
      if (!aeskey) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'missing aeskey in message.raw' } })
        return
      }

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
      const ep = wkteamCatalog.get('te_shu_cdnDownFile')
      if (!ep) {
        writeJson(res, 503, { error: { code: 'UNKNOWN_OPERATION_ID', message: 'te_shu_cdnDownFile operationId not found in catalog' } })
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
          body: JSON.stringify({ wId: info.wId, cdnUrl, aeskey, fileType: msg.kind }),
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

        let data: unknown = text
        try {
          data = text ? JSON.parse(text) : null
        } catch {
          // keep text
        }

        const base64 = extractBase64FromUpstreamResponse(data)
        if (!base64) {
          writeJson(res, 502, { error: { code: 'UPSTREAM_BAD_RESPONSE', message: 'missing base64 in upstream response' } })
          return
        }

        const mime =
          msg.kind === 'file'
            ? msg.file.mime || 'application/octet-stream'
            : msg.kind === 'image'
              ? 'image/jpeg'
              : 'application/octet-stream'

        const nextDataUrl = `data:${mime};base64,${base64}`
        const sizeBytes = Buffer.byteLength(nextDataUrl, 'utf-8')
        if (sizeBytes > deps.config.MAX_DATAURL_BYTES) {
          writeJson(res, 400, { error: { code: 'DATAURL_TOO_LARGE', message: 'hydrated dataUrl too large' } })
          return
        }

        const nextMessage: Message =
          msg.kind === 'image'
            ? { ...msg, image: { ...msg.image, dataUrl: nextDataUrl } }
            : { ...msg, file: { ...msg.file, dataUrl: nextDataUrl } }

        dbState.messages[idx] = nextMessage
        await persist()
        emitMessageUpdated(nextMessage)
        writeJson(res, 200, { ok: true, message: nextMessage })
        return
      } catch (e) {
        const isAbortError = typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError'
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

    if (method === 'GET' && pathname === '/api/automation/status') {
      writeJson(res, 200, { automationEnabled: dbState.automationEnabled })
      return
    }

    if (method === 'GET' && pathname === '/api/automation/runs') {
      const limitRaw = url.searchParams.get('limit')
      const limitParsed = limitRaw == null ? 50 : Number(limitRaw)
      const safeLimit = Number.isFinite(limitParsed) ? Math.trunc(limitParsed) : 50
      const limit = Math.max(1, Math.min(200, safeLimit))
      const runs = [...dbState.automationRuns].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
      writeJson(res, 200, { runs })
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
        emitMessageCreated(aiMessage)
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
      emitMessageCreated(inbound)

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
            emitMessageCreated(aiMessage)
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

      const rawPayload = body.value
      let raw = ''
      let rawTruncated = false
      try {
        raw = JSON.stringify(rawPayload)
        if (Buffer.byteLength(raw, 'utf-8') > deps.config.MAX_WEBHOOK_RAW_BYTES) {
          rawTruncated = true
          raw = Buffer.from(raw, 'utf-8').subarray(0, deps.config.MAX_WEBHOOK_RAW_BYTES).toString('utf-8')
        }
      } catch {
        raw = '"(raw stringify failed)"'
        rawTruncated = true
      }

      const parsed = z
        .object({
          wcId: z.string().min(1).optional(),
          account: z.string().optional(),
          messageType: z.string().min(1),
          data: z
            .object({
            wId: z.string().min(1),
            fromUser: z.string().min(1),
            fromGroup: z.string().optional(),
            toUser: z.string().min(1),
            msgId: z.union([z.number(), z.string()]).optional(),
            newMsgId: z.union([z.number(), z.string()]).optional(),
            timestamp: z.union([z.number(), z.string()]).optional(),
            content: z.unknown().optional(),
            self: z.boolean().optional()
          })
            .passthrough()
        })
        .passthrough()
        .safeParse(body.value)
      if (!parsed.success) {
        writeJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'invalid wkteam callback body' } })
        return
      }

      const pickStringByPaths = (root: unknown, paths: Array<readonly string[]>) => {
        for (const path of paths) {
          let cur: any = root
          for (const k of path) {
            if (cur == null || typeof cur !== 'object') {
              cur = undefined
              break
            }
            cur = (cur as any)[k]
          }
          if (typeof cur === 'string') {
            const v = cur.trim()
            if (v) return v
          }
        }
        return null
      }

      const pickHttpUrl = (root: unknown) => {
        const v = pickStringByPaths(root, [
          ['data', 'url'],
          ['data', 'path'],
          ['data', 'content'],
          ['data', 'cdnUrl'],
          ['url'],
          ['path'],
          ['content']
        ])
        if (!v) return null
        return /^https?:\/\//i.test(v) ? v : null
      }

      const isLikelyBase64 = (s: string) => {
        const v = s.trim()
        if (v.length < 128) return false
        if (v.startsWith('data:')) return false
        if (v.includes('<') || v.includes('>')) return false
        return /^[A-Za-z0-9+/=\r\n]+$/.test(v)
      }

      const pickXmlTitle = (xml: string) => {
        const m = /<title>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/title>/i.exec(xml)
        const v = (m?.[1] ?? m?.[2] ?? '').trim()
        return v || null
      }

      const inferFileNameFromUrlOrPath = (input: string | null) => {
        if (!input) return null
        try {
          const u = new URL(input)
          const last = u.pathname.split('/').filter(Boolean).slice(-1)[0]
          return last ? decodeURIComponent(last) : null
        } catch {
          const last = input.split('/').filter(Boolean).slice(-1)[0]
          return last || null
        }
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
      const kind: Message['kind'] =
        messageType === '60001' || messageType === '80001'
          ? 'text'
          : messageType === '60002' || messageType === '80002'
            ? 'image'
            : messageType === '60008' || messageType === '80008'
              ? 'file'
              : 'text'

      const common = {
        id: messageId,
        conversationId,
        direction: 'inbound' as const,
        source: 'webhook' as const,
        sentAt,
        raw,
        rawTruncated
      }

      let inbound: Message
      if (kind === 'text') {
        const contentStr = typeof parsed.data.data.content === 'string' ? parsed.data.data.content : null
        const inboundText = contentStr?.trim() ? contentStr : messageType === '60001' || messageType === '80001' ? '(empty)' : '[unsupported messageType]'
        inbound = { ...common, kind: 'text', text: inboundText }
      } else if (kind === 'image') {
        const url = pickHttpUrl(rawPayload)
        const contentStr = pickStringByPaths(rawPayload, [['data', 'content'], ['content']])
        const fileName = pickStringByPaths(rawPayload, [['data', 'fileName'], ['data', 'filename'], ['data', 'name']]) ?? inferFileNameFromUrlOrPath(url)
        const dataUrl =
          url ??
          (contentStr && contentStr.startsWith('data:') ? contentStr : null) ??
          (contentStr && isLikelyBase64(contentStr) ? `data:image/jpeg;base64,${contentStr.trim()}` : null) ??
          ''
        inbound = {
          ...common,
          kind: 'image',
          image: { dataUrl, alt: fileName ?? '图片' }
        }
      } else {
        const url = pickHttpUrl(rawPayload)
        const contentStr = pickStringByPaths(rawPayload, [['data', 'content'], ['content']])
        const xmlTitle = contentStr ? pickXmlTitle(contentStr) : null
        const fileName =
          pickStringByPaths(rawPayload, [['data', 'fileName'], ['data', 'filename'], ['data', 'name']]) ??
          xmlTitle ??
          inferFileNameFromUrlOrPath(url) ??
          'unknown.bin'

        const mimeFromDataUrl = (() => {
          if (!contentStr || !contentStr.startsWith('data:')) return null
          const m = /^data:([^;]+);base64,/i.exec(contentStr)
          return m?.[1]?.trim() || null
        })()

        const mime =
          pickStringByPaths(rawPayload, [['data', 'mime'], ['data', 'contentType'], ['mime'], ['contentType']]) ??
          mimeFromDataUrl ??
          'application/octet-stream'

        const dataUrl =
          url ??
          (contentStr && contentStr.startsWith('data:') ? contentStr : null) ??
          (contentStr && isLikelyBase64(contentStr) ? `data:${mime};base64,${contentStr.trim()}` : null) ??
          ''

        inbound = {
          ...common,
          kind: 'file',
          file: { name: fileName, mime, dataUrl }
        }
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
      emitMessageCreated(inbound)

      const shouldAutomate =
        dbState.automationEnabled &&
        !self &&
        (messageType === '60001' ||
          messageType === '80001' ||
          messageType === '60002' ||
          messageType === '80002' ||
          messageType === '60008' ||
          messageType === '80008')

      if (shouldAutomate) {
        void enqueueAutomation(async () => {
          const runId = makeId('run', deps.nowMs())
          const startedAt = deps.nowMs()
          try {
	            const sendUpstreamJson = async (opts: {
	              upstreamBaseUrl: string
	              upstreamAuth: string
	              ep: { method: string; path: string }
	              params: unknown
	            }) => {
              const controller = new AbortController()
              const t = setTimeout(() => controller.abort(), deps.config.UPSTREAM_TIMEOUT_MS)
              try {
                const resp = await deps.fetchImpl(`${opts.upstreamBaseUrl}${opts.ep.path}`, {
                  method: opts.ep.method,
                  headers: {
                    'content-type': 'application/json',
                    [deps.config.UPSTREAM_AUTH_HEADER_NAME]: opts.upstreamAuth
                  },
                  body: JSON.stringify(opts.params),
                  signal: controller.signal
                })
                const text = await resp.text().catch(() => '')
                if (!resp.ok) {
                  return { ok: false as const, status: resp.status, text }
                }
                try {
                  return { ok: true as const, data: text ? JSON.parse(text) : null }
                } catch {
                  return { ok: true as const, data: text }
                }
              } catch (e) {
                const isAbortError =
                  typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError'
                return {
                  ok: false as const,
                  status: isAbortError ? 504 : 502,
                  text: e instanceof Error ? e.message : 'UPSTREAM_UNKNOWN_ERROR',
                  code: isAbortError ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_SEND_FAILED'
                }
              } finally {
                clearTimeout(t)
	              }
	            }
	
	            const inboundId = inbound.id
	
	            if (inbound.kind === 'text') {
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
              emitMessageCreated(aiMessage)

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

              const resp = await sendUpstreamJson({ upstreamBaseUrl, upstreamAuth, ep, params: { wId: info.wId, wcId: info.peerId, content: aiMessage.text } })
              if (!resp.ok) {
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
                    code: resp.code ?? 'UPSTREAM_SEND_FAILED',
                    message: `upstream http ${resp.status}: ${resp.text}`.slice(0, 200)
                  },
                  model: { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
                })
                await persist()
                return
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
              return
            }

            if (inbound.kind === 'image') {
              if (!wkteamCatalog) {
                dbState.automationRuns.push({
                  id: runId,
                  trigger: 'webhook',
                  conversationId,
                  inputMessageId: inbound.id,
                  outputMessageId: null,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'WKTEAM_CATALOG_UNAVAILABLE', message: 'wkteam catalog unavailable' }
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
                  outputMessageId: null,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'UPSTREAM_NOT_CONFIGURED', message: 'upstream not configured' }
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
                  outputMessageId: null,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'BAD_CONVERSATION_ID', message: 'invalid wk conversationId' }
                })
                await persist()
                return
              }

              const url = inbound.image.dataUrl
              if (!/^https?:\/\//i.test(url)) {
                dbState.automationRuns.push({
                  id: runId,
                  trigger: 'webhook',
                  conversationId,
                  inputMessageId: inbound.id,
                  outputMessageId: null,
                  status: 'skipped',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'SKIPPED_NO_HTTP_URL', message: 'image.dataUrl is not http(s) url' }
                })
                await persist()
                return
              }

              const uploadEp = wkteamCatalog.get('te_shu_uploadCdnImage')
              const sendEp = wkteamCatalog.get('xiao_xi_fa_song_fa_song_tu_pian_xiao_xi2')
              if (!uploadEp || !sendEp) {
                dbState.automationRuns.push({
                  id: runId,
                  trigger: 'webhook',
                  conversationId,
                  inputMessageId: inbound.id,
                  outputMessageId: null,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'UNKNOWN_OPERATION_ID', message: 'uploadCdnImage/sendImage2 operationId not found in catalog' }
                })
                await persist()
                return
              }

              const upload = await sendUpstreamJson({ upstreamBaseUrl, upstreamAuth, ep: uploadEp, params: { wId: info.wId, content: url } })
              const cdnUrl =
                upload.ok && upload.data && typeof (upload.data as any).cdnUrl === 'string'
                  ? String((upload.data as any).cdnUrl)
                  : url

              const outId = makeId('m', deps.nowMs())
              const out: Message = {
                id: outId,
                conversationId,
                direction: 'outbound',
                source: 'system',
                sentAt: deps.nowMs(),
                kind: 'image',
                image: { dataUrl: cdnUrl, alt: inbound.image.alt || '图片' }
              }
              dbState.messages.push(out)
              dbState.conversations = dbState.conversations.map((c) => {
                if (c.id !== conversationId) return c
                return { ...c, lastMessageId: out.id, lastActivityAt: out.sentAt, updatedAt: deps.nowMs() }
              })
              await persist()
              emitMessageCreated(out)

              const sent = await sendUpstreamJson({ upstreamBaseUrl, upstreamAuth, ep: sendEp, params: { wId: info.wId, wcId: info.peerId, content: cdnUrl } })
              if (!sent.ok) {
                dbState.automationRuns.push({
                  id: runId,
                  trigger: 'webhook',
                  conversationId,
                  inputMessageId: inbound.id,
                  outputMessageId: out.id,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: {
                    code: sent.code ?? 'UPSTREAM_SEND_FAILED',
                    message: `upstream http ${sent.status}: ${sent.text}`.slice(0, 200)
                  }
                })
                await persist()
                return
              }

              dbState.automationRuns.push({
                id: runId,
                trigger: 'webhook',
                conversationId,
                inputMessageId: inbound.id,
                outputMessageId: out.id,
                status: 'success',
                startedAt,
                endedAt: deps.nowMs()
              })
              await persist()
              return
            }

            if (inbound.kind === 'file') {
              if (!wkteamCatalog) {
                dbState.automationRuns.push({
                  id: runId,
                  trigger: 'webhook',
                  conversationId,
                  inputMessageId: inbound.id,
                  outputMessageId: null,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'WKTEAM_CATALOG_UNAVAILABLE', message: 'wkteam catalog unavailable' }
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
                  outputMessageId: null,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'UPSTREAM_NOT_CONFIGURED', message: 'upstream not configured' }
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
                  outputMessageId: null,
                  status: 'failed',
                  startedAt,
                  endedAt: deps.nowMs(),
                  error: { code: 'BAD_CONVERSATION_ID', message: 'invalid wk conversationId' }
                })
                await persist()
                return
              }

              const dataUrl = inbound.file.dataUrl
              const fileName = inbound.file.name || 'unknown.bin'

              const base64Match = /^data:[^;]+;base64,(.*)$/i.exec(dataUrl)
              const sendFileBase64Ep = wkteamCatalog.get('xiao_xi_fa_song_sendFileBase64')
              const sendFileEp = wkteamCatalog.get('xiao_xi_fa_song_sendFile')

              const outId = makeId('m', deps.nowMs())
              const out: Message = {
                id: outId,
                conversationId,
                direction: 'outbound',
                source: 'system',
                sentAt: deps.nowMs(),
                kind: 'file',
                file: { name: fileName, mime: inbound.file.mime, dataUrl }
              }
              dbState.messages.push(out)
              dbState.conversations = dbState.conversations.map((c) => {
                if (c.id !== conversationId) return c
                return { ...c, lastMessageId: out.id, lastActivityAt: out.sentAt, updatedAt: deps.nowMs() }
              })
              await persist()
              emitMessageCreated(out)

              if (base64Match && sendFileBase64Ep) {
                const base64 = (base64Match[1] ?? '').trim()
                if (!base64) {
                  dbState.automationRuns.push({
                    id: runId,
                    trigger: 'webhook',
                    conversationId,
                    inputMessageId: inbound.id,
                    outputMessageId: out.id,
                    status: 'skipped',
                    startedAt,
                    endedAt: deps.nowMs(),
                    error: { code: 'SKIPPED_EMPTY_BASE64', message: 'file dataUrl base64 empty' }
                  })
                  await persist()
                  return
                }
                const sent = await sendUpstreamJson({ upstreamBaseUrl, upstreamAuth, ep: sendFileBase64Ep, params: { wId: info.wId, wcId: info.peerId, fileName, base64 } })
                if (!sent.ok) {
                  dbState.automationRuns.push({
                    id: runId,
                    trigger: 'webhook',
                    conversationId,
                    inputMessageId: inbound.id,
                    outputMessageId: out.id,
                    status: 'failed',
                    startedAt,
                    endedAt: deps.nowMs(),
                    error: {
                      code: sent.code ?? 'UPSTREAM_SEND_FAILED',
                      message: `upstream http ${sent.status}: ${sent.text}`.slice(0, 200)
                    }
                  })
                  await persist()
                  return
                }

                dbState.automationRuns.push({
                  id: runId,
                  trigger: 'webhook',
                  conversationId,
                  inputMessageId: inbound.id,
                  outputMessageId: out.id,
                  status: 'success',
                  startedAt,
                  endedAt: deps.nowMs()
                })
                await persist()
                return
              }

              if (/^https?:\/\//i.test(dataUrl) && sendFileEp) {
                const sent = await sendUpstreamJson({ upstreamBaseUrl, upstreamAuth, ep: sendFileEp, params: { wId: info.wId, wcId: info.peerId, path: dataUrl, fileName } })
                if (!sent.ok) {
                  dbState.automationRuns.push({
                    id: runId,
                    trigger: 'webhook',
                    conversationId,
                    inputMessageId: inbound.id,
                    outputMessageId: out.id,
                    status: 'failed',
                    startedAt,
                    endedAt: deps.nowMs(),
                    error: {
                      code: sent.code ?? 'UPSTREAM_SEND_FAILED',
                      message: `upstream http ${sent.status}: ${sent.text}`.slice(0, 200)
                    }
                  })
                  await persist()
                  return
                }

                dbState.automationRuns.push({
                  id: runId,
                  trigger: 'webhook',
                  conversationId,
                  inputMessageId: inbound.id,
                  outputMessageId: out.id,
                  status: 'success',
                  startedAt,
                  endedAt: deps.nowMs()
                })
                await persist()
                return
              }

              dbState.automationRuns.push({
                id: runId,
                trigger: 'webhook',
                conversationId,
                inputMessageId: inbound.id,
                outputMessageId: out.id,
                status: 'skipped',
                startedAt,
                endedAt: deps.nowMs(),
                error: { code: 'SKIPPED_NO_SENDER', message: 'no sendFileBase64/sendFile path available' }
              })
              await persist()
              return
            }

	            dbState.automationRuns.push({
	              id: runId,
	              trigger: 'webhook',
	              conversationId,
	              inputMessageId: inboundId,
	              outputMessageId: null,
	              status: 'skipped',
	              startedAt,
	              endedAt: deps.nowMs(),
	              error: { code: 'SKIPPED_UNSUPPORTED_KIND', message: `unsupported kind: ${(inbound as any).kind}` }
	            })
            await persist()
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'AUTOMATION_UNKNOWN_ERROR'
            const code =
              inbound.kind === 'text'
                ? msg.startsWith('AI_TIMEOUT')
                  ? 'AI_TIMEOUT'
                  : 'AI_UPSTREAM_ERROR'
                : 'AUTOMATION_ERROR'
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
              model:
                inbound.kind === 'text'
                  ? { baseUrlHost: new URL(deps.config.OPENAI_BASE_URL).host, model: deps.config.OPENAI_MODEL }
                  : undefined
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
