import styles from './MessageBubble.module.css'
import type { MessageDirection, Message } from '../../../state/types'

/**
 * 消息气泡
 *
 * @param props.direction inbound/outbound（决定左右与样式）
 * @param props.text 文本内容
 * @param props.sentAt 发送时间（当前仅保留字段；UI 不展示也可）
 */
export function MessageBubble(props: { direction: MessageDirection; message: Message & { source?: string } }) {
  return (
    <div className={props.direction === 'outbound' ? `${styles.row} ${styles.out}` : styles.row}>
      <div className={props.direction === 'outbound' ? `${styles.bubble} ${styles.outBubble}` : styles.bubble}>
        {renderMeta(props.message)}
        {renderContent(props.message)}
      </div>
    </div>
  )
}

function renderContent(message: Message) {
  switch (message.kind) {
    case 'text':
      return message.text
    case 'image':
      return (
        <a href={message.image.dataUrl} target="_blank" rel="noreferrer" className={styles.mediaLink}>
          <img className={styles.image} src={message.image.dataUrl} alt={message.image.alt} />
        </a>
      )
    case 'file':
      return (
        <a href={message.file.dataUrl} download={message.file.name} className={styles.fileLink}>
          {message.file.name}
        </a>
      )
    default:
      return null
  }
}

function renderMeta(message: { source?: string }) {
  const source = message.source
  if (!source) return null
  if (source === 'human') return null
  const label = source === 'ai' ? 'AI' : source === 'webhook' ? '回调' : source === 'system' ? '系统' : '来源'
  return (
    <div className={styles.meta} aria-label={`消息来源：${label}`}>
      {label}
    </div>
  )
}
