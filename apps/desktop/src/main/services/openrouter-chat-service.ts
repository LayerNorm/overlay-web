/**
 * OpenRouter Chat Service - Direct OpenRouter API/SDK usage
 * Avoids Vercel AI SDK to prevent Responses API format issues with OpenRouter models.
 *
 * Used for:
 * - Chat completions (ask mode)
 * - Agent mode (act/write mode) with tools
 */

import { keyCacheService } from './key-cache-service'
import { OPENROUTER_FREE_ROUTER_MODEL_ID, resolveOpenRouterModelId } from './ai/gateway-provider'
import type { ChatMessage } from './chat-service'

// ── Types ───────────────────────────────────────────────────────────────────────

interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | OpenRouterContentPart[] | null
  tool_calls?: OpenRouterToolCall[]
  tool_call_id?: string
  name?: string
}

interface OpenRouterContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

interface OpenRouterToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenRouterTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OpenRouterResponse {
  id: string
  choices: Array<{
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenRouterToolCall[]
    }
    finish_reason: string
    delta?: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  error?: {
    code: string
    message: string
  }
}

// ── OpenRouter Chat Service ─────────────────────────────────────────────────────

class OpenRouterChatService {
  private baseUrl = 'https://openrouter.ai/api/v1'

  private async getApiKey(): Promise<string | null> {
    return keyCacheService.getKey('openrouter')
  }

  private getCandidateModelIds(modelId: string): string[] {
    const resolvedModelId = resolveOpenRouterModelId(modelId)
    if (
      resolvedModelId.endsWith(':free') &&
      resolvedModelId !== OPENROUTER_FREE_ROUTER_MODEL_ID
    ) {
      return [resolvedModelId, OPENROUTER_FREE_ROUTER_MODEL_ID]
    }
    return [resolvedModelId]
  }

  private buildHeaders(apiKey: string, title: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://overlay.app',
      'X-Title': title
    }
  }

  private async readErrorMessage(response: Response): Promise<string> {
    const responseText = await response.text()
    try {
      const parsed = JSON.parse(responseText) as OpenRouterResponse & {
        error?: { message?: string; metadata?: { raw?: string } }
      }
      const rawMessage = parsed.error?.metadata?.raw
      return rawMessage || parsed.error?.message || responseText
    } catch {
      return responseText
    }
  }

  /**
   * Send a chat message to OpenRouter (non-streaming)
   */
  async sendMessage(
    modelId: string,
    messages: ChatMessage[]
  ): Promise<{ success: boolean; response?: string; error?: string }> {
    const apiKey = await this.getApiKey()
    if (!apiKey) {
      return { success: false, error: 'OpenRouter API key not configured' }
    }

    try {
      const formattedMessages = this.formatMessages(messages)
      const candidateModelIds = this.getCandidateModelIds(modelId)
      let lastError = 'OpenRouter request failed'

      for (const candidateModelId of candidateModelIds) {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.buildHeaders(apiKey, 'Overlay Chat'),
          body: JSON.stringify({
            model: candidateModelId,
            messages: formattedMessages
          })
        })

        if (!response.ok) {
          lastError = await this.readErrorMessage(response)
          if (response.status === 429 && candidateModelId !== OPENROUTER_FREE_ROUTER_MODEL_ID) {
            console.warn(
              `[OpenRouterChat] ${candidateModelId} is rate limited, retrying via ${OPENROUTER_FREE_ROUTER_MODEL_ID}`
            )
            continue
          }
          return { success: false, error: lastError }
        }

        const data = (await response.json()) as OpenRouterResponse

        if (data.error) {
          lastError = data.error.message
          return { success: false, error: lastError }
        }

        const content = data.choices?.[0]?.message?.content
        return { success: true, response: content || '' }
      }
      return { success: false, error: lastError }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error('[OpenRouterChat] Error:', error)
      return { success: false, error }
    }
  }

  /**
   * Stream a chat message from OpenRouter
   */
  async streamMessage(
    modelId: string,
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    isCancelled?: () => boolean
  ): Promise<{ success: boolean; fullResponse?: string; error?: string }> {
    const apiKey = await this.getApiKey()
    if (!apiKey) {
      return { success: false, error: 'OpenRouter API key not configured' }
    }

    try {
      const formattedMessages = this.formatMessages(messages)
      const candidateModelIds = this.getCandidateModelIds(modelId)
      let lastError = 'OpenRouter stream failed'

      for (const candidateModelId of candidateModelIds) {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.buildHeaders(apiKey, 'Overlay Chat'),
          body: JSON.stringify({
            model: candidateModelId,
            messages: formattedMessages,
            stream: true
          })
        })

        if (!response.ok) {
          lastError = await this.readErrorMessage(response)
          if (response.status === 429 && candidateModelId !== OPENROUTER_FREE_ROUTER_MODEL_ID) {
            console.warn(
              `[OpenRouterChat] ${candidateModelId} stream is rate limited, retrying via ${OPENROUTER_FREE_ROUTER_MODEL_ID}`
            )
            continue
          }
          return { success: false, error: `HTTP ${response.status}: ${lastError}` }
        }

        const reader = response.body?.getReader()
        if (!reader) {
          return { success: false, error: 'No response body' }
        }

        const decoder = new TextDecoder()
        let fullResponse = ''
        let buffer = ''

        while (true) {
          if (isCancelled?.()) {
            reader.cancel()
            break
          }

          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue

              try {
                const parsed = JSON.parse(data) as OpenRouterResponse
                const content = parsed.choices?.[0]?.delta?.content
                if (content) {
                  fullResponse += content
                  onChunk(content)
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }

        return { success: true, fullResponse }
      }
      return { success: false, error: lastError }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error('[OpenRouterChat] Stream error:', error)
      return { success: false, error }
    }
  }

  /**
   * Stream a chat message from OpenRouter as an async generator (true real-time streaming)
   */
  async *streamMessageGenerator(
    modelId: string,
    messages: ChatMessage[],
    isCancelled?: () => boolean
  ): AsyncGenerator<{ type: 'text' | 'error' | 'done'; content: string }> {
    const apiKey = await this.getApiKey()
    if (!apiKey) {
      yield { type: 'error', content: 'OpenRouter API key not configured' }
      return
    }

    try {
      const formattedMessages = this.formatMessages(messages)
      const candidateModelIds = this.getCandidateModelIds(modelId)

      for (const candidateModelId of candidateModelIds) {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.buildHeaders(apiKey, 'Overlay Chat'),
          body: JSON.stringify({
            model: candidateModelId,
            messages: formattedMessages,
            stream: true
          })
        })

        if (!response.ok) {
          const errorMsg = await this.readErrorMessage(response)
          if (response.status === 429 && candidateModelId !== OPENROUTER_FREE_ROUTER_MODEL_ID) {
            console.warn(
              `[OpenRouterChat] ${candidateModelId} stream is rate limited, retrying via ${OPENROUTER_FREE_ROUTER_MODEL_ID}`
            )
            continue
          }
          yield { type: 'error', content: `HTTP ${response.status}: ${errorMsg}` }
          return
        }

        const reader = response.body?.getReader()
        if (!reader) {
          yield { type: 'error', content: 'No response body' }
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          if (isCancelled?.()) {
            reader.cancel()
            break
          }

          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue

              try {
                const parsed = JSON.parse(data) as OpenRouterResponse
                const content = parsed.choices?.[0]?.delta?.content
                if (content) {
                  yield { type: 'text', content }
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }

        yield { type: 'done', content: '' }
        return
      }

      yield { type: 'error', content: 'OpenRouter stream failed' }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error('[OpenRouterChat] Stream generator error:', error)
      yield { type: 'error', content: error }
    }
  }

  /**
   * Run an agent loop with tools (for act/write mode)
   */
  async runAgentWithTools(
    modelId: string,
    messages: ChatMessage[],
    tools: OpenRouterTool[],
    toolExecutors: Record<string, (args: Record<string, unknown>) => Promise<string>>,
    onEvent: (event: AgentEvent) => void,
    isCancelled: () => boolean,
    maxSteps = 20
  ): Promise<{
    success: boolean
    finalResponse?: string
    error?: string
    usage?: { inputTokens: number; outputTokens: number }
  }> {
    const apiKey = await this.getApiKey()
    if (!apiKey) {
      return { success: false, error: 'OpenRouter API key not configured' }
    }

    const conversationMessages = this.formatMessages(messages)
    const resolvedModelId = resolveOpenRouterModelId(modelId)
    let stepCount = 0

    // Accumulate token usage across all steps
    const totalUsage = { inputTokens: 0, outputTokens: 0 }

    while (stepCount < maxSteps) {
      if (isCancelled()) {
        return { success: true, finalResponse: 'Cancelled by user', usage: totalUsage }
      }

      stepCount++
      onEvent({ type: 'thinking', step: stepCount })

      try {
        const candidateModelIds = this.getCandidateModelIds(resolvedModelId)
        let data: OpenRouterResponse | null = null
        let lastError = 'OpenRouter agent request failed'

        for (const candidateModelId of candidateModelIds) {
          const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.buildHeaders(apiKey, 'Overlay Agent'),
            body: JSON.stringify({
              model: candidateModelId,
              messages: conversationMessages,
              tools: tools.length > 0 ? tools : undefined,
              tool_choice: tools.length > 0 ? 'auto' : undefined
            })
          })

          if (!response.ok) {
            lastError = await this.readErrorMessage(response)
            if (response.status === 429 && candidateModelId !== OPENROUTER_FREE_ROUTER_MODEL_ID) {
              console.warn(
                `[OpenRouterChat] ${candidateModelId} agent call is rate limited, retrying via ${OPENROUTER_FREE_ROUTER_MODEL_ID}`
              )
              continue
            }
            onEvent({ type: 'error', error: lastError })
            return { success: false, error: lastError, usage: totalUsage }
          }

          data = (await response.json()) as OpenRouterResponse
          if (data.error) {
            lastError = data.error.message
            onEvent({ type: 'error', error: lastError })
            return { success: false, error: lastError, usage: totalUsage }
          }
          break
        }

        if (!data) {
          onEvent({ type: 'error', error: lastError })
          return { success: false, error: lastError, usage: totalUsage }
        }

        // Accumulate token usage from response
        if (data.usage) {
          totalUsage.inputTokens += data.usage.prompt_tokens || 0
          totalUsage.outputTokens += data.usage.completion_tokens || 0
        }

        const choice = data.choices?.[0]
        if (!choice) {
          onEvent({ type: 'error', error: 'No response from model' })
          return { success: false, error: 'No response from model' }
        }

        const assistantMessage = choice.message
        const toolCalls = assistantMessage.tool_calls

        // Add assistant message to conversation
        conversationMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
          tool_calls: toolCalls
        })

        // If there's text content, emit it
        if (assistantMessage.content) {
          onEvent({ type: 'text', text: assistantMessage.content })
        }

        // If no tool calls, we're done
        if (!toolCalls || toolCalls.length === 0) {
          onEvent({ type: 'done' })
          return { success: true, finalResponse: assistantMessage.content || '', usage: totalUsage }
        }

        // Execute tool calls
        for (const toolCall of toolCalls) {
          if (isCancelled()) {
            return { success: true, finalResponse: 'Cancelled by user', usage: totalUsage }
          }

          const toolName = toolCall.function.name
          let toolArgs: Record<string, unknown> = {}

          try {
            toolArgs = JSON.parse(toolCall.function.arguments)
          } catch {
            toolArgs = {}
          }

          onEvent({ type: 'tool_start', tool: toolName, toolInput: toolArgs, step: stepCount })

          const executor = toolExecutors[toolName]
          let toolResult: string

          if (executor) {
            try {
              toolResult = await executor(toolArgs)
            } catch (err) {
              toolResult = JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : String(err)
              })
            }
          } else {
            toolResult = JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` })
          }

          onEvent({
            type: 'tool_result',
            tool: toolName,
            toolResult,
            step: stepCount
          })

          // Add tool result to conversation
          conversationMessages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: toolCall.id
          })
        }

        // Check for finish_reason
        if (choice.finish_reason === 'stop' && !toolCalls?.length) {
          onEvent({ type: 'done' })
          return { success: true, finalResponse: assistantMessage.content || '', usage: totalUsage }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        onEvent({ type: 'error', error })
        return { success: false, error, usage: totalUsage }
      }
    }

    // Max steps reached
    onEvent({ type: 'max_steps_reached' })
    return { success: true, finalResponse: 'Max steps reached', usage: totalUsage }
  }

  /**
   * Format ChatMessage array to OpenRouter format
   */
  private formatMessages(messages: ChatMessage[]): OpenRouterMessage[] {
    return messages.map((m) => {
      const images = m.imageDataArray || (m.imageData ? [m.imageData] : [])

      // If user message has images, use content array format
      if (m.role === 'user' && images.length > 0) {
        const content: OpenRouterContentPart[] = [{ type: 'text', text: m.content || '' }]
        for (const img of images) {
          content.push({
            type: 'image_url',
            image_url: { url: img.startsWith('data:') ? img : `data:image/png;base64,${img}` }
          })
        }
        return { role: 'user' as const, content }
      }

      // Simple string content for other messages
      return {
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content || ''
      }
    })
  }
}

// ── Agent Event Types ───────────────────────────────────────────────────────────

export interface AgentEvent {
  type: 'thinking' | 'tool_start' | 'tool_result' | 'text' | 'done' | 'error' | 'max_steps_reached'
  tool?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  text?: string
  error?: string
  step?: number
}

// ── Export singleton ────────────────────────────────────────────────────────────

export const openrouterChatService = new OpenRouterChatService()
export type { OpenRouterTool, OpenRouterMessage }
