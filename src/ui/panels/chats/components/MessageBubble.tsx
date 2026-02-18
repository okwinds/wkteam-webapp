import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import styles from './MessageBubble.module.css'
import type { MessageDirection, Message } from '../../../state/types'

/**
 * 消息气泡
 *
 * @param props.direction inbound/outbound（决定左右与样式）
 * @param props.text 文本内容
 * @param props.sentAt 发送时间（当前仅保留字段；UI 不展示也可）
 * @param props.onHydrate 可选的 hydrate 回调，用于按需下载媒体
 */
export function MessageBubble(props: {
  direction: MessageDirection
  message: Message & { source?: string }
  onHydrate?: (messageId: string) => Promise<void>
}) {
  return (
    <div className={props.direction === 'outbound' ? `${styles.row} ${styles.out}` : styles.row}>
      <div className={props.direction === 'outbound' ? `${styles.bubble} ${styles.outBubble}` : styles.bubble}>
        {renderMeta(props.message)}
        {renderContent(props.message, props.onHydrate)}
      </div>
    </div>
  )
}

function isMediaUrlValid(dataUrl: string): boolean {
  if (!dataUrl) return false
  return dataUrl.startsWith('data:') || dataUrl.startsWith('http://') || dataUrl.startsWith('https://')
}

function renderContent(message: Message, onHydrate?: (messageId: string) => Promise<void>) {
  const [hydrating, setHydrating] = useState(false)

  const handleHydrate = useCallback(async () => {
    if (!onHydrate || hydrating) return
    setHydrating(true)
    try {
      await onHydrate(message.id)
    } catch {
      // Error toast is handled by caller
    } finally {
      setHydrating(false)
    }
  }, [onHydrate, message.id, hydrating])

  switch (message.kind) {
    case 'text':
      return message.text
    case 'image': {
      const hasValidUrl = isMediaUrlValid(message.image.dataUrl)
      if (!hasValidUrl) {
        return (
          <div className={styles.mediaPlaceholder}>
            <div className={styles.placeholderIcon}>
              <Download size={24} />
            </div>
            <div className={styles.placeholderText}>图片未下载</div>
            {onHydrate && (
              <button
                type="button"
                className={styles.downloadBtn}
                onClick={handleHydrate}
                disabled={hydrating}
                aria-label="下载图片"
              >
                {hydrating ? '下载中...' : '下载'}
              </button>
            )}
          </div>
        )
      }
      return (
        <a
          href={message.image.dataUrl}
          target="_blank"
          rel="noreferrer"
          className={styles.mediaLink}
          aria-label={message.image.alt || '打开图片'}
        >
          <img className={styles.image} src={message.image.dataUrl} alt={message.image.alt} />
        </a>
      )
    }
    case 'file': {
      const hasValidUrl = isMediaUrlValid(message.file.dataUrl)
      if (!hasValidUrl) {
        return (
          <div className={styles.mediaPlaceholder}>
            <div className={styles.placeholderIcon}>
              <Download size={24} />
            </div>
            <div className={styles.placeholderText}>{message.file.name}</div>
            {onHydrate && (
              <button
                type="button"
                className={styles.downloadBtn}
                onClick={handleHydrate}
                disabled={hydrating}
                aria-label={`下载文件 ${message.file.name}`}
              >
                {hydrating ? '下载中...' : '下载'}
              </button>
            )}
          </div>
        )
      }
      return (
        <a
          href={message.file.dataUrl}
          download={message.file.name}
          className={styles.fileLink}
          aria-label={`下载文件 ${message.file.name}`}
        >
          {message.file.name}
        </a>
      )
    }
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
