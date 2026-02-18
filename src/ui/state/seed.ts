import type { PersistedStateV2 } from './types'

/**
 * 生成 V1 的 seed 数据
 *
 * @param nowMs 当前时间戳（毫秒）；用于保证 seed 可测试、可控
 * @returns 满足 PRD 的示例数据（无敏感信息）
 */
export function createSeedPersistedState(nowMs: number): PersistedStateV2 {
  const me = {
    id: 'me',
    displayName: '我',
    avatarSeed: 'me',
    statusText: 'WeChat-Lite（本地示例）'
  }

  const contacts = [
    { id: 'c_anna', displayName: '安娜', avatarSeed: 'anna', signature: '今天也要保持专注' },
    { id: 'c_ben', displayName: '本', avatarSeed: 'ben', signature: '把复杂留在过去' },
    { id: 'c_chris', displayName: '克里斯', avatarSeed: 'chris', signature: '先把界面跑起来' },
    { id: 'c_dina', displayName: '迪娜', avatarSeed: 'dina', signature: '离线也能用' },
    { id: 'c_eli', displayName: '伊莱', avatarSeed: 'eli', signature: '保持节奏' },
    { id: 'c_faye', displayName: '菲', avatarSeed: 'faye', signature: '少即是多' },
    { id: 'c_gus', displayName: '古斯', avatarSeed: 'gus', signature: '稳定可回归' },
    { id: 'c_hana', displayName: '花', avatarSeed: 'hana', signature: '清爽的 UI' },

    // 群聊（长尾入口：先补齐 UI 骨架；聊天行为先复用 DM 会话逻辑）
    { id: 'g_team', displayName: '项目群', avatarSeed: 'team', signature: '先把能力做全' },
    { id: 'g_family', displayName: '家人群', avatarSeed: 'family', signature: '保持联系' }
  ]

  const mkConversationId = (contactId: string) => `dm:${contactId}`
  const conversationIds = [mkConversationId('c_anna'), mkConversationId('c_ben'), mkConversationId('c_chris')]

  const messages = conversationIds.flatMap((cid, idx) => {
    const base = nowMs - (idx + 1) * 1000 * 60 * 60
    const inboundTexts = [
      '我们先做一个最小可用的三栏壳层吧。',
      '对，先把会话列表和聊天窗打通。',
      '然后再补设置、导入导出、重置。'
    ]
    const outboundTexts = ['收到。', '我先把 UI 结构搭起来。', '等你确认整体风格再细化。']

    return Array.from({ length: 10 }).map((_, i) => {
      const direction = i % 2 === 0 ? 'inbound' : 'outbound'
      const text = direction === 'inbound' ? inboundTexts[i % inboundTexts.length] : outboundTexts[i % outboundTexts.length]
      return {
        id: `m_${cid}_${i}`,
        conversationId: cid,
        direction,
        sentAt: base + i * 1000 * 60 * 2,
        kind: 'text',
        text
      } as const
    })
  })

  const conversations = conversationIds.map((cid, idx) => {
    const peerContactId = cid.replace('dm:', '')
    const convMessages = messages.filter((m) => m.conversationId === cid)
    const last = convMessages[convMessages.length - 1]!
    return {
      id: cid,
      title: contacts.find((c) => c.id === peerContactId)!.displayName,
      peerContactId,
      pinned: idx === 0,
      unreadCount: idx === 0 ? 2 : 0,
      lastMessageId: last.id,
      lastActivityAt: last.sentAt,
      draftText: idx === 1 ? '（草稿示例）等会儿我补一下设置页。' : ''
    }
  })

  return {
    schemaVersion: 2,
    updatedAt: nowMs,
    activeTab: 'chats',
    selectedConversationId: conversations[0]?.id ?? null,
    selectedContactId: null,
    settings: {
      theme: 'system',
      fontSize: 'medium',
      sendKeyBehavior: 'enter_to_send'
    },
    me,
    contacts,
    conversations,
    messages
  }
}
