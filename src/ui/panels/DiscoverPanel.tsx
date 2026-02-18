import { Compass, Heart, NotebookText, ScanEye, Video } from 'lucide-react'
import { TwoPaneLayout } from './shared/TwoPaneLayout'
import { PaneHeader } from './shared/PaneHeader'
import styles from './DiscoverPanel.module.css'
import { useState } from 'react'
import type { ComponentType } from 'react'
import { SdkConsolePane } from './sdk/SdkConsolePane'

type EntryKey = 'moments' | 'read' | 'scan' | 'favorites' | 'video' | 'sdk_console'

/**
 * Discover 面板（发现）
 *
 * - 定位：入口列表 + 右栏内容；长尾功能以“轻量占位内容”逐步补齐
 */
export function DiscoverPanel() {
  const [selected, setSelected] = useState<EntryKey>('moments')

  const entries: Array<{ key: EntryKey; title: string; desc: string; Icon: ComponentType<{ size?: number }> }> = [
    { key: 'moments', title: '朋友圈', desc: '本地示例内容（先把 UI 跑起来）。', Icon: Compass },
    { key: 'video', title: '视频号', desc: '本地示例内容（不接真实视频流）。', Icon: Video },
    { key: 'read', title: '看一看', desc: '轻量占位：仅展示说明。', Icon: NotebookText },
    { key: 'scan', title: '扫一扫', desc: '轻量占位：不接相机能力。', Icon: ScanEye },
    { key: 'favorites', title: '收藏', desc: '轻量占位：后续可从聊天消息收藏。', Icon: Heart },
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
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  setSelected(e.key)
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
          <h2 className={styles.contentTitle}>{current.title}</h2>
          <p className={styles.contentDesc}>{current.desc}</p>
          {selected === 'moments' ? (
            <div className={styles.hint}>
              示例：
              <br />
              - 今天的目标：把“长尾入口”先做全，再逐步补内容。
              <br />
              - 约束：离线可用、不引入复杂依赖。
            </div>
          ) : selected === 'favorites' ? (
            <div className={styles.hint}>提示：后续可以在聊天消息上提供“收藏”动作，把引用存到本地。</div>
          ) : selected === 'video' ? (
            <div className={styles.hint}>提示：本版本不接真实视频；先保留入口与内容区骨架。</div>
          ) : (
            <div className={styles.hint}>提示：该入口为轻量占位内容，后续按需补齐。</div>
          )}
        </div>
      </div>
    )

  return <TwoPaneLayout list={list} content={content} />
}
