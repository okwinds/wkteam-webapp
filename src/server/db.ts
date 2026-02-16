import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'

export type MessageDirection = 'inbound' | 'outbound'
export type MessageSource = 'human' | 'ai' | 'system' | 'webhook'

export type Conversation = {
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

export type TextMessage = {
  id: string
  conversationId: string
  direction: MessageDirection
  source: MessageSource
  sentAt: number
  kind: 'text'
  text: string
}

export type ImageMessage = {
  id: string
  conversationId: string
  direction: MessageDirection
  source: MessageSource
  sentAt: number
  kind: 'image'
  image: { dataUrl: string; alt: string }
}

export type FileMessage = {
  id: string
  conversationId: string
  direction: MessageDirection
  source: MessageSource
  sentAt: number
  kind: 'file'
  file: { name: string; mime: string; dataUrl: string }
}

export type Message = TextMessage | ImageMessage | FileMessage

export type AutomationRun = {
  id: string
  trigger: 'manual' | 'webhook'
  conversationId: string
  inputMessageId: string
  outputMessageId: string | null
  status: 'success' | 'failed' | 'skipped'
  startedAt: number
  endedAt: number
  error?: { code: string; message: string }
  model?: { baseUrlHost: string; model: string }
}

export type DbV1 = {
  schemaVersion: 1
  updatedAt: number
  automationEnabled: boolean
  conversations: Conversation[]
  messages: Message[]
  automationRuns: AutomationRun[]
  webhookDedupeKeys: Record<string, string>
}

const dbSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.number(),
  automationEnabled: z.boolean(),
  conversations: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      peerId: z.string(),
      pinned: z.boolean(),
      unreadCount: z.number().int().min(0),
      lastMessageId: z.string().nullable(),
      lastActivityAt: z.number(),
      createdAt: z.number(),
      updatedAt: z.number()
    })
  ),
  messages: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        id: z.string(),
        conversationId: z.string(),
        direction: z.union([z.literal('inbound'), z.literal('outbound')]),
        source: z.union([z.literal('human'), z.literal('ai'), z.literal('system'), z.literal('webhook')]),
        sentAt: z.number(),
        kind: z.literal('text'),
        text: z.string()
      }),
      z.object({
        id: z.string(),
        conversationId: z.string(),
        direction: z.union([z.literal('inbound'), z.literal('outbound')]),
        source: z.union([z.literal('human'), z.literal('ai'), z.literal('system'), z.literal('webhook')]),
        sentAt: z.number(),
        kind: z.literal('image'),
        image: z.object({ dataUrl: z.string(), alt: z.string() })
      }),
      z.object({
        id: z.string(),
        conversationId: z.string(),
        direction: z.union([z.literal('inbound'), z.literal('outbound')]),
        source: z.union([z.literal('human'), z.literal('ai'), z.literal('system'), z.literal('webhook')]),
        sentAt: z.number(),
        kind: z.literal('file'),
        file: z.object({ name: z.string(), mime: z.string(), dataUrl: z.string() })
      })
    ])
  ),
  automationRuns: z.array(
    z.object({
      id: z.string(),
      trigger: z.union([z.literal('manual'), z.literal('webhook')]),
      conversationId: z.string(),
      inputMessageId: z.string(),
      outputMessageId: z.string().nullable(),
      status: z.union([z.literal('success'), z.literal('failed'), z.literal('skipped')]),
      startedAt: z.number(),
      endedAt: z.number(),
      error: z
        .object({
          code: z.string(),
          message: z.string()
        })
        .optional(),
      model: z
        .object({
          baseUrlHost: z.string(),
          model: z.string()
        })
        .optional()
    })
  ),
  webhookDedupeKeys: z.record(z.string(), z.string())
})

/**
 * 文件存储（V0）
 *
 * - 功能：把 db 全量序列化为单个 JSON 文件，采用“写临时文件 + rename”实现原子替换
 * - 约束：V0 默认单进程；并发写入通过队列串行化（避免互相覆盖）
 */
export class FileDb {
  private readonly filePath: string
  private writeQueue: Promise<void> = Promise.resolve()

  public constructor(opts: { dataDir: string }) {
    this.filePath = join(opts.dataDir, 'db.json')
  }

  public async loadOrInit(nowMs: number): Promise<DbV1> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = dbSchemaV1.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        return this.createEmptyDb(nowMs)
      }
      return parsed.data
    } catch {
      return this.createEmptyDb(nowMs)
    }
  }

  public async save(next: DbV1): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.${Date.now()}.tmp`
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
      await rename(tmp, this.filePath)
    })
    await this.writeQueue
  }

  private createEmptyDb(nowMs: number): DbV1 {
    return {
      schemaVersion: 1,
      updatedAt: nowMs,
      automationEnabled: false,
      conversations: [],
      messages: [],
      automationRuns: [],
      webhookDedupeKeys: {}
    }
  }
}

/**
 * 生成稳定 id
 *
 * - 功能：生成不依赖外部库的短 id（足够用于 V0）
 * - 返回：类似 `m_1700000000000_ab12cd`
 */
export function makeId(prefix: string, nowMs: number) {
  return `${prefix}_${nowMs}_${Math.random().toString(16).slice(2, 8)}`
}

