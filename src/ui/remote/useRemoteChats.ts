import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Conversation, Message } from '../state/types'
import type { BffClient, BffConversation, BffMessage } from './bffClient'

type MessageWithSource = Message & { source?: string }

export type RemoteChatsModel = {
  conversations: Conversation[]
  selectedConversationId: string | null
  selectedConversation: Conversation | null
  messages: MessageWithSource[]
  loading: boolean
  aiBusy: boolean
  error: string | null
  selectConversation: (id: string) => void
  togglePinned: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  setDraft: (conversationId: string, text: string) => void
  sendText: (conversationId: string, text: string) => Promise<void>
  sendImage: (conversationId: string, dataUrl: string, alt: string) => Promise<void>
  sendFile: (conversationId: string, dataUrl: string, name: string, mime: string) => Promise<void>
  aiReply: (conversationId: string) => Promise<void>
  refresh: () => Promise<void>
}

function mapConversation(c: BffConversation, draftText: string): Conversation {
  return {
    id: c.id,
    title: c.title,
    peerContactId: c.peerId,
    pinned: c.pinned,
    unreadCount: c.unreadCount,
    lastMessageId: c.lastMessageId ?? '',
    lastActivityAt: c.lastActivityAt,
    draftText
  }
}

function mapMessage(m: BffMessage): MessageWithSource {
  if (m.kind === 'text') {
    return { id: m.id, conversationId: m.conversationId, direction: m.direction, sentAt: m.sentAt, kind: 'text', text: m.text, source: m.source }
  }
  if (m.kind === 'image') {
    return {
      id: m.id,
      conversationId: m.conversationId,
      direction: m.direction,
      sentAt: m.sentAt,
      kind: 'image',
      image: { dataUrl: m.image.dataUrl, alt: m.image.alt },
      source: m.source
    }
  }
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    sentAt: m.sentAt,
    kind: 'file',
    file: { name: m.file.name, mime: m.file.mime, dataUrl: m.file.dataUrl },
    source: m.source
  }
}

/**
 * 远程 Chats 数据模型（连接后端模式）
 *
 * - 功能：拉取会话/消息，提供发送与 AI 回复能力
 * - 约束：draftText 保存在前端内存（V0），不落到服务端
 */
export function useRemoteChats(client: BffClient | null): RemoteChatsModel {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bffConversations, setBffConversations] = useState<BffConversation[]>([])
  const [bffMessages, setBffMessages] = useState<BffMessage[]>([])
  const draftsRef = useRef<Map<string, string>>(new Map())

  const refresh = useCallback(async () => {
    if (!client) return
    setLoading(true)
    setError(null)
    try {
      const list = await client.listConversations()
      setBffConversations(list)
      if (selectedId) {
        const msgs = await client.listMessages(selectedId, 200)
        setBffMessages(msgs)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [client, selectedId])

  useEffect(() => {
    setBffConversations([])
    setBffMessages([])
    setSelectedId(null)
    setError(null)
    if (!client) return
    refresh()
  }, [client, refresh])

  const conversations = useMemo(() => {
    return bffConversations.map((c) => mapConversation(c, draftsRef.current.get(c.id) ?? ''))
  }, [bffConversations])

  const selectedConversation = useMemo(() => {
    if (!selectedId) return null
    return conversations.find((c) => c.id === selectedId) ?? null
  }, [conversations, selectedId])

  const messages = useMemo(() => {
    return bffMessages.map(mapMessage)
  }, [bffMessages])

  const selectConversation = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (!client) return
      client
        .listMessages(id, 200)
        .then((msgs) => setBffMessages(msgs))
        .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
    },
    [client]
  )

  const setDraft = useCallback((conversationId: string, text: string) => {
    draftsRef.current.set(conversationId, text)
    setBffConversations((list) => [...list])
  }, [])

  const togglePinned = useCallback(
    async (id: string) => {
      if (!client) return
      const current = bffConversations.find((c) => c.id === id)
      if (!current) return
      await client.setPinned(id, !current.pinned)
      await refresh()
    },
    [bffConversations, client, refresh]
  )

  const deleteConversation = useCallback(
    async (id: string) => {
      if (!client) return
      await client.deleteConversation(id)
      if (selectedId === id) setSelectedId(null)
      draftsRef.current.delete(id)
      await refresh()
    },
    [client, refresh, selectedId]
  )

  const sendText = useCallback(
    async (conversationId: string, text: string) => {
      if (!client) return
      await client.sendText(conversationId, text)
      draftsRef.current.set(conversationId, '')
      await refresh()
    },
    [client, refresh]
  )

  const sendImage = useCallback(
    async (conversationId: string, dataUrl: string, alt: string) => {
      if (!client) return
      await client.sendImage(conversationId, { dataUrl, alt })
      await refresh()
    },
    [client, refresh]
  )

  const sendFile = useCallback(
    async (conversationId: string, dataUrl: string, name: string, mime: string) => {
      if (!client) return
      await client.sendFile(conversationId, { dataUrl, name, mime })
      await refresh()
    },
    [client, refresh]
  )

  const aiReply = useCallback(
    async (conversationId: string) => {
      if (!client) return
      setAiBusy(true)
      try {
        await client.aiReply(conversationId)
        await refresh()
      } finally {
        setAiBusy(false)
      }
    },
    [client, refresh]
  )

  return {
    conversations,
    selectedConversationId: selectedId,
    selectedConversation,
    messages,
    loading,
    aiBusy,
    error,
    selectConversation,
    togglePinned,
    deleteConversation,
    setDraft,
    sendText,
    sendImage,
    sendFile,
    aiReply,
    refresh
  }
}

