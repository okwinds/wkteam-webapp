import { readFile } from 'node:fs/promises'
import { z } from 'zod'

export type WkteamEndpointDef = {
  operationId: string
  method: string
  path: string
  title?: string
  module?: string
}

const endpointSchema = z.object({
  kind: z.literal('endpoint'),
  operationId: z.string().min(1),
  method: z.string().min(1),
  path: z.string().min(1),
  title: z.string().optional(),
  module: z.string().optional()
})

const catalogSchema = z.object({
  generatedAt: z.number().optional(),
  catalog: z.array(z.unknown())
})

/**
 * 读取 wkteam api catalog（JSON）
 *
 * - 功能：从文件读取 catalog，并构建 operationId → endpointDef 的映射
 * - 参数：filePath catalog 路径
 * - 返回：Map（operationId -> def）
 * - 错误：文件不存在/JSON 不合法/结构不合法会抛出异常（启动期失败）
 */
export async function loadWkteamCatalogMap(filePath: string): Promise<Map<string, WkteamEndpointDef>> {
  const raw = await readFile(filePath, 'utf-8')
  const parsed = catalogSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error('WKTEAM_CATALOG_INVALID: invalid top-level structure')
  }

  const map = new Map<string, WkteamEndpointDef>()
  for (const item of parsed.data.catalog) {
    const ep = endpointSchema.safeParse(item)
    if (!ep.success) continue
    map.set(ep.data.operationId, {
      operationId: ep.data.operationId,
      method: ep.data.method,
      path: ep.data.path,
      title: ep.data.title,
      module: ep.data.module
    })
  }

  if (map.size === 0) {
    throw new Error('WKTEAM_CATALOG_INVALID: no endpoints found')
  }

  return map
}

