import styles from './TwoPaneLayout.module.css'
import type { ReactNode } from 'react'

/**
 * 两栏布局（中栏列表 + 右栏内容）
 *
 * @param props.list 左侧列表区域
 * @param props.content 右侧内容区域
 */
export function TwoPaneLayout(props: { list: ReactNode; content: ReactNode }) {
  return (
    <div className={styles.root}>
      <section className={styles.list} aria-label="列表区">
        {props.list}
      </section>
      <section className={styles.content} aria-label="内容区">
        {props.content}
      </section>
    </div>
  )
}
