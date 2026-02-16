import { Compass, MessageSquare, Monitor, Moon, Sun, UserCircle, Users } from 'lucide-react'
import type { ComponentType } from 'react'
import styles from './IconRail.module.css'
import type { TabKey } from '../../state/types'
import type { ThemeSetting } from '../../state/types'

/**
 * 左侧 Tab 导航栏（固定四入口）
 *
 * @param props.activeTab 当前选中的 Tab
 * @param props.onTabChange 切换 Tab 的回调
 */
export function IconRail(props: {
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
  theme: ThemeSetting
  onThemeChange: (next: ThemeSetting) => void
}) {
  const items: Array<{ key: TabKey; label: string; Icon: ComponentType<{ size?: number }> }> = [
    { key: 'chats', label: '聊天', Icon: MessageSquare },
    { key: 'contacts', label: '通讯录', Icon: Users },
    { key: 'discover', label: '发现', Icon: Compass },
    { key: 'me', label: '我', Icon: UserCircle }
  ]

  const nextTheme = props.theme === 'system' ? 'light' : props.theme === 'light' ? 'dark' : 'system'
  const ThemeIcon = props.theme === 'system' ? Monitor : props.theme === 'light' ? Sun : Moon
  const themeLabel = props.theme === 'system' ? '跟随系统' : props.theme === 'light' ? '浅色' : '深色'

  return (
    <nav className={styles.root} aria-label="主导航">
      <div className={styles.stack}>
        {items.map((item) => {
          const isActive = item.key === props.activeTab
          return (
            <button
              key={item.key}
              type="button"
              className={isActive ? `${styles.item} ${styles.active}` : styles.item}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => props.onTabChange(item.key)}
            >
              <item.Icon size={20} />
            </button>
          )
        })}
      </div>

      <div className={styles.bottom}>
        <button
          type="button"
          className={styles.item}
          aria-label={`主题：${themeLabel}（点击切换）`}
          onClick={() => props.onThemeChange(nextTheme)}
        >
          <ThemeIcon size={20} />
        </button>
      </div>
    </nav>
  )
}
