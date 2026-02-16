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

  const selectedContact =
    state.persisted.selectedContactId == null
      ? null
      : state.persisted.contacts.find((c) => c.id === state.persisted.selectedContactId) ?? null

  const list = (
    <>
      <PaneHeader title="通讯录" />
      <ContactList
        contacts={state.persisted.contacts}
        selectedContactId={state.persisted.selectedContactId}
        onSelect={actions.selectContact}
      />
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

