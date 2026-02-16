import { Sparkles } from 'lucide-react'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import styles from './ChatWindow.module.css'
import type { Conversation, Message, SendKeyBehavior } from '../../../state/types'
import { useEffect, useMemo, useRef } from 'react'

/**
 * 聊天窗口
 *
 * @param props.conversation 当前会话
 * @param props.messages 当前会话消息列表（已过滤）
 * @param props.sendKeyBehavior 发送键行为设置
 * @param props.onDraftChange 草稿变更回调
 * @param props.onSend 发送回调
 */
export function ChatWindow(props: {
  conversation: Conversation
  messages: Message[]
  sendKeyBehavior: SendKeyBehavior
  onDraftChange: (text: string) => void
  onSend: (text: string) => void
  onSendImage: (dataUrl: string, alt: string) => void
  onSendFile: (dataUrl: string, name: string, mime: string) => void
  onAiReply?: () => void
  aiBusy?: boolean
  onError: (title: string, detail: string) => void
}) {
  const listRef = useRef<HTMLDivElement | null>(null)

  const sortedMessages = useMemo(() => {
    return [...props.messages].sort((a, b) => a.sentAt - b.sentAt)
  }, [props.messages])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [sortedMessages.length, props.conversation.id])

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.title}>{props.conversation.title}</div>
        <div className={styles.headerRight}>
          {props.onAiReply ? (
            <button
              type="button"
              className={styles.aiBtn}
              aria-label="生成 AI 回复"
              disabled={props.aiBusy}
              onClick={props.onAiReply}
            >
              <Sparkles size={16} />
              {props.aiBusy ? '生成中…' : 'AI 回复'}
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.list} ref={listRef} aria-label="消息列表">
        {sortedMessages.map((m) => (
          <MessageBubble key={m.id} direction={m.direction} message={m as any} />
        ))}
      </div>

      <Composer
        draftText={props.conversation.draftText}
        sendKeyBehavior={props.sendKeyBehavior}
        onChange={props.onDraftChange}
        onSend={props.onSend}
        onSendImage={props.onSendImage}
        onSendFile={props.onSendFile}
        onError={props.onError}
      />
    </div>
  )
}
