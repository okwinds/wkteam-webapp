// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { loadWkteamCatalogMap } from './wkteamCatalog'

describe('loadWkteamCatalogMap', () => {
  it('loads default public catalog and includes te_shu_cdnDownFile', async () => {
    const map = await loadWkteamCatalogMap('public/wkteam-api-catalog.json')
    expect(map.size).toBeGreaterThan(0)
    expect(map.has('te_shu_cdnDownFile')).toBe(true)
  })
})
