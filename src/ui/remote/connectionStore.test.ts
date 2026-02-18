import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadConnectionSettings,
  saveConnectionSettings,
  type ConnectionSettings
} from './connectionStore'

describe('connectionStore', () => {
  const SETTINGS_KEY = 'wkteam.connection.v1.settings'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('loadConnectionSettings', () => {
    it('返回默认值当 localStorage 为空', () => {
      const settings = loadConnectionSettings()
      expect(settings.mode).toBe('local')
      expect(settings.baseUrl).toBe('')
      expect(settings.tokenPersistence).toBe('session')
      expect(settings.wkteamWId).toBe('')
    })

    it('正确加载已保存的 wkteamWId', () => {
      const saved: ConnectionSettings = {
        mode: 'server',
        baseUrl: 'http://localhost:8787',
        tokenPersistence: 'local',
        wkteamWId: '23456789012'
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved))

      const settings = loadConnectionSettings()
      expect(settings.wkteamWId).toBe('23456789012')
    })

    it('处理非字符串的 wkteamWId', () => {
      const saved = {
        mode: 'server',
        baseUrl: '',
        tokenPersistence: 'session',
        wkteamWId: 12345 // 数字而非字符串
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved))

      const settings = loadConnectionSettings()
      expect(settings.wkteamWId).toBe('') // 回退到默认值
    })
  })

  describe('saveConnectionSettings', () => {
    it('保存 wkteamWId 到 localStorage', () => {
      saveConnectionSettings({ wkteamWId: '12345678901' })

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)!)
      expect(saved.wkteamWId).toBe('12345678901')
    })

    it('合并部分更新，保留其他字段', () => {
      // 先设置初始值
      saveConnectionSettings({
        mode: 'server',
        baseUrl: 'http://example.com',
        tokenPersistence: 'local',
        wkteamWId: 'initial'
      })

      // 只更新 wkteamWId
      saveConnectionSettings({ wkteamWId: 'updated' })

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)!)
      expect(saved.mode).toBe('server')
      expect(saved.baseUrl).toBe('http://example.com')
      expect(saved.tokenPersistence).toBe('local')
      expect(saved.wkteamWId).toBe('updated')
    })
  })
})
