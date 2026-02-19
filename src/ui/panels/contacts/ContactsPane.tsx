import { useCallback, useState } from 'react'
import { TwoPaneLayout } from '../shared/TwoPaneLayout'
import { PaneHeader } from '../shared/PaneHeader'
import { useAppActions, useAppState } from '../../state/hooks'
import { useConnectionState } from '../../remote/ConnectionProvider'
import { ContactList } from './components/ContactList'
import { ContactCard } from './components/ContactCard'
import styles from './ContactsPane.module.css'

/**
 * Contacts 模块：中栏联系人列表 + 右侧联系人详情
 */
export function ContactsPane() {
  const state = useAppState()
  const actions = useAppActions()
  const connection = useConnectionState()
  const [opening, setOpening] = useState(false)

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

  const openRemoteChat = useCallback(async () => {
    if (!selectedContact) return
    if (connection.settings.mode !== 'server') {
      actions.openDmWithContact(selectedContact.id)
      return
    }

    if (!connection.client || connection.status !== 'connected') {
      actions.pushToast({ kind: 'error', title: '未连接', detail: '请先在设置中配置服务端并测试连接。' })
      return
    }

    const wId = (connection.settings.wkteamWId ?? '').trim()
    if (!wId) {
      actions.pushToast({ kind: 'error', title: '缺少 wId', detail: '请先在设置中填写 wId（用于生成 wk 会话 id）。' })
      return
    }

    const peerKind = selectedContact.id.startsWith('g_') ? 'g' : 'u'
    const peerId = (window.prompt('peerId（上游对端标识：wxid / chatroomId）', selectedContact.id) ?? '').trim()
    if (!peerId) {
      actions.pushToast({ kind: 'error', title: '开聊失败', detail: 'peerId 不能为空。' })
      return
    }

    const conversationId = `wk:${wId}:${peerKind}:${peerId}`
    setOpening(true)
    try {
      const c = await connection.client.createConversation({
        title: selectedContact.displayName,
        peerId,
        conversationId
      })
      actions.selectConversation(c.id)
      actions.setActiveTab('chats')
    } catch (e) {
      actions.pushToast({ kind: 'error', title: '开聊失败', detail: e instanceof Error ? e.message : '未知错误' })
    } finally {
      setOpening(false)
    }
  }, [actions, connection.client, connection.settings.mode, connection.settings.wkteamWId, connection.status, selectedContact])

  const content = selectedContact ? (
    <div className={styles.empty}>
      <ContactCard contact={selectedContact} onMessage={() => void openRemoteChat()} />
      {opening ? <div className={styles.emptyDesc}>正在创建会话…</div> : null}
      {connection.settings.mode === 'server' ? (
        <div className={styles.emptyDesc}>提示：server 模式下会创建 `wk:...` 会话，用于与 webhook 入库会话对齐。</div>
      ) : null}
    </div>
  ) : (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>选择一个联系人</div>
      <div className={styles.emptyDesc}>点击“发消息”将自动创建/打开会话并切换到聊天。</div>
    </div>
  )

  return <TwoPaneLayout list={list} content={content} />
}
