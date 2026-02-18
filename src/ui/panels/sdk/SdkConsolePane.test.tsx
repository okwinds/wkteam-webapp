import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppProvider } from '../../state/AppProvider'
import { ConnectionProvider } from '../../remote/ConnectionProvider'
import { SdkConsolePane } from './SdkConsolePane'
import { saveConnectionSettings } from '../../remote/connectionStore'

describe('SdkConsolePane', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
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

    await user.click(screen.getAllByRole('button', { name: '执行' })[0])

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

  it('strip data: prefix when toggle is on for base64 fields', async () => {
    // Setup BFF connection
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
                operationId: 'op_sendFile',
                title: 'Send File',
                module: 'test',
                method: 'POST',
                path: '/sendFile',
                headers: [{ name: 'Authorization', value: 'login' }],
                params: [{ 参数名: 'base64', 必选: '是', 类型: 'String', 说明: 'base64' }]
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

    // Wait for catalog to load
    await screen.findAllByText('op_sendFile')

    // Type a data URL in the base64 field
    const base64Input = await screen.findByLabelText('参数 base64')
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    await user.type(base64Input, dataUrl)

    // Execute
    await user.click(screen.getAllByRole('button', { name: '执行' })[0])

    // Check the payload has the data: prefix stripped
    const call = fetchMock.mock.calls.find((c) => String(c[0]) === 'http://127.0.0.1/api/upstream/call')
    expect(call).toBeTruthy()
    const init = call?.[1] as RequestInit
    const body = JSON.parse(String(init?.body))
    expect(body.params.base64).toBe('iVBORw0KGgo=')
  })

  it('shows validation error for invalid base64 format', async () => {
    // Setup BFF connection
    localStorage.setItem(
      'wkteam.connection.v1.settings',
      JSON.stringify({ mode: 'server', baseUrl: 'http://127.0.0.1', tokenPersistence: 'session' })
    )
    sessionStorage.setItem('wkteam.connection.v1.token', 'bff_token_1234567890')

    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '')
      if (url === '/wkteam-api-catalog.json') {
        return new Response(
          JSON.stringify({
            generatedAt: '2026-02-14T00:00:00.000Z',
            catalog: [
              {
                kind: 'endpoint',
                operationId: 'op_sendFile2',
                title: 'Send File 2',
                module: 'test',
                method: 'POST',
                path: '/sendFile2',
                headers: [{ name: 'Authorization', value: 'login' }],
                params: [{ 参数名: 'base64', 必选: '是', 类型: 'String', 说明: 'base64' }]
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
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

    // Wait for catalog to load - operationId may appear in multiple places
    await screen.findAllByText('op_sendFile2')

    // Type invalid base64 (contains invalid characters)
    const base64Input = await screen.findByLabelText('参数 base64')
    await user.type(base64Input, 'not-valid-base64!!!')

    // Execute - use the first execute button in the right panel
    await user.click(screen.getAllByRole('button', { name: '执行' })[0])

    // Should show validation error
    await waitFor(() => {
      expect(screen.getByText(/无效的 base64 格式/)).toBeInTheDocument()
    })
  })

  it('保存 wkteamWId 后，SDK 控制台在选中 endpoint 时 wId 参数会被自动填入', async () => {
    // 先保存 wkteamWId 到 connection settings
    saveConnectionSettings({ wkteamWId: '23456789012' })

    // 设置 BFF 连接
    localStorage.setItem(
      'wkteam.connection.v1.settings',
      JSON.stringify({
        mode: 'server',
        baseUrl: 'http://127.0.0.1',
        tokenPersistence: 'session',
        wkteamWId: '23456789012'
      })
    )
    sessionStorage.setItem('wkteam.connection.v1.token', 'bff_token_1234567890')

    const fetchMock = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '')
      if (url === '/wkteam-api-catalog.json') {
        return new Response(
          JSON.stringify({
            generatedAt: '2026-02-14T00:00:00.000Z',
            catalog: [
              {
                kind: 'endpoint',
                operationId: 'op_sendText',
                title: 'Send Text',
                module: 'test',
                method: 'POST',
                path: '/sendText',
                headers: [{ name: 'Authorization', value: 'login' }],
                params: [
                  { 参数名: 'wId', 必选: '是', 类型: 'String', 说明: '登录实例标识' },
                  { 参数名: 'wcId', 必选: '是', 类型: 'String', 说明: '联系人ID' }
                ]
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    render(
      <AppProvider>
        <ConnectionProvider>
          <SdkConsolePane />
        </ConnectionProvider>
      </AppProvider>
    )

    // 等待 catalog 加载
    await screen.findAllByText('op_sendText')

    // 验证 wId 输入框已经被自动填充
    const wIdInput = await screen.findByLabelText('参数 wId') as HTMLInputElement
    expect(wIdInput.value).toBe('23456789012')

    // 验证 wcId 等其他参数为空（未自动填充）
    const wcIdInput = await screen.findByLabelText('参数 wcId') as HTMLInputElement
    expect(wcIdInput.value).toBe('')
  })
})
