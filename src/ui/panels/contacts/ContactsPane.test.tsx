import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../App'
import { STORAGE_KEY } from '../../state/constants'
import { createSeedPersistedState } from '../../state/seed'

describe('ContactsPane', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('通讯录显示好友/群聊分区，并且分区列表可见', async () => {
    const seeded = createSeedPersistedState(1_700_000_000_000)
    const state = {
      ...seeded,
      activeTab: 'contacts' as const,
      contacts: [
        { id: 'c_alice', displayName: 'Alice', avatarSeed: 'alice' },
        { id: 'g_team', displayName: '团队群', avatarSeed: 'team' }
      ],
      selectedContactId: null
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<App />)

    expect(await screen.findByText('好友')).toBeTruthy()
    expect(await screen.findByText('群聊')).toBeTruthy()

    const friends = screen.getByRole('list', { name: '好友列表' })
    const groups = screen.getByRole('list', { name: '群聊列表' })

    expect(friends).toBeTruthy()
    expect(groups).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('团队群')).toBeTruthy()
  })

  it('在群聊条目点击发消息，会切换到聊天并创建会话', async () => {
    const user = userEvent.setup()
    const seeded = createSeedPersistedState(1_700_000_000_000)
    const state = {
      ...seeded,
      activeTab: 'contacts' as const,
      contacts: [{ id: 'g_team', displayName: '团队群', avatarSeed: 'team' }],
      selectedContactId: 'g_team'
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    render(<App />)

    const btn = await screen.findByRole('button', { name: '发消息' })
    await user.click(btn)

    // Chats pane empty state should not show when a conversation is opened
    expect(screen.queryByText('从通讯录选择联系人开始聊天')).toBeNull()
    // The newly created conversation title should be visible somewhere in chats list/content
    expect(await screen.findAllByText('团队群')).toBeTruthy()
  })
})

