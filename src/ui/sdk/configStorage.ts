import type { SdkConfig } from './types'

const BASE_URL_KEY = 'wkteam.sdk.base_url'
const AUTH_KEY = 'wkteam.sdk.authorization'
const REMEMBER_AUTH_KEY = 'wkteam.sdk.remember_authorization'

/**
 * 读取 SDK 配置（localStorage）
 *
 * 注意：authorization 可能是敏感信息，仅用于本地。不要写入仓库。
 */
export function loadSdkConfig(): SdkConfig {
  const remember = (localStorage.getItem(REMEMBER_AUTH_KEY) ?? '') === '1'
  return {
    baseUrl: localStorage.getItem(BASE_URL_KEY) ?? '',
    authorization: (remember ? localStorage : sessionStorage).getItem(AUTH_KEY) ?? ''
  }
}

/**
 * 保存 SDK 配置（localStorage）
 *
 * @param cfg SDK 配置
 */
export function saveSdkConfig(cfg: SdkConfig): void {
  const remember = (localStorage.getItem(REMEMBER_AUTH_KEY) ?? '') === '1'
  localStorage.setItem(BASE_URL_KEY, cfg.baseUrl)
  ;(remember ? localStorage : sessionStorage).setItem(AUTH_KEY, cfg.authorization)
}

/**
 * 清空 SDK 配置（localStorage）
 */
export function clearSdkConfig(): void {
  localStorage.removeItem(BASE_URL_KEY)
  localStorage.removeItem(AUTH_KEY)
  sessionStorage.removeItem(AUTH_KEY)
  localStorage.removeItem(REMEMBER_AUTH_KEY)
}

/**
 * 设置是否记住 authorization（影响保存位置：localStorage vs sessionStorage）
 *
 * @param remember 是否记住
 */
export function setRememberAuthorization(remember: boolean): void {
  localStorage.setItem(REMEMBER_AUTH_KEY, remember ? '1' : '0')
  const current = sessionStorage.getItem(AUTH_KEY)
  if (!remember) {
    localStorage.removeItem(AUTH_KEY)
    return
  }
  if (current) localStorage.setItem(AUTH_KEY, current)
}

export function getRememberAuthorization(): boolean {
  return (localStorage.getItem(REMEMBER_AUTH_KEY) ?? '') === '1'
}
