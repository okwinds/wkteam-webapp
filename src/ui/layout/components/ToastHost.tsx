import styles from './ToastHost.module.css'
import type { ToastItem } from '../../state/types'

/**
 * 全局 Toast 容器
 *
 * @param props.toasts 当前需要展示的 toast 列表
 * @param props.onDismiss 关闭 toast 的回调
 */
export function ToastHost(props: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className={styles.root} aria-live="polite" aria-relevant="additions removals">
      {props.toasts.map((t) => (
        <div key={t.id} className={t.kind === 'error' ? `${styles.toast} ${styles.error}` : styles.toast}>
          <div className={styles.title}>{t.title}</div>
          {t.detail ? <div className={styles.detail}>{t.detail}</div> : null}
          <button type="button" className={styles.close} aria-label="关闭提示" onClick={() => props.onDismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

