import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/')
})

test('Chats：发送文本消息后出现在消息列表', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '主导航' })
  await nav.getByRole('button', { name: '聊天' }).click()
  await expect(page.getByRole('heading', { name: '聊天' })).toBeVisible()

  const messageText = `e2e-text-${Date.now()}`
  await page.getByLabel('消息输入框').fill(messageText)
  await page.getByRole('button', { name: '发送文本' }).click()

  const messageList = page.locator('[aria-label="消息列表"]')
  await expect(messageList.getByText(messageText)).toBeVisible()
})

