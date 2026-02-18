import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  beforeEach(() => {
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })
  it('打开时焦点应在取消按钮上', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        open={true}
        title="确认删除"
        description="确定要删除吗？"
        confirmText="删除"
        cancelText="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    const cancelButton = screen.getByRole('button', { name: '取消' })
    await waitFor(() => {
      expect(document.activeElement).toBe(cancelButton)
    })
  })

  it('按下 ESC 键应触发 onCancel', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        open={true}
        title="确认删除"
        description="确定要删除吗？"
        confirmText="删除"
        cancelText="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Tab 键应在按钮之间循环（焦点陷阱）', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        open={true}
        title="确认删除"
        description="确定要删除吗？"
        confirmText="删除"
        cancelText="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    const cancelButton = screen.getByRole('button', { name: '取消' })
    const confirmButton = screen.getByRole('button', { name: '删除' })

    // 初始焦点在取消按钮
    await waitFor(() => {
      expect(document.activeElement).toBe(cancelButton)
    })

    // 按 Tab 应该移动到确认按钮
    await user.tab()
    expect(document.activeElement).toBe(confirmButton)

    // 再按 Tab 应该回到取消按钮（循环）
    await user.tab()
    expect(document.activeElement).toBe(cancelButton)
  })

  it('Shift+Tab 应该反向循环焦点', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        open={true}
        title="确认删除"
        description="确定要删除吗？"
        confirmText="删除"
        cancelText="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    const cancelButton = screen.getByRole('button', { name: '取消' })
    const confirmButton = screen.getByRole('button', { name: '删除' })

    // 初始焦点在取消按钮
    await waitFor(() => {
      expect(document.activeElement).toBe(cancelButton)
    })

    // Shift+Tab 应该从取消按钮移动到确认按钮（反向循环）
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(confirmButton)
  })

  it('点击确认按钮应触发 onConfirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        open={true}
        title="确认删除"
        description="确定要删除吗？"
        confirmText="删除"
        cancelText="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    const confirmButton = screen.getByRole('button', { name: '删除' })
    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('点击取消按钮应触发 onCancel', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ConfirmDialog
        open={true}
        title="确认删除"
        description="确定要删除吗？"
        confirmText="删除"
        cancelText="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    const cancelButton = screen.getByRole('button', { name: '取消' })
    await user.click(cancelButton)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})