import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { STORAGE_KEY } from './state/constants'

describe('App', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('可以发送一条文本消息并出现在消息列表中', async () => {
    const user = userEvent.setup()
    render(<App />)

    const textarea = await screen.findByLabelText('消息输入框')
    await user.type(textarea, '测试消息')
    await user.keyboard('{Enter}')

    const nodes = await screen.findAllByText('测试消息')
    expect(nodes.length).toBeGreaterThan(0)
  })
})
