import { Plus } from 'lucide-react'
import { useEffect } from 'react'
import { TwoPaneLayout } from '../shared/TwoPaneLayout'
import { PaneHeader } from '../shared/PaneHeader'
import { useAppActions, useAppState } from '../../state/hooks'
import { ConversationList } from './components/ConversationList'
import { ChatWindow } from './components/ChatWindow'
import styles from './ChatsPane.module.css'
import { useConnectionState } from '../../remote/ConnectionProvider'
import { useRemoteChats } from '../../remote/useRemoteChats'

/**
 * Chats 模块：中栏会话列表 + 右侧聊天窗
 */
export function ChatsPane() {
  const state = useAppState()
  const actions = useAppActions()
  const connection = useConnectionState()
  const remote = useRemoteChats(connection.client)

  const isServerMode = connection.settings.mode === 'server'

  // Server mode: 使用 AppState 驱动选中态
  const selectedConversationId = state.persisted.selectedConversationId

  const selectedConversation = isServerMode
    ? (selectedConversationId == null
        ? null
        : remote.conversations.find((c) => c.id === selectedConversationId) ?? null)
    : (selectedConversationId == null
        ? null
        : state.persisted.conversations.find((c) => c.id === selectedConversationId) ?? null)

  // Server mode: 当 AppState 的 selectedConversationId 变化时，同步到 remote
  useEffect(() => {
    if (!isServerMode) return
    if (state.persisted.selectedConversationId == null) return
    remote.selectConversation(state.persisted.selectedConversationId)
  }, [isServerMode, state.persisted.selectedConversationId, remote])

  const list = (
    <>
      <PaneHeader
        title="聊天"
        right={
          <button
            type="button"
            className={styles.headerIconBtn}
            aria-label={isServerMode ? '新建会话（连接后端）' : '新建会话（V1 占位）'}
            onClick={async () => {
              if (!isServerMode) {
                actions.pushToast({ kind: 'info', title: 'V1 占位', detail: '请从通讯录选择联系人发起会话。' })
                return
              }
              if (!connection.client || connection.status !== 'connected') {
                actions.pushToast({ kind: 'error', title: '未连接', detail: '请先在设置中配置服务端并测试连接。' })
                return
              }
              const title = window.prompt('会话标题（可为空则自动生成）') ?? ''
              const peerId = window.prompt('peerId（对端标识，例如 u_001）') ?? ''
              if (!peerId.trim()) {
                actions.pushToast({ kind: 'error', title: '创建失败', detail: 'peerId 不能为空。' })
                return
              }
              try {
                await connection.client.createConversation({ title: title.trim() || `会话 ${peerId.trim()}`, peerId: peerId.trim() })
                await remote.refresh()
              } catch (e) {
                actions.pushToast({ kind: 'error', title: '创建失败', detail: e instanceof Error ? e.message : '未知错误' })
              }
            }}
          >
            <Plus size={18} />
          </button>
        }
      />
      <ConversationList
        conversations={isServerMode ? remote.conversations : state.persisted.conversations}
        messages={isServerMode ? (remote.messages as any) : state.persisted.messages}
        selectedConversationId={selectedConversationId}
        onSelect={actions.selectConversation}
        onTogglePinned={
          isServerMode
            ? (id) =>
                remote.togglePinned(id).catch((e) =>
                  actions.pushToast({ kind: 'error', title: '置顶失败', detail: e instanceof Error ? e.message : '未知错误' })
                )
            : actions.togglePinned
        }
        onDelete={
          isServerMode
            ? (id) =>
                remote.deleteConversation(id).catch((e) =>
                  actions.pushToast({ kind: 'error', title: '删除失败', detail: e instanceof Error ? e.message : '未知错误' })
                )
            : actions.deleteConversation
        }
      />
    </>
  )

  const content = selectedConversation ? (
      <ChatWindow
        conversation={selectedConversation}
        messages={
          isServerMode
            ? (remote.messages.filter((m) => m.conversationId === selectedConversation.id) as any)
            : state.persisted.messages.filter((m) => m.conversationId === selectedConversation.id)
        }
        sendKeyBehavior={state.persisted.settings.sendKeyBehavior}
        onDraftChange={(text) => (isServerMode ? remote.setDraft(selectedConversation.id, text) : actions.setDraft(selectedConversation.id, text))}
        onSend={(text) =>
          isServerMode
            ? remote.sendText(selectedConversation.id, text).catch((e) => actions.pushToast({ kind: 'error', title: '发送失败', detail: e instanceof Error ? e.message : '未知错误' }))
            : actions.sendText(selectedConversation.id, text)
        }
        onSendImage={(dataUrl, alt) =>
          isServerMode
            ? remote
                .sendImage(selectedConversation.id, dataUrl, alt)
                .catch((e) => actions.pushToast({ kind: 'error', title: '发送失败', detail: e instanceof Error ? e.message : '未知错误' }))
            : actions.sendImage(selectedConversation.id, dataUrl, alt)
        }
        onSendFile={(dataUrl, name, mime) =>
          isServerMode
            ? remote
                .sendFile(selectedConversation.id, dataUrl, name, mime)
                .catch((e) => actions.pushToast({ kind: 'error', title: '发送失败', detail: e instanceof Error ? e.message : '未知错误' }))
            : actions.sendFile(selectedConversation.id, dataUrl, name, mime)
        }
        onAiReply={
          isServerMode
            ? () =>
                remote
                  .aiReply(selectedConversation.id)
                  .catch((e) => actions.pushToast({ kind: 'error', title: 'AI 失败', detail: e instanceof Error ? e.message : '未知错误' }))
            : undefined
        }
        aiBusy={isServerMode ? remote.aiBusy : false}
        onError={(title, detail) => actions.pushToast({ kind: 'error', title, detail })}
      />
    ) : (
      <div className={styles.empty}>
        {isServerMode ? (
          <>
            <div className={styles.emptyTitle}>连接到服务端开始聊天</div>
            <div className={styles.emptyDesc}>请先在“我 → 设置 → 服务端（V0）”配置 baseUrl 与 token，并测试连接。</div>
            <div className={styles.emptyDesc}>当前状态：{connection.status}{connection.lastError ? `（${connection.lastError}）` : ''}</div>
          </>
        ) : (
          <>
            <div className={styles.emptyTitle}>从通讯录选择联系人开始聊天</div>
            <div className={styles.emptyDesc}>V1 仅支持本地文本消息与草稿持久化。</div>
          </>
        )}
      </div>
    )

  return <TwoPaneLayout list={list} content={content} />
}
