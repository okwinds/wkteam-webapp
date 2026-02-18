import { TwoPaneLayout } from '../shared/TwoPaneLayout'
import { PaneHeader } from '../shared/PaneHeader'
import { useAppActions, useAppState } from '../../state/hooks'
import { ContactList } from './components/ContactList'
import { ContactCard } from './components/ContactCard'
import styles from './ContactsPane.module.css'

/**
 * Contacts 模块：中栏联系人列表 + 右侧联系人详情
 */
export function ContactsPane() {
  const state = useAppState()
  const actions = useAppActions()

  const friends = state.persisted.contacts.filter((c) => c.id.startsWith('c_'))
  const groups = state.persisted.contacts.filter((c) => c.id.startsWith('g_'))
  const others = state.persisted.contacts.filter((c) => !c.id.startsWith('c_') && !c.id.startsWith('g_'))

  const selectedContact =
    state.persisted.selectedContactId == null
      ? null
      : state.persisted.contacts.find((c) => c.id === state.persisted.selectedContactId) ?? null

  const list = (
    <>
      <PaneHeader title="通讯录" />
      <div className={styles.scroll} aria-label="通讯录滚动区">
        <div className={styles.section}>
          <div className={styles.sectionTitle}>好友</div>
          <ContactList
            contacts={[...friends, ...others]}
            ariaLabel="好友列表"
            selectedContactId={state.persisted.selectedContactId}
            onSelect={actions.selectContact}
          />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>群聊</div>
          <ContactList
            contacts={groups}
            ariaLabel="群聊列表"
            selectedContactId={state.persisted.selectedContactId}
            onSelect={actions.selectContact}
          />
        </div>
      </div>
    </>
  )

  const content = selectedContact ? (
    <ContactCard contact={selectedContact} onMessage={() => actions.openDmWithContact(selectedContact.id)} />
  ) : (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>选择一个联系人</div>
      <div className={styles.emptyDesc}>点击“发消息”将自动创建/打开 DM 会话并切换到聊天。</div>
    </div>
  )

  return <TwoPaneLayout list={list} content={content} />
}
