import { z } from 'zod'
import type { Catalog, CatalogEndpoint } from './types'

const zParamRaw = z
  .object({
    参数名: z.string(),
    必选: z.string().optional(),
    类型: z.string().optional(),
    说明: z.string().optional()
  })
  .passthrough()

const zHeaderRaw = z
  .object({
    name: z.string(),
    value: z.string().optional()
  })
  .passthrough()

const zCatalogItem = z
  .object({
    kind: z.string(),
    operationId: z.string().optional(),
    title: z.string().optional(),
    module: z.string().optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    doc: z.string().optional(),
    headers: z.array(zHeaderRaw).optional(),
    params: z.array(zParamRaw).optional()
  })
  .passthrough()

const zCatalogFile = z.object({
  generatedAt: z.string(),
  catalog: z.array(zCatalogItem)
})

/**
 * 加载并规范化 wkteam API catalog（从 public/wkteam-api-catalog.json）
 *
 * @returns 规范化后的 Catalog（仅保留 endpoint 条目）
 */
export async function loadCatalog(): Promise<Catalog> {
  const resp = await fetch('/wkteam-api-catalog.json', { cache: 'no-store' })
  if (!resp.ok) throw new Error(`catalog 加载失败：HTTP ${resp.status}`)
  const raw = await resp.json()
  const parsed = zCatalogFile.parse(raw)

  const endpoints: CatalogEndpoint[] = parsed.catalog
    .filter((it) => it.kind === 'endpoint')
    .map((it) => normalizeEndpoint(it))
    .filter((e): e is CatalogEndpoint => e != null)

  return { generatedAt: parsed.generatedAt, endpoints }
}

function normalizeEndpoint(it: z.infer<typeof zCatalogItem>): CatalogEndpoint | null {
  const operationId = it.operationId
  const title = it.title
  const module = it.module
  const method = it.method
  const path = it.path
  const doc = it.doc ?? ''
  if (!operationId || !title || !module || !method || !path) return null

  const requiresAuth = Boolean(it.headers?.some((h) => h.name.toLowerCase() === 'authorization'))
  const params = (it.params ?? []).map((p) => ({
    name: p['参数名'],
    required: String(p['必选'] ?? '').trim() === '是',
    type: String(p['类型'] ?? '').trim() || 'String',
    desc: String(p['说明'] ?? '').trim()
  }))

  return { operationId, title, module, method, path, doc, requiresAuth, params }
}

