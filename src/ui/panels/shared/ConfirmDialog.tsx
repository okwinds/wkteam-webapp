import { useEffect, useRef, useCallback } from 'react'
import styles from './ConfirmDialog.module.css'

/**
 * 简易确认对话框（无第三方依赖）
 *
 * @param props.open 是否显示
 * @param props.title 标题
 * @param props.description 描述
 * @param props.confirmText 确认按钮文案
 * @param props.cancelText 取消按钮文案
 * @param props.onConfirm 确认回调
 * @param props.onCancel 取消回调
 */
export function ConfirmDialog(props: {
  open: boolean
  title: string
  description: string
  confirmText: string
  cancelText: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastActiveElementRef = useRef<HTMLElement | null>(null)

  // Focus cancel button when dialog opens
  useEffect(() => {
    if (props.open) {
      lastActiveElementRef.current = document.activeElement as HTMLElement
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        cancelRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    } else {
      // Restore focus when dialog closes
      if (lastActiveElementRef.current) {
        lastActiveElementRef.current.focus()
      }
    }
  }, [props.open])

  // Handle Escape key and Tab trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        props.onCancel()
        return
      }

      // Tab trap: keep focus within dialog
      if (e.key === 'Tab') {
        const focusableElements = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )

        if (!focusableElements || focusableElements.length === 0) return

        const firstElement = focusableElements[0]
        const lastElement = focusableElements[focusableElements.length - 1]

        if (e.shiftKey) {
          // Shift + Tab: move backwards
          if (document.activeElement === firstElement) {
            e.preventDefault()
            lastElement.focus()
          }
        } else {
          // Tab: move forwards
          if (document.activeElement === lastElement) {
            e.preventDefault()
            firstElement.focus()
          }
        }
      }
    },
    [props]
  )

  if (!props.open) return null
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={props.title}>
      <div ref={panelRef} className={styles.panel} onKeyDown={handleKeyDown}>
        <div className={styles.title}>{props.title}</div>
        <div className={styles.desc}>{props.description}</div>
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.cancel}
            onClick={props.onCancel}
          >
            {props.cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={styles.confirm}
            onClick={props.onConfirm}
          >
            {props.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

