import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { STORAGE_KEY } from './state/constants'

describe('A11y guardrails', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('主导航具备 aria-label，且当前 tab 具备 aria-current="page"', () => {
    render(<App />)

    const nav = screen.getByRole('navigation', { name: '主导航' })
    const chats = screen.getByRole('button', { name: '聊天' })
    const contacts = screen.getByRole('button', { name: '通讯录' })
    const discover = screen.getByRole('button', { name: '发现' })
    const me = screen.getByRole('button', { name: '我' })

    expect(nav).toContainElement(chats)
    expect(nav).toContainElement(contacts)
    expect(nav).toContainElement(discover)
    expect(nav).toContainElement(me)

    expect(chats).toHaveAttribute('aria-current', 'page')
    expect(contacts).not.toHaveAttribute('aria-current')
    expect(discover).not.toHaveAttribute('aria-current')
    expect(me).not.toHaveAttribute('aria-current')
  })

  it('ToastHost 使用 aria-live="polite"', () => {
    render(<App />)

    const toastHost = document.querySelector('[aria-live="polite"][aria-relevant="additions removals"]')
    expect(toastHost).not.toBeNull()
  })

  it('icon-only 按钮必须具备可访问名称（aria-label 或 aria-labelledby）', () => {
    render(<App />)

    const iconOnlyButtons = Array.from(document.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim().length === 0)
    expect(iconOnlyButtons.length).toBeGreaterThan(0)

    for (const button of iconOnlyButtons) {
      const hasName = Boolean(button.getAttribute('aria-label') || button.getAttribute('aria-labelledby'))
      expect(hasName).toBe(true)
    }
  })

  it('键盘 Tab 可聚焦到“消息输入框”与“发送文本”按钮', async () => {
    const user = userEvent.setup()
    render(<App />)

    const textarea = await screen.findByLabelText('消息输入框')
    const sendButton = screen.getByRole('button', { name: '发送文本' })

    let focusedTextarea = false
    for (let i = 0; i < 30; i += 1) {
      await user.tab()
      if (textarea === document.activeElement) {
        focusedTextarea = true
        break
      }
    }
    expect(focusedTextarea).toBe(true)
    expect(textarea).toHaveFocus()

    let focusedSendButton = false
    for (let i = 0; i < 30; i += 1) {
      await user.tab()
      if (sendButton === document.activeElement) {
        focusedSendButton = true
        break
      }
    }
    expect(focusedSendButton).toBe(true)
    expect(sendButton).toHaveFocus()
  })
})

