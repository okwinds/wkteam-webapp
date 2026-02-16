import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppProvider } from '../../state/AppProvider'
import { ConnectionProvider } from '../../remote/ConnectionProvider'
import { SdkConsolePane } from './SdkConsolePane'

describe('SdkConsolePane', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('在 BFF 代理模式下执行 endpoint，会调用 /api/upstream/call（不要求填写 SDK baseUrl）', async () => {
    // 准备 BFF 连接配置（避免在浏览器暴露上游 Authorization）
    localStorage.setItem(
      'wkteam.connection.v1.settings',
      JSON.stringify({ mode: 'server', baseUrl: 'http://127.0.0.1', tokenPersistence: 'session' })
    )
    sessionStorage.setItem('wkteam.connection.v1.token', 'bff_token_1234567890')

    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '')
      if (url === '/wkteam-api-catalog.json') {
        return new Response(
          JSON.stringify({
            generatedAt: '2026-02-14T00:00:00.000Z',
            catalog: [
              {
                kind: 'endpoint',
                operationId: 'op_echo',
                title: 'Echo',
                module: 'test',
                method: 'POST',
                path: '/echo',
                headers: [{ name: 'Authorization', value: 'login接口返回' }],
                params: [{ 参数名: 'wId', 必选: '是', 类型: 'String', 说明: 'wid' }]
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }

      if (url === 'http://127.0.0.1/api/upstream/call') {
        return new Response(JSON.stringify({ ok: true, data: { ok: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const user = userEvent.setup()
    render(
      <AppProvider>
        <ConnectionProvider>
          <SdkConsolePane />
        </ConnectionProvider>
      </AppProvider>
    )

    // 等待 catalog 加载与 endpoint 渲染
    await screen.findAllByText('op_echo')

    const wIdInput = await screen.findByLabelText('参数 wId')
    await user.type(wIdInput, 'wid_001')

    await user.click(screen.getByRole('button', { name: '执行' }))

    const call = fetchMock.mock.calls.find((c) => String(c[0]) === 'http://127.0.0.1/api/upstream/call')
    expect(call).toBeTruthy()
    const init = call?.[1] as RequestInit
    expect(init?.method).toBe('POST')
    expect((init?.headers as any)?.authorization).toBe('Bearer bff_token_1234567890')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      operationId: 'op_echo',
      params: { wId: 'wid_001' }
    })
  })
})
