import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCatalog } from './catalog'

describe('loadCatalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('规范化 endpoint 条目并推断 requiresAuth', async () => {
    const sample = {
      generatedAt: '2026-02-10T00:00:00Z',
      catalog: [
        {
          kind: 'endpoint',
          operationId: 'm_sendText',
          title: '发送文本消息',
          module: 'xiao-xi-fa-song',
          method: 'POST',
          path: '/sendText',
          doc: 'docs/api/xxx.md',
          headers: [{ name: 'Authorization', value: 'login接口返回' }],
          params: [{ 参数名: 'wId', 必选: '是', 类型: 'String', 说明: '登录实例标识' }]
        },
        { kind: 'note', foo: 'bar' }
      ]
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => sample
      }))
    )

    const c = await loadCatalog()
    expect(c.endpoints).toHaveLength(1)
    expect(c.endpoints[0]!.requiresAuth).toBe(true)
    expect(c.endpoints[0]!.params[0]!.name).toBe('wId')
  })
})
