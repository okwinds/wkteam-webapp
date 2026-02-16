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
    CORS_ALLOW_ORIGINS: '',
    UPSTREAM_BASE_URL: '',
    UPSTREAM_AUTHORIZATION: '',
    UPSTREAM_AUTH_HEADER_NAME: 'Authorization',
    UPSTREAM_TIMEOUT_MS: 15000,
    WKTEAM_CATALOG_PATH: './public/wkteam-api-catalog.json',
    MAX_BODY_BYTES: 1024 * 1024,
    MAX_DATAURL_BYTES: 500 * 1024,
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
})
