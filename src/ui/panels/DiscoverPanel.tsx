import { Compass, Heart, NotebookText, ScanEye } from 'lucide-react'
import { TwoPaneLayout } from './shared/TwoPaneLayout'
import { PaneHeader } from './shared/PaneHeader'
import styles from './DiscoverPanel.module.css'
import { useState } from 'react'
import type { ComponentType } from 'react'
import { useAppActions } from '../state/hooks'
import { SdkConsolePane } from './sdk/SdkConsolePane'

type EntryKey = 'moments' | 'read' | 'scan' | 'favorites' | 'sdk_console'

/**
 * Discover 面板（发现）
 *
 * - V1 定位：入口列表占位，不进入未定义页面
 */
export function DiscoverPanel() {
  const actions = useAppActions()
  const [selected, setSelected] = useState<EntryKey>('moments')

  const entries: Array<{ key: EntryKey; title: string; desc: string; Icon: ComponentType<{ size?: number }> }> = [
    { key: 'moments', title: '朋友圈（占位）', desc: 'V1 不实现内容流，只保留入口。', Icon: Compass },
    { key: 'read', title: '看一看（占位）', desc: 'V1 仅展示说明与点击提示。', Icon: NotebookText },
    { key: 'scan', title: '扫一扫（占位）', desc: 'V1 不接相机能力。', Icon: ScanEye },
    { key: 'favorites', title: '收藏（占位）', desc: 'V1 不实现收藏管理。', Icon: Heart },
    { key: 'sdk_console', title: 'SDK 控制台', desc: '全量 endpoint 执行能力（开发者工具）。', Icon: NotebookText }
  ]

  const list = (
    <>
      <PaneHeader title="发现" />
      <div className={styles.list} role="list" aria-label="发现入口列表">
        {entries.map((e) => {
          const active = e.key === selected
          return (
            <div
              key={e.key}
              role="listitem"
              tabIndex={0}
              className={active ? `${styles.item} ${styles.active}` : styles.item}
              onClick={() => {
                setSelected(e.key)
                if (e.key !== 'sdk_console') {
                  actions.pushToast({ kind: 'info', title: 'V1 未实现', detail: '该入口仅用于确认 UI 结构。' })
                }
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  setSelected(e.key)
                  if (e.key !== 'sdk_console') {
                    actions.pushToast({ kind: 'info', title: 'V1 未实现', detail: '该入口仅用于确认 UI 结构。' })
                  }
                }
              }}
            >
              <div className={styles.icon}>
                <e.Icon size={18} />
              </div>
              <div className={styles.meta}>
                <div className={styles.title}>{e.title}</div>
                <div className={styles.desc}>{e.desc}</div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )

  const current = entries.find((e) => e.key === selected)!

  const content =
    selected === 'sdk_console' ? (
      <SdkConsolePane />
    ) : (
      <div className={styles.content}>
        <div className={styles.contentCard}>
          <div className={styles.contentTitle}>{current.title}</div>
          <div className={styles.contentDesc}>{current.desc}</div>
          <div className={styles.hint}>提示：V1 不跳转页面。点击入口仅用于确认整体 UI 结构与风格。</div>
        </div>
      </div>
    )

  return <TwoPaneLayout list={list} content={content} />
}
