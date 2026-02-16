import { DiscoverPanel } from '../panels/DiscoverPanel'
import { ChatsPane } from '../panels/chats/ChatsPane'
import { ContactsPane } from '../panels/contacts/ContactsPane'
import { MePane } from '../panels/me/MePane'
import { IconRail } from './components/IconRail'
import { ToastHost } from './components/ToastHost'
import { useAppActions, useAppState } from '../state/hooks'
import styles from './WorkbenchShell.module.css'
import { useResolvedTheme } from '../utils/theme'

/**
 * 三栏壳层：左 Tab / 中列表 / 右内容
 *
 * - 功能：渲染仿微信桌面端的三栏布局，并根据 activeTab 注入对应 Pane
 * - 依赖：全局状态（activeTab、theme、fontSize 等）
 */
export function WorkbenchShell() {
  const state = useAppState()
  const actions = useAppActions()
  const resolvedTheme = useResolvedTheme(state.persisted.settings.theme)

  const content = (() => {
    switch (state.persisted.activeTab) {
      case 'chats':
        return <ChatsPane />
      case 'contacts':
        return <ContactsPane />
      case 'discover':
        return <DiscoverPanel />
      case 'me':
        return <MePane />
      default:
        return null
    }
  })()

  return (
    <div
      className={styles.root}
      data-theme={resolvedTheme}
      data-font={state.persisted.settings.fontSize}
    >
      <div className={styles.rail}>
        <IconRail
          activeTab={state.persisted.activeTab}
          onTabChange={actions.setActiveTab}
          theme={state.persisted.settings.theme}
          onThemeChange={(next) => actions.patchSettings({ theme: next })}
        />
      </div>

      <div className={styles.main}>{content}</div>

      <ToastHost toasts={state.toasts} onDismiss={actions.dismissToast} />
    </div>
  )
}
