import type { CatalogEndpoint, SdkConfig } from './types'

export type SdkCallResult =
  | { ok: true; data: unknown; raw: unknown }
  | { ok: false; error: { kind: 'network' | 'http' | 'parse'; message: string; status?: number } }

/**
 * 调用某个 endpoint（浏览器 fetch）
 *
 * @param cfg SDK 配置（baseUrl + authorization）
 * @param endpoint endpoint 定义（来自 catalog）
 * @param params 请求参数（会作为 JSON body）
 * @returns 成功/失败结果（失败要可解释）
 */
export async function callEndpoint(cfg: SdkConfig, endpoint: CatalogEndpoint, params: Record<string, unknown>): Promise<SdkCallResult> {
  const url = joinUrl(cfg.baseUrl, endpoint.path)
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  }
  if (endpoint.requiresAuth) headers['authorization'] = cfg.authorization

  let resp: Response
  try {
    resp = await fetch(url, { method: endpoint.method, headers, body: JSON.stringify(params ?? {}) })
  } catch (e) {
    return { ok: false, error: { kind: 'network', message: '网络请求失败（可能是 CORS 或网络不可达）。' } }
  }

  if (!resp.ok) {
    return { ok: false, error: { kind: 'http', message: `HTTP ${resp.status}`, status: resp.status } }
  }

  try {
    const raw = await resp.json()
    const data = (raw && typeof raw === 'object' && 'data' in (raw as any)) ? (raw as any).data : raw
    return { ok: true, data, raw }
  } catch (e) {
    return { ok: false, error: { kind: 'parse', message: '响应解析失败：不是合法 JSON。' } }
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  if (!path.startsWith('/')) return `${b}/${path}`
  return `${b}${path}`
}

