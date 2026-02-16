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
  if (!props.open) return null
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={props.title}>
      <div className={styles.panel}>
        <div className={styles.title}>{props.title}</div>
        <div className={styles.desc}>{props.description}</div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={props.onCancel}>
            {props.cancelText}
          </button>
          <button type="button" className={styles.confirm} onClick={props.onConfirm}>
            {props.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

