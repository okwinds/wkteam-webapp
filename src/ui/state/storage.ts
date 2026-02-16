import { z } from 'zod'
import { STORAGE_KEY } from './constants'
import { zPersistedStateV1, zPersistedStateV2 } from './schema'
import type { PersistedStateV1, PersistedStateV2 } from './types'

export type LoadResult =
  | { ok: true; value: PersistedStateV2 }
  | { ok: false; reason: 'missing' | 'invalid_json' | 'schema_mismatch' | 'unknown'; detail?: string }

/**
 * 从 localStorage 加载持久化状态
 *
 * @returns ok=false 时返回可解释的失败原因（用于 UI toast）
 */
export function loadPersistedState(): LoadResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ok: false, reason: 'missing' }
    const parsed = JSON.parse(raw) as unknown
    const v2 = zPersistedStateV2.safeParse(parsed)
    if (v2.success) return { ok: true, value: v2.data }

    const v1 = zPersistedStateV1.safeParse(parsed)
    if (v1.success) return { ok: true, value: migrateV1ToV2(v1.data) }

    return { ok: false, reason: 'schema_mismatch', detail: v2.error.message }
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false, reason: 'invalid_json', detail: String(e.message) }
    return { ok: false, reason: 'unknown', detail: String(e) }
  }
}

/**
 * 写入 localStorage（同步）
 *
 * @param state 要持久化的完整状态
 * @throws localStorage 可能抛出 QuotaExceededError 等异常
 */
export function savePersistedState(state: PersistedStateV2): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/**
 * 导出 JSON 字符串（供下载）
 *
 * @param state 当前持久化状态
 * @returns JSON 字符串（稳定序列化）
 */
export function exportStateAsJson(state: PersistedStateV2): string {
  return JSON.stringify(state, null, 2)
}

/**
 * 校验并解析导入的 JSON
 *
 * @param jsonText 用户导入的 JSON 文本
 * @returns 通过校验的 PersistedStateV1；失败时抛出 Error（message 可直接展示）
 */
export function importStateFromJson(jsonText: string): PersistedStateV2 {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (e) {
    throw new Error('JSON 解析失败：文件不是合法 JSON。')
  }

  const v2 = zPersistedStateV2.safeParse(parsed)
  if (v2.success) return v2.data

  const v1 = zPersistedStateV1.safeParse(parsed)
  if (v1.success) return migrateV1ToV2(v1.data)

  const msg = v2.error instanceof z.ZodError ? v2.error.issues.map((i) => i.message).join('; ') : '未知校验错误'
  throw new Error(`导入校验失败：${msg}`)
}

/**
 * 清空本地数据（用于重置）
 */
export function clearPersistedState(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * V1 → V2 迁移
 *
 * @param v1 V1 持久化数据
 * @returns V2 持久化数据（text 消息升级为 discriminated union）
 */
function migrateV1ToV2(v1: PersistedStateV1): PersistedStateV2 {
  return {
    schemaVersion: 2,
    updatedAt: Date.now(),
    activeTab: v1.activeTab,
    selectedConversationId: v1.selectedConversationId,
    selectedContactId: v1.selectedContactId,
    settings: v1.settings,
    me: v1.me,
    contacts: v1.contacts,
    conversations: v1.conversations,
    messages: v1.messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      direction: m.direction,
      sentAt: m.sentAt,
      kind: 'text',
      text: m.text
    }))
  }
}
