import { Pin, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '../../shared/Avatar'
import { formatTimeShort } from '../../../utils/time'
import styles from './ConversationList.module.css'
import type { Conversation, Message } from '../../../state/types'
import { sortConversations } from '../../../state/reducer'
import { ConfirmDialog } from '../../shared/ConfirmDialog'

/**
 * 会话列表组件
 *
 * @param props.conversations 会话数组（可未排序）
 * @param props.messages 消息数组（用于拼出 last message 预览）
 * @param props.selectedConversationId 当前选中的会话 id
 * @param props.onSelect 选择会话回调
 * @param props.onTogglePinned 置顶切换回调
 * @param props.onDelete 删除会话回调
 */
export function ConversationList(props: {
  conversations: Conversation[]
  messages: Message[]
  selectedConversationId: string | null
  onSelect: (id: string) => void
  onTogglePinned: (id: string) => void
  onDelete: (id: string) => void
}) {
  const messagesById = new Map(props.messages.map((m) => [m.id, m] as const))
  const sorted = sortConversations(props.conversations)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const pendingConversation = pendingDeleteId ? sorted.find((c) => c.id === pendingDeleteId) ?? null : null

  return (
    <>
      <div className={styles.root} role="list" aria-label="会话列表">
        {sorted.map((c) => {
        const isActive = c.id === props.selectedConversationId
        const last = messagesById.get(c.lastMessageId)
        const preview = last ? messagePreview(last) : ''
        return (
            <div
              key={c.id}
              className={isActive ? `${styles.item} ${styles.active}` : styles.item}
              role="listitem"
              tabIndex={0}
              onClick={() => props.onSelect(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onSelect(c.id)
              }}
            >
              <Avatar seed={c.peerContactId} label={`${c.title} 头像`} size={36} />

              <div className={styles.meta}>
                <div className={styles.topRow}>
                  <div className={styles.title}>
                    {c.title}
                    {c.pinned ? (
                      <span className={styles.pinned} aria-label="已置顶">
                        <Pin size={14} />
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.time}>{formatTimeShort(c.lastActivityAt)}</div>
                </div>
                <div className={styles.bottomRow}>
                  <div className={styles.preview}>{preview}</div>
                  {c.unreadCount > 0 ? <div className={styles.badge}>{c.unreadCount}</div> : null}
                </div>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label={c.pinned ? '取消置顶' : '置顶'}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onTogglePinned(c.id)
                  }}
                >
                  <Pin size={16} />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label="删除会话"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingDeleteId(c.id)
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={pendingDeleteId != null}
        title="确认删除会话？"
        description={pendingConversation ? `将删除「${pendingConversation.title}」的本地会话与消息（不可撤销）。` : '将删除本地会话与消息（不可撤销）。'}
        confirmText="确认删除"
        cancelText="取消"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) props.onDelete(pendingDeleteId)
          setPendingDeleteId(null)
        }}
      />
    </>
  )
}

function messagePreview(message: Message): string {
  switch (message.kind) {
    case 'text':
      return message.text
    case 'image':
      return '【图片】'
    case 'file':
      return `【文件】${message.file.name}`
    default:
      return ''
  }
}
