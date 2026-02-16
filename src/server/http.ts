import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'

export type JsonResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/**
 * 读取 JSON 请求体
 *
 * - 功能：在给定字节上限内读取请求体并解析为 JSON
 * - 参数：req 请求对象；maxBytes 最大字节
 * - 返回：解析结果（失败返回结构化错误）
 */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<JsonResult<unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) {
      return { ok: false, error: { code: 'BODY_TOO_LARGE', message: 'request body too large' } }
    }
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf-8')
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, error: { code: 'INVALID_JSON', message: 'invalid json body' } }
  }
}

/**
 * 写 JSON 响应
 *
 * - 功能：统一设置 content-type 并输出 JSON
 * - 参数：res 响应对象；statusCode；payload
 */
export function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

/**
 * 解析 URL 与查询参数
 *
 * - 功能：在 Node http server 中安全解析 req.url
 * - 参数：req
 * - 返回：URL（以 http://localhost 为基准）
 */
export function parseUrl(req: IncomingMessage) {
  return new URL(req.url ?? '/', 'http://localhost')
}

/**
 * 简易路由匹配（支持 `:param`）
 *
 * - 功能：匹配 path 并提取 params
 * - 参数：pattern 例如 `/api/conversations/:id/messages`；pathname 实际路径
 * - 返回：params 或 null（不匹配）
 */
export function matchPath(pattern: string, pathname: string): null | Record<string, string> {
  const p1 = pattern.split('/').filter(Boolean)
  const p2 = pathname.split('/').filter(Boolean)
  if (p1.length !== p2.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < p1.length; i++) {
    const a = p1[i]
    const b = p2[i]
    if (a.startsWith(':')) {
      params[a.slice(1)] = decodeURIComponent(b)
      continue
    }
    if (a !== b) return null
  }
  return params
}

