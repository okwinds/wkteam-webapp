import { z } from 'zod'

/**
 * 持久化 schema（Zod）
 *
 * - 目标：导入/加载时做严格校验，避免 UI 因脏数据崩溃
 * - 约束：V1 的 schemaVersion 固定为 1；V2 引入多消息类型（text/image/file）
 */

export const zTabKey = z.enum(['chats', 'contacts', 'discover', 'me'])
export const zTheme = z.enum(['light', 'dark', 'system'])
export const zFontSize = z.enum(['small', 'medium', 'large'])
export const zSendKeyBehavior = z.enum(['enter_to_send', 'ctrl_enter_to_send'])

export const zSettings = z.object({
  theme: zTheme,
  fontSize: zFontSize,
  sendKeyBehavior: zSendKeyBehavior
})

export const zUser = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(20),
  avatarSeed: z.string().min(1),
  statusText: z.string().max(40)
})

export const zContact = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(30),
  avatarSeed: z.string().min(1),
  note: z.string().max(40).optional(),
  signature: z.string().max(80).optional()
})

export const zConversation = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(40),
  peerContactId: z.string().min(1),
  pinned: z.boolean(),
  unreadCount: z.number().int().min(0),
  lastMessageId: z.string().min(1),
  lastActivityAt: z.number().int().min(0),
  draftText: z.string()
})

export const zMessageDirection = z.enum(['inbound', 'outbound'])

export const zMessageV1 = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  direction: zMessageDirection,
  text: z.string().min(1).max(2000),
  sentAt: z.number().int().min(0)
})

export const zPersistedStateV1 = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.number().int().min(0),
  activeTab: zTabKey,
  selectedConversationId: z.string().nullable(),
  selectedContactId: z.string().nullable(),
  settings: zSettings,
  me: zUser,
  contacts: z.array(zContact),
  conversations: z.array(zConversation),
  messages: z.array(zMessageV1)
})

export type PersistedStateV1Schema = z.infer<typeof zPersistedStateV1>

export const zTextMessage = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  direction: zMessageDirection,
  sentAt: z.number().int().min(0),
  kind: z.literal('text'),
  text: z.string().min(1).max(2000)
})

export const zImageMessage = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  direction: zMessageDirection,
  sentAt: z.number().int().min(0),
  kind: z.literal('image'),
  image: z.object({
    dataUrl: z.string().min(1),
    alt: z.string().min(1).max(80)
  })
})

export const zFileMessage = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  direction: zMessageDirection,
  sentAt: z.number().int().min(0),
  kind: z.literal('file'),
  file: z.object({
    name: z.string().min(1).max(200),
    mime: z.string().min(1).max(120),
    dataUrl: z.string().min(1)
  })
})

export const zMessageV2 = z.discriminatedUnion('kind', [zTextMessage, zImageMessage, zFileMessage])

export const zPersistedStateV2 = z.object({
  schemaVersion: z.literal(2),
  updatedAt: z.number().int().min(0),
  activeTab: zTabKey,
  selectedConversationId: z.string().nullable(),
  selectedContactId: z.string().nullable(),
  settings: zSettings,
  me: zUser,
  contacts: z.array(zContact),
  conversations: z.array(zConversation),
  messages: z.array(zMessageV2)
})

export type PersistedStateV2Schema = z.infer<typeof zPersistedStateV2>
