import { afterEach, describe, expect, it, vi } from 'vitest'
import { callEndpoint } from './client'
import type { CatalogEndpoint } from './types'

describe('callEndpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('从 envelope 中提取 data，同时保留 raw', async () => {
    const endpoint: CatalogEndpoint = {
      operationId: 'op',
      title: 't',
      module: 'm',
      method: 'POST',
      path: '/x',
      doc: '',
      requiresAuth: false,
      params: []
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { hello: 'world' } })
      }))
    )

    const res = await callEndpoint({ baseUrl: 'https://api.example.com', authorization: 'x' }, endpoint, { a: '1' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toEqual({ hello: 'world' })
      expect(res.raw).toEqual({ code: 0, data: { hello: 'world' } })
    }
  })
})
