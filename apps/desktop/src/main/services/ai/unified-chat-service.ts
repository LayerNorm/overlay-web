/**
 * Unified Chat Service
 *
 * Uses Vercel AI Gateway for all model providers with a single API key.
 * OpenRouter fallback for free models (openrouter/free).
 *
 * This replaces the multi-provider chat-service.ts and openrouter-chat-service.ts
 *
 * Phase 5: Integrated with SubscriptionService for usage tracking and billing
 */

import { streamText, generateText } from 'ai'
import { mapModelId, isOpenRouterModel, getGateway } from './gateway-provider'
import { openrouterChatService } from '../openrouter-chat-service'
import { subscriptionService } from '../subscription-service'
import { calculateTokenCost } from '../model-pricing'
import type { ChatMessage, ChatModel } from '../chat-service'
import { AVAILABLE_MODELS } from '../chat-service'

// Re-export types for convenience
export type { ChatMessage, ChatModel }

export interface StreamChunk {
  type: 'text' | 'error' | 'done' | 'usage'
  content: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

class UnifiedChatService {
  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      // Just verify Gateway is accessible
      await getGateway()
      this.initialized = true
      console.log('[UnifiedChatService] Initialized with AI Gateway')
    } catch (error) {
      console.error('[UnifiedChatService] Failed to initialize Gateway:', error)
      throw error
    }
  }

  /**
   * Get available models - all models are available via Gateway
   * Free models use OpenRouter fallback
   */
  getAvailableModels(): ChatModel[] {
    // With Gateway, all models are available (no per-provider API keys needed)
    return AVAILABLE_MODELS.map((model) => ({
      ...model,
      disabled: false,
      disabledReason: undefined
    }))
  }

  /**
   * Format messages for AI SDK
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatMessages(messages: ChatMessage[], supportsVision: boolean): any[] {
    return messages.map((m) => {
      const images = m.imageDataArray || (m.imageData ? [m.imageData] : [])
      const textContent = typeof m.content === 'string' ? m.content : String(m.content || '')

      // Handle user messages with images
      if (m.role === 'user' && images.length > 0 && supportsVision) {
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [
          { type: 'text', text: textContent }
        ]

        for (const imgData of images) {
          content.push({ type: 'image', image: imgData })
        }

        return {
          role: 'user' as const,
          content
        }
      }

      // Simple text message
      return {
        role: m.role as 'user' | 'assistant' | 'system',
        content: textContent
      }
    })
  }

  /**
   * Non-streaming chat
   * Records usage with SubscriptionService for billing
   */
  async chat(modelId: string, messages: ChatMessage[]): Promise<string> {
    const model = AVAILABLE_MODELS.find((m) => m.id === modelId)
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`)
    }

    const gatewayModelId = mapModelId(modelId)

    // OpenRouter models (free or custom) bypass Vercel Gateway and go direct
    if (isOpenRouterModel(gatewayModelId)) {
      const result = await openrouterChatService.sendMessage(modelId, messages)
      if (!result.success) {
        throw new Error(result.error || 'OpenRouter request failed')
      }
      return result.response || ''
    }

    // Ensure Gateway is initialized and get model instance
    const gateway = await getGateway()
    const gatewayModel = gateway(gatewayModelId)

    const formattedMessages = this.formatMessages(messages, model.supportsVision)

    const result = await generateText({
      model: gatewayModel,
      messages: formattedMessages
    })

    // Record usage with SubscriptionService (Phase 5)
    if (result.usage) {
      const inputTokens = result.usage.inputTokens || 0
      const outputTokens = result.usage.outputTokens || 0
      const cachedTokens = 0 // AI SDK doesn't expose cached tokens yet
      const cost = calculateTokenCost(modelId, inputTokens, cachedTokens, outputTokens)
      if (inputTokens > 0 || outputTokens > 0 || cost > 0) {
        subscriptionService.recordUsage('ask', cost, modelId, {
          inputTokens,
          outputTokens,
          cachedTokens
        })
      } else {
        console.log(`[UnifiedChatService] Skipping usage recording: 0 tokens for model ${modelId}`)
      }
    }

    return result.text
  }

  /**
   * Streaming chat - returns async generator for real-time updates
   */
  async *chatStream(modelId: string, messages: ChatMessage[]): AsyncGenerator<StreamChunk> {
    const model = AVAILABLE_MODELS.find((m) => m.id === modelId)
    if (!model) {
      yield { type: 'error', content: `Unknown model: ${modelId}` }
      return
    }

    const gatewayModelId = mapModelId(modelId)

    // OpenRouter models (free or custom) bypass Vercel Gateway and go direct
    if (isOpenRouterModel(gatewayModelId)) {
      yield* openrouterChatService.streamMessageGenerator(modelId, messages)
      return
    }

    // Use AI Gateway for all other models
    try {
      const gateway = await getGateway()
      const gatewayModel = gateway(gatewayModelId)

      const formattedMessages = this.formatMessages(messages, model.supportsVision)

      const result = streamText({
        model: gatewayModel,
        messages: formattedMessages
      })

      // Stream the text parts
      for await (const textPart of result.textStream) {
        yield { type: 'text', content: textPart }
      }

      // Yield usage data for the caller to record (avoids double-recording)
      const usage = await result.usage
      if (usage && usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
        const inputTokens = usage.inputTokens
        const outputTokens = usage.outputTokens

        if (inputTokens > 0 || outputTokens > 0) {
          yield {
            type: 'usage',
            content: '',
            usage: { inputTokens, outputTokens }
          }
        }
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      console.error('[UnifiedChatService] Gateway stream error:', error)
      yield { type: 'error', content: String(error) }
    }
  }

  /**
   * Streaming chat with memory context injection
   * Memory context is added as a system message
   */
  async *chatStreamWithMemory(
    modelId: string,
    messages: ChatMessage[],
    memoryContext?: string | null
  ): AsyncGenerator<StreamChunk> {
    const messagesWithContext = [...messages]

    // Add memory context as system message if provided
    if (memoryContext) {
      const systemMessage: ChatMessage = {
        role: 'system',
        content: `## Relevant User Memories\nUse this context to personalize your response:\n${memoryContext}`
      }

      // Insert after any existing system messages
      const firstNonSystemIdx = messagesWithContext.findIndex((m) => m.role !== 'system')
      if (firstNonSystemIdx === -1) {
        messagesWithContext.push(systemMessage)
      } else {
        messagesWithContext.splice(firstNonSystemIdx, 0, systemMessage)
      }
    }

    // Delegate to main chatStream
    yield* this.chatStream(modelId, messagesWithContext)
  }
}

export const unifiedChatService = new UnifiedChatService()
