import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/')
})

test('主导航：可切换 Chats/Contacts/Discover/Me（四个 Tab）', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '主导航' })

  await nav.getByRole('button', { name: '聊天' }).click()
  await expect(page.getByRole('heading', { name: '聊天' })).toBeVisible()

  await nav.getByRole('button', { name: '通讯录' }).click()
  await expect(page.getByRole('heading', { name: '通讯录' })).toBeVisible()

  await nav.getByRole('button', { name: '发现' }).click()
  await expect(page.getByRole('heading', { name: '发现' })).toBeVisible()

  await nav.getByRole('button', { name: '我' }).click()
  await expect(page.getByRole('heading', { name: '我' })).toBeVisible()
})

