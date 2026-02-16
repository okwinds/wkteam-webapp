import { describe, expect, it } from 'vitest'
import type { AppState, PersistedStateV2 } from './types'
import { reducer, sortConversations } from './reducer'

/**
 * 构造一个最小 PersistedState（便于 reducer 单测）
 */
function makePersisted(nowMs: number): PersistedStateV2 {
  return {
    schemaVersion: 2,
    updatedAt: nowMs,
    activeTab: 'chats',
    selectedConversationId: 'dm:c_anna',
    selectedContactId: null,
    settings: { theme: 'system', fontSize: 'medium', sendKeyBehavior: 'enter_to_send' },
    me: { id: 'me', displayName: '我', avatarSeed: 'me', statusText: '' },
    contacts: [{ id: 'c_anna', displayName: '安娜', avatarSeed: 'anna' }],
    conversations: [
      {
        id: 'dm:c_anna',
        title: '安娜',
        peerContactId: 'c_anna',
        pinned: false,
        unreadCount: 0,
        lastMessageId: 'm0',
        lastActivityAt: nowMs - 1000,
        draftText: '草稿'
      }
    ],
    messages: [
      {
        id: 'm0',
        conversationId: 'dm:c_anna',
        direction: 'inbound',
        sentAt: nowMs - 1000,
        kind: 'text',
        text: 'hi'
      }
    ]
  }
}

describe('sortConversations', () => {
  it('置顶在前，其余按 lastActivityAt 倒序', () => {
    const now = 1_000_000
    const list = [
      { id: 'a', title: 'a', peerContactId: 'c', pinned: false, unreadCount: 0, lastMessageId: 'm', lastActivityAt: now - 1, draftText: '' },
      { id: 'b', title: 'b', peerContactId: 'c', pinned: true, unreadCount: 0, lastMessageId: 'm', lastActivityAt: now - 999, draftText: '' },
      { id: 'c', title: 'c', peerContactId: 'c', pinned: false, unreadCount: 0, lastMessageId: 'm', lastActivityAt: now - 2, draftText: '' }
    ]
    const sorted = sortConversations(list)
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('reducer', () => {
  it('发送文本消息：追加消息、清空草稿、更新会话摘要字段', () => {
    const now = 1_000_000
    const initial: AppState = { persisted: makePersisted(now), toasts: [] }
    const next = reducer(initial, { type: 'message.sendText', conversationId: 'dm:c_anna', text: 'hello', nowMs: now + 5000 })

    const conv = next.persisted.conversations.find((c) => c.id === 'dm:c_anna')!
    expect(conv.draftText).toBe('')
    expect(conv.lastActivityAt).toBe(now + 5000)
    expect(
      next.persisted.messages.some(
        (m) => m.kind === 'text' && m.text === 'hello' && m.direction === 'outbound'
      )
    ).toBe(true)
  })

  it('从联系人发起聊天：创建会话并切换到 chats', () => {
    const now = 1_000_000
    const persisted = makePersisted(now)
    const initial: AppState = {
      persisted: { ...persisted, activeTab: 'contacts', conversations: [], messages: [], selectedConversationId: null },
      toasts: []
    }
    const next = reducer(initial, { type: 'conversation.ensureDmWithContact', contactId: 'c_anna', nowMs: now + 100 })
    expect(next.persisted.activeTab).toBe('chats')
    expect(next.persisted.selectedConversationId).toBe('dm:c_anna')
    expect(next.persisted.conversations.some((c) => c.id === 'dm:c_anna')).toBe(true)
  })
})
