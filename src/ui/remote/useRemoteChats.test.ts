import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRemoteChats } from './useRemoteChats'
import type { BffClient } from './bffClient'

// Mock connectionStore to avoid localStorage access
vi.mock('./connectionStore', () => ({
  loadConnectionSettings: vi.fn(() => ({ mode: 'server', baseUrl: 'http://localhost', tokenPersistence: 'session' })),
  loadApiToken: vi.fn(() => 'test-token')
}))

describe('useRemoteChats', () => {
  let mockClient: BffClient
  let eventSourceMock: any
  let eventSourceInstances: any[] = []

  beforeEach(() => {
    // Reset EventSource mock tracking
    eventSourceInstances = []

    // Mock EventSource
    eventSourceMock = vi.fn(function(this: any, url: string) {
      this.url = url
      this.onopen = null
      this.onmessage = null
      this.onerror = null
      this.addEventListener = vi.fn((event: string, handler: any) => {
        if (event === 'message.created') {
          this._messageCreatedHandler = handler
        }
      })
      this.close = vi.fn()
      // Store reference for triggering events in tests
      eventSourceInstances.push(this)
    })
    vi.stubGlobal('EventSource', eventSourceMock)

    mockClient = {
      testAuth: vi.fn().mockResolvedValue('ok'),
      listConversations: vi.fn().mockResolvedValue([]),
      createConversation: vi.fn(),
      deleteConversation: vi.fn(),
      setPinned: vi.fn(),
      listMessages: vi.fn().mockResolvedValue([]),
      sendText: vi.fn(),
      sendImage: vi.fn(),
      sendFile: vi.fn(),
      aiReply: vi.fn(),
      getAutomationStatus: vi.fn(),
      setAutomationStatus: vi.fn(),
      callUpstream: vi.fn(),
      hydrateMessage: vi.fn().mockResolvedValue({
        id: 'hydrated-message',
        conversationId: 'c1',
        direction: 'inbound',
        source: 'system',
        sentAt: 0,
        kind: 'text',
        text: ''
      })
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useRemoteChats(null))

    expect(result.current.conversations).toEqual([])
    expect(result.current.messages).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.connectionStatus).toBe('idle')
  })

  it('should call refresh when client becomes available', async () => {
    const listConversations = vi.fn().mockResolvedValue([])
    mockClient = { ...mockClient, listConversations, listMessages: vi.fn().mockResolvedValue([]) }

    const { rerender } = renderHook(({ client }) => useRemoteChats(client), {
      initialProps: { client: null as BffClient | null }
    })

    // Initial render with null client should not call listConversations
    expect(listConversations).not.toHaveBeenCalled()

    // Rerender with client should trigger refresh
    rerender({ client: mockClient })

    await waitFor(() => {
      expect(listConversations).toHaveBeenCalled()
    })
  })

  it('should establish SSE connection when client and connection info are available', async () => {
    const { rerender } = renderHook(({ client }) => useRemoteChats(client), {
      initialProps: { client: null as BffClient | null }
    })

    // With null client, no EventSource should be created
    expect(eventSourceMock).not.toHaveBeenCalled()

    // Rerender with client
    rerender({ client: mockClient })

    // EventSource should be created
    await waitFor(() => {
      expect(eventSourceInstances.length).toBeGreaterThan(0)
    })
  })

  it('should trigger refresh when message.created SSE event is received', async () => {
    const listConversations = vi.fn().mockResolvedValue([])
    const listMessages = vi.fn().mockResolvedValue([])
    mockClient = { ...mockClient, listConversations, listMessages }

    const { result } = renderHook(() => useRemoteChats(mockClient))

    // Wait for EventSource to be created
    await waitFor(() => {
      expect(eventSourceInstances.length).toBeGreaterThan(0)
    })

    // Reset the mock counts after initial setup
    listConversations.mockClear()

    // Get the last EventSource instance and trigger the message.created event
    const es = eventSourceInstances[eventSourceInstances.length - 1]

    // Simulate open
    if (es.onopen) es.onopen()

    // Trigger message.created event
    if (es._messageCreatedHandler) {
      await act(async () => {
        es._messageCreatedHandler({ data: '{"conversationId":"c1","messageId":"m1"}' })
      })
    }

    // Verify refresh was called (listConversations should be called)
    await waitFor(() => {
      expect(listConversations).toHaveBeenCalled()
    })
  })

  it('should fallback to polling when SSE connection fails', async () => {
    vi.useFakeTimers()

    const listConversations = vi.fn().mockResolvedValue([])
    mockClient = { ...mockClient, listConversations }

    renderHook(() => useRemoteChats(mockClient))

    // renderHook 已在 act 内执行 effects；此处应已创建 EventSource
    expect(eventSourceInstances.length).toBeGreaterThan(0)

    // Reset mock after initial call
    listConversations.mockClear()

    // Get the last EventSource instance and trigger error
    const es = eventSourceInstances[eventSourceInstances.length - 1]
    if (es.onerror) es.onerror()

    // Fast-forward past the polling interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // Verify that polling triggered refresh (avoid waitFor with fake timers)
    expect(listConversations).toHaveBeenCalled()
  })
})
