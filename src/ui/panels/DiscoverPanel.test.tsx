import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App'
import { STORAGE_KEY } from '../state/constants'
import { createSeedPersistedState } from '../state/seed'

describe('DiscoverPanel', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  it('点击发现入口会切换右栏内容（非 SDK 控制台入口）', async () => {
    const user = userEvent.setup()
    const seeded = createSeedPersistedState(1_700_000_000_000)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...seeded,
        activeTab: 'discover' as const
      })
    )

    render(<App />)

    const list = await screen.findByRole('list', { name: '发现入口列表' })
    expect(list).toBeTruthy()

    // 默认选中应为 朋友圈
    expect(await screen.findByRole('heading', { name: '朋友圈' })).toBeTruthy()

    await user.click(screen.getByText('收藏'))
    expect(await screen.findByRole('heading', { name: '收藏' })).toBeTruthy()

    await user.click(screen.getByText('视频号'))
    expect(await screen.findByRole('heading', { name: '视频号' })).toBeTruthy()
  })
})

