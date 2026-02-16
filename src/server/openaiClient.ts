import { z } from 'zod'

export type OpenAiCompatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenAiCompatClient = {
  chatCompletions: (input: {
    baseUrl: string
    path: string
    apiKey: string
    model: string
    timeoutMs: number
    messages: OpenAiCompatMessage[]
  }) => Promise<{ content: string }>
}

const responseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable().optional()
      })
    })
  )
})

/**
 * OpenAI 兼容客户端（最小实现）
 *
 * - 功能：调用 chat completions 并解析为单段文本
 * - 约束：不做自动重试（避免重复计费）；错误以结构化异常返回
 */
export function createOpenAiCompatClient(fetchImpl: typeof fetch): OpenAiCompatClient {
  return {
    async chatCompletions(input) {
      const url = `${input.baseUrl.replace(/\/$/, '')}${input.path.startsWith('/') ? input.path : `/${input.path}`}`
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), input.timeoutMs)

      try {
        const resp = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${input.apiKey}`
          },
          body: JSON.stringify({
            model: input.model,
            messages: input.messages
          }),
          signal: controller.signal
        })

        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          throw new Error(`AI_UPSTREAM_ERROR: ${resp.status} ${text}`.slice(0, 400))
        }

        const json = await resp.json()
        const parsed = responseSchema.safeParse(json)
        if (!parsed.success) {
          throw new Error('AI_BAD_RESPONSE: invalid response schema')
        }

        const content = parsed.data.choices[0]?.message?.content ?? ''
        return { content: String(content ?? '').trim() }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          throw new Error('AI_TIMEOUT: request aborted by timeout')
        }
        throw e instanceof Error ? e : new Error('AI_UNKNOWN_ERROR')
      } finally {
        clearTimeout(t)
      }
    }
  }
}
