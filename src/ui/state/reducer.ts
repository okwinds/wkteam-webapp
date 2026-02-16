import type { AppState, Conversation, Message, PersistedStateV2, Settings, TabKey, ToastItem } from './types'

export type Action =
  | { type: 'tab.set'; tab: TabKey }
  | { type: 'toast.push'; toast: ToastItem }
  | { type: 'toast.dismiss'; id: string }
  | { type: 'conversation.select'; id: string }
  | { type: 'contact.select'; id: string }
  | { type: 'conversation.togglePinned'; id: string }
  | { type: 'conversation.delete'; id: string }
  | { type: 'conversation.markRead'; id: string }
  | { type: 'draft.set'; conversationId: string; text: string }
  | { type: 'message.sendText'; conversationId: string; text: string; nowMs: number }
  | { type: 'message.sendImage'; conversationId: string; dataUrl: string; alt: string; nowMs: number }
  | { type: 'message.sendFile'; conversationId: string; dataUrl: string; name: string; mime: string; nowMs: number }
  | { type: 'conversation.ensureDmWithContact'; contactId: string; nowMs: number }
  | { type: 'settings.patch'; patch: Partial<Settings> }
  | { type: 'state.replacePersisted'; next: PersistedStateV2 }

/**
 * 会话排序规则（置顶在前，其余按 lastActivityAt 倒序）
 *
 * @param conversations 会话数组
 * @returns 新数组（已排序）
 */
export function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.lastActivityAt - a.lastActivityAt
  })
}

/**
 * 生成一个稳定的 DM 会话 id
 *
 * @param contactId 联系人 id
 * @returns 会话 id（稳定）
 */
export function dmConversationId(contactId: string): string {
  return `dm:${contactId}`
}

/**
 * Reducer：只处理纯状态变更（不做 IO）
 *
 * @param state 当前状态
 * @param action 动作
 * @returns 新状态
 */
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'toast.push':
      return { ...state, toasts: [...state.toasts, action.toast] }
    case 'toast.dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    case 'tab.set':
      return {
        ...state,
        persisted: { ...state.persisted, activeTab: action.tab, updatedAt: Date.now() }
      }
    case 'settings.patch':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          settings: { ...state.persisted.settings, ...action.patch },
          updatedAt: Date.now()
        }
      }
    case 'state.replacePersisted':
      return { ...state, persisted: action.next }
    case 'conversation.select': {
      const next = {
        ...state.persisted,
        selectedConversationId: action.id,
        updatedAt: Date.now()
      }
      return { ...state, persisted: next }
    }
    case 'contact.select': {
      const next = {
        ...state.persisted,
        selectedContactId: action.id,
        updatedAt: Date.now()
      }
      return { ...state, persisted: next }
    }
    case 'draft.set': {
      const conversations = state.persisted.conversations.map((c) =>
        c.id === action.conversationId ? { ...c, draftText: action.text } : c
      )
      return { ...state, persisted: { ...state.persisted, conversations, updatedAt: Date.now() } }
    }
    case 'conversation.togglePinned': {
      const conversations = state.persisted.conversations.map((c) =>
        c.id === action.id ? { ...c, pinned: !c.pinned } : c
      )
      return { ...state, persisted: { ...state.persisted, conversations: sortConversations(conversations), updatedAt: Date.now() } }
    }
    case 'conversation.delete': {
      const conversations = state.persisted.conversations.filter((c) => c.id !== action.id)
      const messages = state.persisted.messages.filter((m) => m.conversationId !== action.id)
      const selectedConversationId =
        state.persisted.selectedConversationId === action.id ? conversations[0]?.id ?? null : state.persisted.selectedConversationId
      return {
        ...state,
        persisted: {
          ...state.persisted,
          conversations: sortConversations(conversations),
          messages,
          selectedConversationId,
          updatedAt: Date.now()
        }
      }
    }
    case 'conversation.markRead': {
      const conversations = state.persisted.conversations.map((c) =>
        c.id === action.id ? { ...c, unreadCount: 0 } : c
      )
      return { ...state, persisted: { ...state.persisted, conversations, updatedAt: Date.now() } }
    }
    case 'conversation.ensureDmWithContact': {
      const cid = dmConversationId(action.contactId)
      const exists = state.persisted.conversations.some((c) => c.id === cid)
      if (exists) {
        return { ...state, persisted: { ...state.persisted, activeTab: 'chats', selectedConversationId: cid, updatedAt: action.nowMs } }
      }
      const contact = state.persisted.contacts.find((c) => c.id === action.contactId)
      const title = contact?.displayName ?? '未知联系人'
      const placeholderMessage: Message = {
        id: `m_${cid}_seed`,
        conversationId: cid,
        direction: 'inbound',
        sentAt: action.nowMs,
        kind: 'text',
        text: '你好，我们从这里开始聊天吧。'
      }
      const conversation: Conversation = {
        id: cid,
        title,
        peerContactId: action.contactId,
        pinned: false,
        unreadCount: 0,
        lastMessageId: placeholderMessage.id,
        lastActivityAt: placeholderMessage.sentAt,
        draftText: ''
      }
      const conversations = sortConversations([...state.persisted.conversations, conversation])
      return {
        ...state,
        persisted: {
          ...state.persisted,
          activeTab: 'chats',
          selectedConversationId: cid,
          conversations,
          messages: [...state.persisted.messages, placeholderMessage],
          updatedAt: action.nowMs
        }
      }
    }
    case 'message.sendText': {
      const text = action.text.trim()
      if (!text) return state

      const message: Message = {
        id: `m_${action.conversationId}_${action.nowMs}`,
        conversationId: action.conversationId,
        direction: 'outbound',
        sentAt: action.nowMs,
        kind: 'text',
        text
      }

      const conversations = state.persisted.conversations.map((c) => {
        if (c.id !== action.conversationId) return c
        return {
          ...c,
          lastMessageId: message.id,
          lastActivityAt: message.sentAt,
          draftText: ''
        }
      })

      return {
        ...state,
        persisted: {
          ...state.persisted,
          conversations: sortConversations(conversations),
          messages: [...state.persisted.messages, message],
          updatedAt: action.nowMs
        }
      }
    }
    case 'message.sendImage': {
      const message: Message = {
        id: `m_${action.conversationId}_${action.nowMs}`,
        conversationId: action.conversationId,
        direction: 'outbound',
        sentAt: action.nowMs,
        kind: 'image',
        image: { dataUrl: action.dataUrl, alt: action.alt }
      }

      const conversations = state.persisted.conversations.map((c) => {
        if (c.id !== action.conversationId) return c
        return {
          ...c,
          lastMessageId: message.id,
          lastActivityAt: message.sentAt,
          draftText: ''
        }
      })

      return {
        ...state,
        persisted: {
          ...state.persisted,
          conversations: sortConversations(conversations),
          messages: [...state.persisted.messages, message],
          updatedAt: action.nowMs
        }
      }
    }
    case 'message.sendFile': {
      const message: Message = {
        id: `m_${action.conversationId}_${action.nowMs}`,
        conversationId: action.conversationId,
        direction: 'outbound',
        sentAt: action.nowMs,
        kind: 'file',
        file: { dataUrl: action.dataUrl, name: action.name, mime: action.mime }
      }

      const conversations = state.persisted.conversations.map((c) => {
        if (c.id !== action.conversationId) return c
        return {
          ...c,
          lastMessageId: message.id,
          lastActivityAt: message.sentAt,
          draftText: ''
        }
      })

      return {
        ...state,
        persisted: {
          ...state.persisted,
          conversations: sortConversations(conversations),
          messages: [...state.persisted.messages, message],
          updatedAt: action.nowMs
        }
      }
    }
    default:
      return state
  }
}
