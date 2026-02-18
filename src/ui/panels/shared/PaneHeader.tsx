import styles from './PaneHeader.module.css'
import type { ReactNode } from 'react'

/**
 * 列表区标题栏
 *
 * @param props.title 标题文本
 * @param props.right 右侧区域（可选）
 */
export function PaneHeader(props: { title: string; right?: ReactNode }) {
  return (
    <div className={styles.root}>
      <div className={styles.title} role="heading" aria-level={2}>
        {props.title}
      </div>
      <div className={styles.right}>{props.right}</div>
    </div>
  )
}
