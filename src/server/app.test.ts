// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { createAppServer } from './app'
import { FileDb } from './db'

function makeConfig(overrides?: Partial<import('./config').ServerConfig>): import('./config').ServerConfig {
  return {
    HOST: '127.0.0.1',
    PORT: 0,
    DATA_DIR: './data',
    BFF_API_TOKEN: 'test_token_1234567890',
    WEBHOOK_SECRET: 'test_webhook_secret_123456',
    LOCAL_LOGIN_PASSWORD: '',
    WEBHOOK_IP_ALLOWLIST: '',
    WEBHOOK_RATE_LIMIT_PER_MIN: 0,
    CORS_ALLOW_ORIGINS: '',
    UPSTREAM_BASE_URL: '',
    UPSTREAM_AUTHORIZATION: '',
    UPSTREAM_AUTH_HEADER_NAME: 'Authorization',
    UPSTREAM_TIMEOUT_MS: 15000,
    WKTEAM_CATALOG_PATH: './public/wkteam-api-catalog.json',
    MAX_BODY_BYTES: 1024 * 1024,
    MAX_DATAURL_BYTES: 500 * 1024,
    MAX_WEBHOOK_RAW_BYTES: 32 * 1024,
    OPENAI_BASE_URL: 'https://api.example.com',
    OPENAI_API_KEY: 'test_openai_key_1234567890',
    OPENAI_MODEL: 'test-model',
    OPENAI_TIMEOUT_MS: 20000,
    OPENAI_PATH_CHAT_COMPLETIONS: '/v1/chat/completions',
    ...overrides
  }
}

async function startTestServer(opts?: {
  fetchImpl?: typeof fetch
  nowMs?: () => number
  configOverrides?: Partial<import('./config').ServerConfig>
}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'wkteam-webapp-server-'))
  const config = makeConfig({ DATA_DIR: dataDir, ...(opts?.configOverrides ?? {}) })
  const db = new FileDb({ dataDir })
  const { server, close, drainAutomation } = await createAppServer({
    config,
    db,
    fetchImpl: opts?.fetchImpl ?? fetch,
    nowMs: opts?.nowMs ?? (() => Date.now())
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (address == null || typeof address === 'string') {
    throw new Error('unexpected server address')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    close: async () => {
      await close()
      await rm(dataDir, { recursive: true, force: true })
    },
    drainAutomation,
    authHeader: { authorization: `Bearer ${config.BFF_API_TOKEN}` },
    webhookHeader: { 'x-webhook-secret': config.WEBHOOK_SECRET }
  }
}

async function startMockUpstream() {
  let last: null | { url: string; headers: Record<string, string>; body: string } = null
  const server: Server = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      req.on('end', () => {
        last = {
          url: req.url || '',
          headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
          body: Buffer.concat(chunks).toString('utf-8')
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, echo: JSON.parse(last.body || '{}') }))
      })
    })
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('unexpected upstream address')
  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    baseUrl,
    getLast: () => last,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err: any) => (err ? reject(err) : resolve()))
      })
  }
}

describe('server app', () => {
  let cleanup: null | (() => Promise<void>) = null

  afterEach(async () => {
    if (cleanup) await cleanup()
    cleanup = null
  })

  it('healthz works without auth', async () => {
    const s = await startTestServer()
    cleanup = s.close
    const resp = await fetch(`${s.baseUrl}/healthz`)
    expect(resp.status).toBe(200)
    const json = await resp.json()
    expect(json.ok).toBe(true)
  })

  it('local login issues session cookie and can access /api without Authorization header', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const loginResp = await fetch(`${s.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test_token_1234567890' })
    })
    expect(loginResp.status).toBe(200)
    const setCookie = loginResp.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    const cookie = String(setCookie).split(';')[0]

    const listResp = await fetch(`${s.baseUrl}/api/conversations`, { headers: { cookie } })
    expect(listResp.status).toBe(200)
    const json = await listResp.json()
    expect(Array.isArray(json.conversations)).toBe(true)
  })

  it('/api/auth/me returns 401 when not logged in, 200 when logged in', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const before = await fetch(`${s.baseUrl}/api/auth/me`)
    expect(before.status).toBe(401)

    const loginResp = await fetch(`${s.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test_token_1234567890' })
    })
    const cookie = String(loginResp.headers.get('set-cookie') ?? '').split(';')[0]

    const after = await fetch(`${s.baseUrl}/api/auth/me`, { headers: { cookie } })
    expect(after.status).toBe(200)
    const json = await after.json()
    expect(json.ok).toBe(true)
  })

  it('api requires bearer token', async () => {
    const s = await startTestServer()
    cleanup = s.close
    const resp = await fetch(`${s.baseUrl}/api/conversations`)
    expect(resp.status).toBe(401)
  })

  it('create conversation and send text message', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const created = await fetch(`${s.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '测试会话', peerId: 'u_001' })
    })
    expect(created.status).toBe(200)
    const createdJson = await created.json()
    expect(createdJson.conversation.id).toBeTruthy()

    const cid = createdJson.conversation.id as string

    const sent = await fetch(`${s.baseUrl}/api/conversations/${encodeURIComponent(cid)}/messages`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'text', text: 'hello' })
    })
    expect(sent.status).toBe(200)
    const msg = await sent.json()
    expect(msg.message.kind).toBe('text')
    expect(msg.message.text).toBe('hello')
  })

  it('toggle pinned and delete conversation', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const created = await fetch(`${s.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '测试会话', peerId: 'u_001' })
    })
    const createdJson = await created.json()
    const cid = createdJson.conversation.id as string

    const pin = await fetch(`${s.baseUrl}/api/conversations/${encodeURIComponent(cid)}/pinned`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: true })
    })
    expect(pin.status).toBe(200)

    const list = await fetch(`${s.baseUrl}/api/conversations`, { headers: s.authHeader })
    const listJson = await list.json()
    expect(listJson.conversations.find((c: any) => c.id === cid)?.pinned).toBe(true)

    const del = await fetch(`${s.baseUrl}/api/conversations/${encodeURIComponent(cid)}`, {
      method: 'DELETE',
      headers: s.authHeader
    })
    expect(del.status).toBe(200)
  })

  it('webhook requires secret and supports dedupe', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const noSecret = await fetch(`${s.baseUrl}/webhooks/wkteam/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dedupeKey: 'k1', conversationId: 'c1', text: 'hi' })
    })
    expect(noSecret.status).toBe(401)

    const ok1 = await fetch(`${s.baseUrl}/webhooks/wkteam/messages`, {
      method: 'POST',
      headers: { ...s.webhookHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ dedupeKey: 'k1', conversationId: 'c1', text: 'hi' })
    })
    expect(ok1.status).toBe(200)
    const ok2 = await fetch(`${s.baseUrl}/webhooks/wkteam/messages`, {
      method: 'POST',
      headers: { ...s.webhookHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ dedupeKey: 'k1', conversationId: 'c1', text: 'hi again' })
    })
    expect(ok2.status).toBe(200)
    const j2 = await ok2.json()
    expect(j2.deduped).toBe(true)
  })

  it('webhook supports path secret for wkteam callback (no header/query needed)', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const payload = {
      wcId: 'wxid_bot_001',
      account: 'test_account',
      messageType: '60001',
      data: {
        wId: 'wid_001',
        fromUser: 'wxid_peer_123',
        toUser: 'wxid_bot_001',
        msgId: 1001,
        newMsgId: 9002,
        timestamp: 1700000000,
        content: '你好',
        self: false
      }
    }

    const ok = await fetch(`${s.baseUrl}/webhooks/${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}/wkteam/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    expect(ok.status).toBe(200)

    const list = await fetch(`${s.baseUrl}/api/conversations`, { headers: s.authHeader })
    const listJson = await list.json()
    expect(listJson.conversations.length).toBe(1)
    expect(listJson.conversations[0].id).toBe('wk:wid_001:u:wxid_peer_123')
  })

  it('webhook IP allowlist rejects non-allowlisted IPs (403)', async () => {
    const s = await startTestServer({
      configOverrides: {
        WEBHOOK_IP_ALLOWLIST: '1.2.3.4'
      }
    })
    cleanup = s.close

    const resp = await fetch(`${s.baseUrl}/webhooks/wkteam/messages`, {
      method: 'POST',
      headers: {
        ...s.webhookHeader,
        'x-forwarded-for': '9.9.9.9',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ dedupeKey: 'k-allowlist-1', conversationId: 'c1', text: 'hi' })
    })
    expect(resp.status).toBe(403)
  })

  it('webhook rate limit rejects when exceeding per-minute threshold (429)', async () => {
    const s = await startTestServer({
      nowMs: () => 1700000000000,
      configOverrides: {
        WEBHOOK_RATE_LIMIT_PER_MIN: 1
      }
    })
    cleanup = s.close

    const ok1 = await fetch(`${s.baseUrl}/webhooks/wkteam/messages`, {
      method: 'POST',
      headers: {
        ...s.webhookHeader,
        'x-forwarded-for': '8.8.8.8',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ dedupeKey: 'k-rate-1', conversationId: 'c1', text: 'hi' })
    })
    expect(ok1.status).toBe(200)

    const tooMany = await fetch(`${s.baseUrl}/webhooks/wkteam/messages`, {
      method: 'POST',
      headers: {
        ...s.webhookHeader,
        'x-forwarded-for': '8.8.8.8',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ dedupeKey: 'k-rate-2', conversationId: 'c1', text: 'hi again' })
    })
    expect(tooMany.status).toBe(429)
  })

  it('ai-reply persists a message when upstream returns content', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'AI 回复' } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const s = await startTestServer({ fetchImpl })
    cleanup = s.close

    const created = await fetch(`${s.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '测试会话', peerId: 'u_001' })
    })
    const createdJson = await created.json()
    const cid = createdJson.conversation.id as string

    const ai = await fetch(`${s.baseUrl}/api/conversations/${encodeURIComponent(cid)}/ai-reply`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'persist' })
    })
    expect(ai.status).toBe(200)
    const aiJson = await ai.json()
    expect(aiJson.message.kind).toBe('text')
    expect(aiJson.message.source).toBe('ai')
    expect(aiJson.message.text).toBe('AI 回复')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('upstream proxy calls by operationId and injects authorization', async () => {
    const upstream = await startMockUpstream()
    const catalogPath = join(tmpdir(), `wkteam-catalog-${Date.now()}.json`)
    await writeFile(
      catalogPath,
      JSON.stringify({ generatedAt: 0, catalog: [{ kind: 'endpoint', operationId: 'op_echo', method: 'POST', path: '/echo' }] }),
      'utf-8'
    )

    const s = await startTestServer({
      configOverrides: {
        WKTEAM_CATALOG_PATH: catalogPath,
        UPSTREAM_BASE_URL: upstream.baseUrl,
        UPSTREAM_AUTHORIZATION: 'Bearer upstream_token',
        UPSTREAM_AUTH_HEADER_NAME: 'Authorization'
      }
    })

    cleanup = async () => {
      await s.close()
      await upstream.close()
      await rm(catalogPath, { force: true })
    }

    const resp = await fetch(`${s.baseUrl}/api/upstream/call`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'op_echo', params: { a: 1 } })
    })
    const text = await resp.text()
    expect(resp.status, text).toBe(200)
    const json = JSON.parse(text)
    expect(json.ok).toBe(true)
    expect(json.data.echo.a).toBe(1)

    const last = upstream.getLast()
    expect(last?.url).toBe('/echo')
    expect(last?.headers.authorization).toBe('Bearer upstream_token')
  })

  it('default catalog path loads successfully and upstream call does not return WKTEAM_CATALOG_UNAVAILABLE', async () => {
    const upstream = await startMockUpstream()
    const s = await startTestServer({
      configOverrides: {
        UPSTREAM_BASE_URL: upstream.baseUrl,
        UPSTREAM_AUTHORIZATION: 'Bearer upstream_token',
        UPSTREAM_AUTH_HEADER_NAME: 'Authorization'
      }
    })

    cleanup = async () => {
      await s.close()
      await upstream.close()
    }

    const resp = await fetch(`${s.baseUrl}/api/upstream/call`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        operationId: 'te_shu_cdnDownFile',
        params: { wId: 'wid_001', cdnUrl: 'https://cdn.example.com/a.jpg', aeskey: 'aes_001', fileType: 'image' }
      })
    })
    const text = await resp.text()
    expect(resp.status, text).toBe(200)
    expect(text).not.toContain('WKTEAM_CATALOG_UNAVAILABLE')

    const last = upstream.getLast()
    expect(last?.url).toBe('/cdnDownFile')
  })

  it('hydrate downloads media via te_shu_cdnDownFile and updates message dataUrl', async () => {
    const calls: Array<{ url: string; body: any }> = []
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '')
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (url.endsWith('/cdnDownFile')) {
        calls.push({ url, body })
        return new Response(JSON.stringify({ base64: 'Zm9vYmFy' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    const catalogPath = join(tmpdir(), `wkteam-catalog-${Date.now()}-cdn-down.json`)
    await writeFile(
      catalogPath,
      JSON.stringify({
        generatedAt: 0,
        catalog: [{ kind: 'endpoint', operationId: 'te_shu_cdnDownFile', method: 'POST', path: '/cdnDownFile' }]
      }),
      'utf-8'
    )

    const s = await startTestServer({
      fetchImpl,
      configOverrides: {
        WKTEAM_CATALOG_PATH: catalogPath,
        UPSTREAM_BASE_URL: 'http://upstream.test',
        UPSTREAM_AUTHORIZATION: 'Bearer upstream_token',
        UPSTREAM_AUTH_HEADER_NAME: 'Authorization'
      }
    })
    cleanup = async () => {
      await s.close()
      await rm(catalogPath, { force: true })
    }

    const payload = {
      wcId: 'wxid_bot_001',
      messageType: '60002',
      data: {
        wId: 'wid_001',
        fromUser: 'wxid_peer_123',
        toUser: 'wxid_bot_001',
        newMsgId: 9401,
        timestamp: 1700000400,
        cdnUrl: 'https://cdn.example.com/a.jpg',
        aeskey: 'aes_key_123',
        self: false
      }
    }

    const resp = await fetch(`${s.baseUrl}/webhooks/wkteam/callback?secret=${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    expect(resp.status).toBe(200)

    const conversationId = 'wk:wid_001:u:wxid_peer_123'
    const list = await fetch(`${s.baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      headers: s.authHeader
    })
    expect(list.status).toBe(200)
    const listJson = await list.json()
    const img = (listJson.messages as any[]).find((m) => m.kind === 'image')
    expect(img).toBeTruthy()
    expect(String(img.image?.dataUrl || '')).toContain('https://')

    const hydrate = await fetch(`${s.baseUrl}/api/messages/${encodeURIComponent(img.id)}/hydrate`, {
      method: 'POST',
      headers: s.authHeader
    })
    expect(hydrate.status).toBe(200)
    const hydrateJson = await hydrate.json()
    expect(hydrateJson.ok).toBe(true)
    expect(String(hydrateJson.message?.image?.dataUrl || '').startsWith('data:image/jpeg;base64,')).toBe(true)

    expect(calls.length).toBe(1)
    expect(new URL(calls[0]!.url).pathname).toBe('/cdnDownFile')
    expect(calls[0]!.body).toMatchObject({
      wId: 'wid_001',
      cdnUrl: 'https://cdn.example.com/a.jpg',
      aeskey: 'aes_key_123',
      fileType: 'image'
    })
  })

  it('wkteam callback webhook accepts optimized payload, supports query secret, and dedupes by newMsgId', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const payload = {
      wcId: 'wxid_bot_001',
      account: 'test_account',
      messageType: '60001',
      data: {
        wId: 'wid_001',
        fromUser: 'wxid_peer_123',
        toUser: 'wxid_bot_001',
        msgId: 1001,
        newMsgId: 9001,
        timestamp: 1700000000,
        content: '你好',
        self: false
      }
    }

    const noSecret = await fetch(`${s.baseUrl}/webhooks/wkteam/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    expect(noSecret.status).toBe(401)

    const ok1 = await fetch(`${s.baseUrl}/webhooks/wkteam/callback?secret=${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    expect(ok1.status).toBe(200)
    const j1 = await ok1.json()
    expect(j1.ok).toBe(true)

    const list = await fetch(`${s.baseUrl}/api/conversations`, { headers: s.authHeader })
    const listJson = await list.json()
    expect(listJson.conversations.length).toBe(1)
    expect(listJson.conversations[0].id).toBe('wk:wid_001:u:wxid_peer_123')

    const ok2 = await fetch(`${s.baseUrl}/webhooks/wkteam/callback?secret=${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, data: { ...payload.data, content: '重复推送' } })
    })
    expect(ok2.status).toBe(200)
    const j2 = await ok2.json()
    expect(j2.deduped).toBe(true)
  })

  it('wkteam callback triggers async AI reply and upstream sendText when automation enabled', async () => {
    const upstream = await startMockUpstream()
    const catalogPath = join(tmpdir(), `wkteam-catalog-${Date.now()}-sendtext.json`)
    await writeFile(
      catalogPath,
      JSON.stringify({
        generatedAt: 0,
        catalog: [
          { kind: 'endpoint', operationId: 'xiao_xi_fa_song_fa_song_wen_ben_xiao_xi', method: 'POST', path: '/sendText' }
        ]
      }),
      'utf-8'
    )

    const realFetch = fetch
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '')
      if (url.startsWith('https://api.example.com')) {
        await new Promise((r) => setTimeout(r, 300))
        return new Response(JSON.stringify({ choices: [{ message: { content: 'AI 自动回复' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return realFetch(input, init)
    }) as unknown as typeof fetch

    const s = await startTestServer({
      fetchImpl,
      configOverrides: {
        WKTEAM_CATALOG_PATH: catalogPath,
        UPSTREAM_BASE_URL: upstream.baseUrl,
        UPSTREAM_AUTHORIZATION: 'Bearer upstream_token',
        UPSTREAM_AUTH_HEADER_NAME: 'Authorization'
      }
    })

    cleanup = async () => {
      await s.close()
      await upstream.close()
      await rm(catalogPath, { force: true })
    }

    expect(typeof (s as any).drainAutomation).toBe('function')

    const toggle = await fetch(`${s.baseUrl}/api/automation/status`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ automationEnabled: true })
    })
    expect(toggle.status).toBe(200)

    const payload = {
      wcId: 'wxid_bot_001',
      messageType: '60001',
      data: {
        wId: 'wid_001',
        fromUser: 'wxid_peer_123',
        toUser: 'wxid_bot_001',
        msgId: 1002,
        newMsgId: 9002,
        timestamp: 1700000001,
        content: '请自动回复',
        self: false
      }
    }

    const t0 = Date.now()
    const resp = await fetch(`${s.baseUrl}/webhooks/wkteam/callback?secret=${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const t1 = Date.now()
    expect(resp.status).toBe(200)
    expect(t1 - t0).toBeLessThan(200)

    await (s as any).drainAutomation()

    const last = upstream.getLast()
    expect(last?.url).toBe('/sendText')
    expect(last?.headers.authorization).toBe('Bearer upstream_token')
    expect(JSON.parse(last?.body ?? '{}')).toMatchObject({
      wId: 'wid_001',
      wcId: 'wxid_peer_123',
      content: 'AI 自动回复'
    })
  })

  it('wkteam callback stores image/file messages with raw', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const imgPayload = {
      wcId: 'wxid_bot_001',
      messageType: '60002',
      data: {
        wId: 'wid_001',
        fromUser: 'wxid_peer_123',
        toUser: 'wxid_bot_001',
        newMsgId: 9101,
        timestamp: 1700000100,
        url: 'https://example.com/pic.jpg',
        fileName: 'pic.jpg',
        self: false
      }
    }

    const imgResp = await fetch(
      `${s.baseUrl}/webhooks/wkteam/callback?secret=${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(imgPayload) }
    )
    expect(imgResp.status).toBe(200)

    const filePayload = {
      wcId: 'wxid_bot_001',
      messageType: '60008',
      data: {
        wId: 'wid_001',
        fromUser: 'wxid_peer_123',
        toUser: 'wxid_bot_001',
        newMsgId: 9102,
        timestamp: 1700000101,
        url: 'https://example.com/a.pdf',
        fileName: 'a.pdf',
        self: false
      }
    }

    const fileResp = await fetch(
      `${s.baseUrl}/webhooks/wkteam/callback?secret=${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(filePayload) }
    )
    expect(fileResp.status).toBe(200)

    const cid = 'wk:wid_001:u:wxid_peer_123'
    const list = await fetch(`${s.baseUrl}/api/conversations/${encodeURIComponent(cid)}/messages?limit=10`, {
      headers: s.authHeader
    })
    expect(list.status).toBe(200)
    const listJson = await list.json()
    const msgs = listJson.messages as any[]
    expect(msgs.some((m) => m.kind === 'image')).toBe(true)
    expect(msgs.some((m) => m.kind === 'file')).toBe(true)

    const img = msgs.find((m) => m.kind === 'image')
    expect(img.raw).toContain('"messageType":"60002"')
    expect(img.rawTruncated).toBe(false)
    expect(img.image?.dataUrl).toBe('https://example.com/pic.jpg')

    const f = msgs.find((m) => m.kind === 'file')
    expect(f.raw).toContain('"messageType":"60008"')
    expect(f.rawTruncated).toBe(false)
    expect(f.file?.dataUrl).toBe('https://example.com/a.pdf')
    expect(f.file?.name).toBe('a.pdf')
  })

  it('wkteam callback automation echoes image via uploadCdnImage + sendImage2', async () => {
    const calls: Array<{ url: string; body: any }> = []
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '')
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url, body })

      if (url.endsWith('/uploadCdnImage')) {
        return new Response(JSON.stringify({ cdnUrl: 'https://cdn.example.com/pic.jpg' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/sendImage2')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    const catalogPath = join(tmpdir(), `wkteam-catalog-${Date.now()}-image.json`)
    await writeFile(
      catalogPath,
      JSON.stringify({
        generatedAt: 0,
        catalog: [
          { kind: 'endpoint', operationId: 'te_shu_uploadCdnImage', method: 'POST', path: '/uploadCdnImage' },
          { kind: 'endpoint', operationId: 'xiao_xi_fa_song_fa_song_tu_pian_xiao_xi2', method: 'POST', path: '/sendImage2' }
        ]
      }),
      'utf-8'
    )

    const s = await startTestServer({
      fetchImpl,
      configOverrides: {
        WKTEAM_CATALOG_PATH: catalogPath,
        UPSTREAM_BASE_URL: 'http://upstream.test',
        UPSTREAM_AUTHORIZATION: 'Bearer upstream_token',
        UPSTREAM_AUTH_HEADER_NAME: 'Authorization'
      }
    })
    cleanup = async () => {
      await s.close()
      await rm(catalogPath, { force: true })
    }

    const toggle = await fetch(`${s.baseUrl}/api/automation/status`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ automationEnabled: true })
    })
    expect(toggle.status).toBe(200)

    const payload = {
      wcId: 'wxid_bot_001',
      messageType: '60002',
      data: {
        wId: 'wid_001',
        fromUser: 'wxid_peer_123',
        toUser: 'wxid_bot_001',
        newMsgId: 9201,
        timestamp: 1700000200,
        url: 'https://example.com/pic.jpg',
        self: false
      }
    }

    const resp = await fetch(`${s.baseUrl}/webhooks/wkteam/callback?secret=${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    expect(resp.status).toBe(200)

    await (s as any).drainAutomation()

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/uploadCdnImage', '/sendImage2'])
    expect(calls[0]?.body).toMatchObject({ wId: 'wid_001', content: 'https://example.com/pic.jpg' })
    expect(calls[1]?.body).toMatchObject({ wId: 'wid_001', wcId: 'wxid_peer_123', content: 'https://cdn.example.com/pic.jpg' })
  })

  it('wkteam callback automation echoes file via sendFileBase64 for dataUrl', async () => {
    const calls: Array<{ url: string; body: any }> = []
    const fetchImpl = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '')
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url, body })
      if (url.endsWith('/sendFileBase64')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    const catalogPath = join(tmpdir(), `wkteam-catalog-${Date.now()}-file-b64.json`)
    await writeFile(
      catalogPath,
      JSON.stringify({
        generatedAt: 0,
        catalog: [
          { kind: 'endpoint', operationId: 'xiao_xi_fa_song_sendFileBase64', method: 'POST', path: '/sendFileBase64' }
        ]
      }),
      'utf-8'
    )

    const s = await startTestServer({
      fetchImpl,
      configOverrides: {
        WKTEAM_CATALOG_PATH: catalogPath,
        UPSTREAM_BASE_URL: 'http://upstream.test',
        UPSTREAM_AUTHORIZATION: 'Bearer upstream_token',
        UPSTREAM_AUTH_HEADER_NAME: 'Authorization'
      }
    })
    cleanup = async () => {
      await s.close()
      await rm(catalogPath, { force: true })
    }

    const toggle = await fetch(`${s.baseUrl}/api/automation/status`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ automationEnabled: true })
    })
    expect(toggle.status).toBe(200)

    const payload = {
      wcId: 'wxid_bot_001',
      messageType: '60008',
      data: {
        wId: 'wid_001',
        fromUser: 'wxid_peer_123',
        toUser: 'wxid_bot_001',
        newMsgId: 9301,
        timestamp: 1700000300,
        fileName: 'a.pdf',
        content: 'data:application/pdf;base64,Zm9vYmFy',
        self: false
      }
    }

    const resp = await fetch(`${s.baseUrl}/webhooks/wkteam/callback?secret=${encodeURIComponent(s.webhookHeader['x-webhook-secret'])}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    expect(resp.status).toBe(200)

    await (s as any).drainAutomation()

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/sendFileBase64'])
    expect(calls[0]?.body).toMatchObject({ wId: 'wid_001', wcId: 'wxid_peer_123', fileName: 'a.pdf', base64: 'Zm9vYmFy' })
  })

  it('sse emits message.created when a new message is persisted', async () => {
    const s = await startTestServer()
    cleanup = s.close

    const created = await fetch(`${s.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '测试会话', peerId: 'u_001' })
    })
    const createdJson = await created.json()
    const cid = createdJson.conversation.id as string

    const sse = await fetch(`${s.baseUrl}/api/events?token=${encodeURIComponent('test_token_1234567890')}`, {
      headers: { accept: 'text/event-stream' }
    })
    expect(sse.status).toBe(200)
    expect(sse.headers.get('content-type') || '').toContain('text/event-stream')
    expect(sse.body).toBeTruthy()

    const reader = sse.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    const sent = await fetch(`${s.baseUrl}/api/conversations/${encodeURIComponent(cid)}/messages`, {
      method: 'POST',
      headers: { ...s.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'text', text: 'hello sse' })
    })
    expect(sent.status).toBe(200)

    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      if (buf.includes('event: message.created') && buf.includes('\n\ndata:')) break
      if (buf.includes('data:') && buf.includes('\n\n')) break
    }
    await reader.cancel().catch(() => {})

    const dataLine = buf
      .split('\n')
      .map((l) => l.trimEnd())
      .find((l) => l.startsWith('data:'))
    expect(dataLine).toBeTruthy()

    const json = JSON.parse((dataLine || '').replace(/^data:\s*/, ''))
    expect(json.conversationId).toBe(cid)
    expect(json.kind).toBe('text')
    expect(typeof json.messageId).toBe('string')
  })
})
