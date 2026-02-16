import { ImageUp, Paperclip, SendHorizonal } from 'lucide-react'
import { useMemo, useRef } from 'react'
import styles from './Composer.module.css'
import type { SendKeyBehavior } from '../../../state/types'
import { fileToDataUrl } from '../../../utils/file'

/**
 * 输入区（多行 textarea）
 *
 * @param props.draftText 当前草稿
 * @param props.sendKeyBehavior 发送键行为
 * @param props.onChange 草稿变更回调
 * @param props.onSend 发送回调（仅在非空文本时触发）
 */
export function Composer(props: {
  draftText: string
  sendKeyBehavior: SendKeyBehavior
  onChange: (text: string) => void
  onSend: (text: string) => void
  onSendImage: (dataUrl: string, alt: string) => void
  onSendFile: (dataUrl: string, name: string, mime: string) => void
  onError: (title: string, detail: string) => void
}) {
  const helper = useMemo(() => {
    return props.sendKeyBehavior === 'enter_to_send' ? 'Enter 发送，Shift+Enter 换行' : 'Ctrl+Enter 发送，Enter 换行'
  }, [props.sendKeyBehavior])

  const imageRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const trySend = () => {
    const text = props.draftText.trim()
    if (!text) return
    props.onSend(text)
  }

  return (
    <div className={styles.root}>
      <label className={styles.srOnly} htmlFor="composer">
        消息输入框
      </label>
      <textarea
        id="composer"
        className={styles.textarea}
        rows={3}
        placeholder="输入消息…"
        value={props.draftText}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (props.sendKeyBehavior === 'enter_to_send') {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              trySend()
            }
          } else {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault()
              trySend()
            }
          }
        }}
      />
      <div className={styles.footer}>
        <div className={styles.left}>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="发送图片"
            onClick={() => imageRef.current?.click()}
          >
            <ImageUp size={16} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="发送文件"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={16} />
          </button>
          <div className={styles.helper}>{helper}</div>
        </div>
        <button type="button" className={styles.sendBtn} aria-label="发送文本" onClick={trySend}>
          <SendHorizonal size={16} />
          发送
        </button>
      </div>

      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        className={styles.file}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          e.target.value = ''
          const maxBytes = 500 * 1024
          if (f.size > maxBytes) {
            props.onError('图片过大', `当前 ${Math.round(f.size / 1024)}KB，V1 仅支持 ≤ ${Math.round(maxBytes / 1024)}KB。`)
            return
          }
          try {
            const dataUrl = await fileToDataUrl(f)
            props.onSendImage(dataUrl, f.name || '图片')
          } catch {
            props.onError('读取失败', '无法读取该图片文件。')
          }
        }}
      />

      <input
        ref={fileRef}
        type="file"
        className={styles.file}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          e.target.value = ''
          const maxBytes = 500 * 1024
          if (f.size > maxBytes) {
            props.onError('文件过大', `当前 ${Math.round(f.size / 1024)}KB，V1 仅支持 ≤ ${Math.round(maxBytes / 1024)}KB。`)
            return
          }
          try {
            const dataUrl = await fileToDataUrl(f)
            props.onSendFile(dataUrl, f.name || '文件', f.type || 'application/octet-stream')
          } catch {
            props.onError('读取失败', '无法读取该文件。')
          }
        }}
      />
    </div>
  )
}
