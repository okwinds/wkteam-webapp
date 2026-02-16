import { useContext } from 'react'
import type { AppActions } from './AppProvider'
import { ActionsContext, StateContext } from './AppProvider'
import type { AppState } from './types'

/**
 * 读取全局状态
 *
 * @returns AppState（含 persisted + toasts）
 */
export function useAppState(): AppState {
  const v = useContext(StateContext)
  if (!v) throw new Error('useAppState must be used within AppProvider')
  return v
}

/**
 * 读取全局 actions
 *
 * @returns AppActions（包含副作用封装）
 */
export function useAppActions(): AppActions {
  const v = useContext(ActionsContext)
  if (!v) throw new Error('useAppActions must be used within AppProvider')
  return v
}

