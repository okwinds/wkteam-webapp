import React, { createContext, useEffect, useMemo, useReducer, useRef } from 'react'
import type { AppState, PersistedStateV2, Settings, TabKey, ToastItem } from './types'
import { createSeedPersistedState } from './seed'
import { clearPersistedState, exportStateAsJson, importStateFromJson, loadPersistedState, savePersistedState } from './storage'
import { reducer, type Action } from './reducer'
import { downloadTextFile } from '../utils/download'

export type AppActions = {
  setActiveTab: (tab: TabKey) => void
  pushToast: (toast: Omit<ToastItem, 'id'>) => void
  dismissToast: (id: string) => void
  selectConversation: (id: string) => void
  selectContact: (id: string) => void
  togglePinned: (conversationId: string) => void
  deleteConversation: (conversationId: string) => void
  setDraft: (conversationId: string, text: string) => void
  sendText: (conversationId: string, text: string) => void
  sendImage: (conversationId: string, dataUrl: string, alt: string) => void
  sendFile: (conversationId: string, dataUrl: string, name: string, mime: string) => void
  openDmWithContact: (contactId: string) => void
  patchSettings: (patch: Partial<Settings>) => void
  resetData: () => void
  exportData: () => void
  importData: (file: File) => Promise<void>
}

const StateContext = createContext<AppState | null>(null)
const ActionsContext = createContext<AppActions | null>(null)

/**
 * 全局状态 Provider
 *
 * - 功能：负责 localStorage 加载/保存、导入/导出/重置等副作用
 * - 约束：Reducer 必须保持纯函数（不做 IO）
 */
export function AppProvider(props: { children: React.ReactNode }) {
  const initialPersisted = useMemo<PersistedStateV2>(() => {
    const loaded = loadPersistedState()
    if (loaded.ok) return loaded.value
    return createSeedPersistedState(Date.now())
  }, [])

  const [state, dispatch] = useReducer(reducer, { persisted: initialPersisted, toasts: [] } satisfies AppState)
  const lastPersistErrorRef = useRef<string | null>(null)

  useEffect(() => {
    try {
      savePersistedState(state.persisted)
      lastPersistErrorRef.current = null
    } catch (e) {
      const msg = String(e)
      if (lastPersistErrorRef.current !== msg) {
        lastPersistErrorRef.current = msg
        dispatch({
          type: 'toast.push',
          toast: {
            id: `t_${Date.now()}`,
            kind: 'error',
            title: '本地存储失败',
            detail: '写入 localStorage 失败，请尝试清理浏览器空间后重试。'
          }
        })
      }
    }
  }, [state.persisted])

  useEffect(() => {
    const loaded = loadPersistedState()
    if (loaded.ok) return
    if (loaded.reason === 'missing') return

    dispatch({
      type: 'toast.push',
      toast: {
        id: `t_${Date.now()}`,
        kind: 'error',
        title: '数据已重置',
        detail: '检测到本地数据损坏或不兼容，已重置为示例数据。'
      }
    })
    clearPersistedState()
    dispatch({ type: 'state.replacePersisted', next: createSeedPersistedState(Date.now()) })
  }, [])

  const actions = useMemo<AppActions>(() => {
    const pushToast = (toast: Omit<ToastItem, 'id'>) => {
      dispatch({ type: 'toast.push', toast: { id: `t_${Date.now()}_${Math.random().toString(16).slice(2)}`, ...toast } })
    }

    return {
      setActiveTab: (tab) => dispatch({ type: 'tab.set', tab }),
      pushToast,
      dismissToast: (id) => dispatch({ type: 'toast.dismiss', id }),
      selectConversation: (id) => {
        dispatch({ type: 'conversation.select', id })
        dispatch({ type: 'conversation.markRead', id })
      },
      selectContact: (id) => dispatch({ type: 'contact.select', id }),
      togglePinned: (conversationId) => dispatch({ type: 'conversation.togglePinned', id: conversationId }),
      deleteConversation: (conversationId) => dispatch({ type: 'conversation.delete', id: conversationId }),
      setDraft: (conversationId, text) => dispatch({ type: 'draft.set', conversationId, text }),
      sendText: (conversationId, text) => dispatch({ type: 'message.sendText', conversationId, text, nowMs: Date.now() }),
      sendImage: (conversationId, dataUrl, alt) =>
        dispatch({ type: 'message.sendImage', conversationId, dataUrl, alt, nowMs: Date.now() }),
      sendFile: (conversationId, dataUrl, name, mime) =>
        dispatch({ type: 'message.sendFile', conversationId, dataUrl, name, mime, nowMs: Date.now() }),
      openDmWithContact: (contactId) =>
        dispatch({ type: 'conversation.ensureDmWithContact', contactId, nowMs: Date.now() }),
      patchSettings: (patch) => dispatch({ type: 'settings.patch', patch }),
      resetData: () => {
        clearPersistedState()
        dispatch({ type: 'state.replacePersisted', next: createSeedPersistedState(Date.now()) })
        pushToast({ kind: 'info', title: '已重置', detail: '本地数据已重置为示例数据。' })
      },
      exportData: () => {
        try {
          const json = exportStateAsJson(state.persisted)
          downloadTextFile('wechat-lite-export.json', json)
          pushToast({ kind: 'info', title: '已导出', detail: '已开始下载 JSON 文件。' })
        } catch (e) {
          pushToast({ kind: 'error', title: '导出失败', detail: '无法生成导出文件。' })
        }
      },
      importData: async (file) => {
        try {
          const text = await file.text()
          const imported = importStateFromJson(text)
          dispatch({ type: 'state.replacePersisted', next: { ...imported, updatedAt: Date.now() } })
          pushToast({ kind: 'info', title: '导入成功', detail: '已加载导入数据。' })
        } catch (e) {
          pushToast({ kind: 'error', title: '导入失败', detail: e instanceof Error ? e.message : '未知错误' })
        }
      }
    }
  }, [state.persisted])

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{props.children}</StateContext.Provider>
    </ActionsContext.Provider>
  )
}

export { StateContext, ActionsContext }
