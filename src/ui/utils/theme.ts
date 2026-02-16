import { useEffect, useMemo, useState } from 'react'
import type { ThemeSetting } from '../state/types'

/**
 * 把 theme 设置（light/dark/system）解析为最终主题（light/dark）
 *
 * @param theme 用户设置
 * @returns 'light' | 'dark'（用于 data-theme）
 */
export function useResolvedTheme(theme: ThemeSetting): 'light' | 'dark' {
  const [system, setSystem] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const handler = () => setSystem(mq.matches ? 'dark' : 'light')
    handler()
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [])

  return useMemo(() => {
    return theme === 'system' ? system : theme
  }, [theme, system])
}

