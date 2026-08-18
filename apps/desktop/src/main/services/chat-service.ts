import { generateText, streamText, type LanguageModel, type ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createXai } from '@ai-sdk/xai'
import { keyCacheService } from './key-cache-service'
import { getCloudMemoryService } from './memory/CloudMemoryService'
import { openrouterChatService } from './openrouter-chat-service'
import { shouldUseGateway } from './ai/feature-flags'
import { unifiedChatService } from './ai/unified-chat-service'
import { getModelForId } from '@overlay/llm-gateway'
import type { ChatModel as SharedChatModel } from '@overlay/app-core'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  imageData?: string // Single image for backwards compatibility
  imageDataArray?: string[] // Multiple base64 encoded images (data:image/png;base64,...)
}

export type ChatModel = SharedChatModel & {
  disabled?: boolean // For prod mode - models without API keys
  disabledReason?: string // Tooltip text for disabled models
}

interface DesktopModelDefinition {
  id: string
  name: string
  provider: string
  description?: string
  supportsVision: boolean
  supportsReasoning: boolean
  supportsSearch: boolean
}

const HIDDEN_MODEL_IDS = new Set<string>(['llama-3.1-8b-instant'])

// Extra metadata for models that are not part of the shared @overlay/llm-gateway catalog.
const DESKTOP_MODEL_OVERRIDES: Record<string, Partial<ChatModel>> = {
  'llama-3.3-70b-versatile': { cost: 1, intelligence: 55, speedTier: 2, supportsZeroDataRetention: false }
}

const RAW_AVAILABLE_MODELS: DesktopModelDefinition[] = [
  // OpenRouter / catalog rows
  {
    id: 'openrouter/free',
    name: 'Auto',
    provider: 'openrouter',
    description: 'Free router',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'qwen/qwen3.6-plus',
    name: 'Qwen 3.6 Plus',
    provider: 'openrouter',
    description: 'Multilingual',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },

  // Anthropic Claude
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    description: 'Most capable',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    description: 'Best balance',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    description: 'Fast & light',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },

  // Google Gemini
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'google',
    description: 'Most capable',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    provider: 'google',
    description: 'Fast & efficient',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'google/gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B',
    provider: 'google',
    description: 'Efficient',
    supportsVision: false,
    supportsReasoning: false,
    supportsSearch: false
  },

  // OpenAI
  {
    id: 'gpt-5.2-pro-2025-12-11',
    name: 'GPT-5.2 Pro',
    provider: 'openai',
    description: 'Most capable',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'gpt-5.2-2025-12-11',
    name: 'GPT-5.2',
    provider: 'openai',
    description: 'Powerful',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    description: 'Powerful',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'gpt-5-mini-2025-08-07',
    name: 'GPT-5 Mini',
    provider: 'openai',
    description: 'Compact',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'gpt-5-nano-2025-08-07',
    name: 'GPT-5 Nano',
    provider: 'openai',
    description: 'Fastest',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'openai/gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    description: 'Compact',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'gpt-4.1-2025-04-14',
    name: 'GPT-4.1',
    provider: 'openai',
    description: 'Reliable',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },

  // xAI Grok
  {
    id: 'grok-4-1-fast-reasoning',
    name: 'Grok 4.1 Fast Reasoning',
    provider: 'xai',
    description: 'Fast reasoning',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'xai/grok-4.20-reasoning',
    name: 'Grok 4.20 Reasoning',
    provider: 'xai',
    description: 'Reasoning',
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: false
  },

  // Groq / hosted open models
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    provider: 'groq',
    description: 'Versatile',
    supportsVision: false,
    supportsReasoning: false,
    supportsSearch: false
  },
  {
    id: 'moonshotai/kimi-k2-0905',
    name: 'Kimi K2',
    provider: 'groq',
    description: 'Multilingual',
    supportsVision: false,
    supportsReasoning: false,
    supportsSearch: false
  },
  {
    id: 'moonshotai/kimi-k2-instruct-0905',
    name: 'Kimi K2 Instruct',
    provider: 'groq',
    description: 'Multilingual',
    supportsVision: false,
    supportsReasoning: false,
    supportsSearch: false
  },
  {
    id: 'moonshotai/kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'groq',
    description: 'Multilingual',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'minimax/minimax-m2.7',
    name: 'MiniMax M2.7',
    provider: 'minimax',
    description: 'Peak performance',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'z-ai/glm-5.1',
    name: 'GLM 5.1',
    provider: 'groq',
    description: 'Reasoning',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'zai/glm-5.1',
    name: 'GLM 5.1',
    provider: 'groq',
    description: 'Reasoning',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT OSS 20B',
    provider: 'groq',
    description: 'Reasoning',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT OSS 120B',
    provider: 'groq',
    description: 'Reasoning',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },

  // DeepSeek / NVIDIA
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    description: 'Reasoning',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    description: 'Fast reasoning',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  },
  {
    id: 'nvidia/nemotron-nano-9b-v2',
    name: 'Nemotron Nano 9B v2',
    provider: 'nvidia',
    description: 'Efficient',
    supportsVision: false,
    supportsReasoning: true,
    supportsSearch: false
  }
]

export const AVAILABLE_MODELS: ChatModel[] = RAW_AVAILABLE_MODELS.map((desktop) => {
  const shared = getModelForId(desktop.id)
  if (shared) {
    return {
      ...shared,
      id: desktop.id,
      name: desktop.name,
      provider: desktop.provider,
      description: desktop.description,
      supportsVision: desktop.supportsVision,
      supportsReasoning: desktop.supportsReasoning,
      supportsSearch: desktop.supportsSearch
    }
  }

  const override = DESKTOP_MODEL_OVERRIDES[desktop.id]
  return {
    ...desktop,
    intelligence: override?.intelligence ?? 0,
    cost: override?.cost ?? 2,
    speedTier: override?.speedTier ?? 2,
    supportsZeroDataRetention: override?.supportsZeroDataRetention ?? false
  }
})

/**
 * Check if a model supports vision (image input) given a model ID in any format.
 * Falls back to true for unknown models, since most modern models support vision.
 */
export function getModelSupportsVision(modelId: string): boolean {
  // Direct match
  const direct = AVAILABLE_MODELS.find((m) => m.id === modelId)
  if (direct) return direct.supportsVision

  // Match the model part after provider prefix (e.g. "anthropic/claude-haiku-4-5" -> "claude-haiku-4-5")
  const modelPart = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId
  const byPart = AVAILABLE_MODELS.find((m) => m.id === modelPart)
  if (byPart) return byPart.supportsVision

  return true // conservative default: most models support vision
}

// Provider instances - lazily initialized
let openaiProvider: ReturnType<typeof createOpenAI> | null = null
let anthropicProvider: ReturnType<typeof createAnthropic> | null = null
let googleProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null
let groqProvider: ReturnType<typeof createGroq> | null = null
let xaiProvider: ReturnType<typeof createXai> | null = null
// MiniMax uses Anthropic-compatible API with custom base URL
let minimaxProvider: ReturnType<typeof createAnthropic> | null = null
// OpenRouter uses OpenAI-compatible API with custom base URL
let openrouterProvider: ReturnType<typeof createOpenAI> | null = null

class ChatService {
  initialize(): void {
    console.log('[ChatService] Initializing with AI SDK v6...')

    // Initialize providers from secure storage
    // This is async but we fire-and-forget on init - providers will be ready after first refresh
    this.refreshProvidersAsync().catch((err) => {
      console.error('[ChatService] Error during initial provider refresh:', err)
    })
  }

  // Refresh provider instances from user-owned local BYOK credentials only.
  async refreshProvidersAsync(): Promise<void> {
    if (shouldUseGateway('USE_GATEWAY_FOR_CHAT')) {
      openaiProvider = null
      anthropicProvider = null
      googleProvider = null
      groqProvider = null
      xaiProvider = null
      minimaxProvider = null
      openrouterProvider = null

      // In Gateway mode the desktop only needs the shared AI Gateway key and
      // the direct OpenRouter fallback key. Groq is still used elsewhere
      // (transcription, title generation, memory extraction), but not here.
      await Promise.allSettled([
        keyCacheService.getKey('ai_gateway'),
        keyCacheService.getKey('openrouter')
      ])

      console.log('[ChatService] Gateway mode enabled; skipped legacy provider refresh')
      return
    }

    // Get user-owned BYOK credentials from the main-process memory cache.
    const openaiKey = await keyCacheService.getKey('openai')
    const anthropicKey = await keyCacheService.getKey('anthropic')
    const googleKey = await keyCacheService.getKey('google')
    const xaiKey = await keyCacheService.getKey('xai')
    const groqKey = await keyCacheService.getKey('groq')
    const openrouterKey = await keyCacheService.getKey('openrouter')

    if (openaiKey) {
      openaiProvider = createOpenAI({ apiKey: openaiKey })
      console.log('[ChatService] OpenAI provider initialized')
    } else {
      openaiProvider = null
    }

    if (anthropicKey) {
      anthropicProvider = createAnthropic({ apiKey: anthropicKey })
      console.log('[ChatService] Anthropic provider initialized')
    } else {
      anthropicProvider = null
    }

    if (googleKey) {
      googleProvider = createGoogleGenerativeAI({ apiKey: googleKey })
      console.log('[ChatService] Google provider initialized')
    } else {
      googleProvider = null
    }

    if (groqKey) {
      groqProvider = createGroq({ apiKey: groqKey })
      console.log('[ChatService] Groq provider initialized')
    } else {
      groqProvider = null
    }

    if (xaiKey) {
      xaiProvider = createXai({ apiKey: xaiKey })
      console.log('[ChatService] xAI provider initialized')
    } else {
      xaiProvider = null
    }

    // MiniMax uses Anthropic-compatible API with custom base URL
    const minimaxKey = await keyCacheService.getKey('minimax')
    if (minimaxKey) {
      minimaxProvider = createAnthropic({
        apiKey: minimaxKey,
        baseURL: 'https://api.minimax.io/anthropic/v1'
      })
      console.log('[ChatService] MiniMax provider initialized')
    } else {
      minimaxProvider = null
    }

    // OpenRouter uses OpenAI-compatible API
    // Use strict mode to force Chat Completions API (avoids Responses API issues)
    if (openrouterKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      openrouterProvider = (createOpenAI as any)({
        apiKey: openrouterKey,
        baseURL: 'https://openrouter.ai/api/v1',
        compatibility: 'strict', // Force strict Chat Completions API format
        headers: {
          'HTTP-Referer': 'https://overlay.app',
          'X-Title': 'Overlay Chat'
        }
      })
      console.log('[ChatService] OpenRouter provider initialized with compatibility mode')
    } else {
      openrouterProvider = null
    }

    console.log('[ChatService] Providers refreshed:', {
      openai: !!openaiProvider,
      anthropic: !!anthropicProvider,
      google: !!googleProvider,
      groq: !!groqProvider,
      xai: !!xaiProvider,
      minimax: !!minimaxProvider,
      openrouter: !!openrouterProvider
    })
  }

  // Synchronous version for backwards compatibility - schedules async refresh
  refreshProviders(): void {
    this.refreshProvidersAsync().catch((err) => {
      console.error('[ChatService] Error refreshing providers:', err)
    })
  }

  // Ensure Groq provider is initialized (called when API key is set during onboarding)
  async ensureGroqProvider(): Promise<void> {
    if (!groqProvider && keyCacheService.hasKey('groq')) {
      const groqApiKey = await keyCacheService.getKey('groq')
      if (groqApiKey) {
        groqProvider = createGroq({ apiKey: groqApiKey })
        console.log('[ChatService] Groq provider late-initialized')
      }
    }
  }

  async getAvailableModelsAsync(): Promise<ChatModel[]> {
    // Feature flag: Use unified Gateway service - all models available
    if (shouldUseGateway('USE_GATEWAY_FOR_CHAT')) {
      return unifiedChatService.getAvailableModels().filter((model) => {
        if (HIDDEN_MODEL_IDS.has(model.id)) return false
        return true
      })
    }

    // Refresh providers to pick up any new API keys from secure storage
    await this.refreshProvidersAsync()

    return AVAILABLE_MODELS.filter((model) => {
      if (HIDDEN_MODEL_IDS.has(model.id)) return false
      return true
    }).map((model) => {
      // Check if provider has API key (provider instance exists means key exists)
      let hasApiKey = false
      switch (model.provider) {
        case 'openai':
          hasApiKey = !!openaiProvider
          break
        case 'anthropic':
          hasApiKey = !!anthropicProvider
          break
        case 'google':
          hasApiKey = !!googleProvider
          break
        case 'groq':
          hasApiKey = !!groqProvider
          break
        case 'xai':
          hasApiKey = !!xaiProvider
          break
        case 'minimax':
          hasApiKey = !!minimaxProvider
          break
        case 'openrouter':
          hasApiKey = !!openrouterProvider
          break
      }

      // Free models should never be disabled - they use service API keys
      const isFreeModel = model.cost === 0

      // Model is disabled if no API key available AND it's not a free model
      if (!hasApiKey && !isFreeModel) {
        return {
          ...model,
          disabled: true,
          disabledReason: 'Not authenticated or no API key available'
        }
      }

      return model
    })
  }

  // Synchronous version that uses cached provider state
  getAvailableModels(): ChatModel[] {
    // Feature flag: Use unified Gateway service - all models available
    if (shouldUseGateway('USE_GATEWAY_FOR_CHAT')) {
      return unifiedChatService.getAvailableModels().filter((model) => {
        if (HIDDEN_MODEL_IDS.has(model.id)) return false
        return true
      })
    }

    return AVAILABLE_MODELS.filter((model) => {
      if (HIDDEN_MODEL_IDS.has(model.id)) return false
      return true
    }).map((model) => {
      // Check if provider has API key (provider instance exists means key exists)
      let hasApiKey = false
      switch (model.provider) {
        case 'openai':
          hasApiKey = !!openaiProvider
          break
        case 'anthropic':
          hasApiKey = !!anthropicProvider
          break
        case 'google':
          hasApiKey = !!googleProvider
          break
        case 'groq':
          hasApiKey = !!groqProvider
          break
        case 'xai':
          hasApiKey = !!xaiProvider
          break
        case 'minimax':
          hasApiKey = !!minimaxProvider
          break
        case 'openrouter':
          hasApiKey = !!openrouterProvider
          break
      }

      // Free models should never be disabled - they use service API keys
      const isFreeModel = model.cost === 0

      // Model is disabled if no API key available AND it's not a free model
      if (!hasApiKey && !isFreeModel) {
        return {
          ...model,
          disabled: true,
          disabledReason: 'Not authenticated or no API key available'
        }
      }

      return model
    })
  }

  // Convert ChatMessage to AI SDK message format with image support

  private formatMessages(
    messages: ChatMessage[],
    supportsVision: boolean,
    provider?: string
  ): ModelMessage[] {
    return messages.map((m) => {
      const images = m.imageDataArray || (m.imageData ? [m.imageData] : [])

      // Ensure content is always a string (never undefined or null)
      const textContent = typeof m.content === 'string' ? m.content : String(m.content || '')

      // For OpenRouter, always use simple string content to avoid Responses API format issues
      // OpenRouter's Chat Completions API doesn't support complex content arrays for assistant messages
      if (provider === 'openrouter') {
        // User messages with images still need array format for vision
        if (m.role === 'user' && images.length > 0 && supportsVision) {
          return {
            role: 'user' as const,
            content: [
              { type: 'text', text: textContent },
              ...images.map((img) => ({ type: 'image' as const, image: img }))
            ]
          }
        }
        // All other messages use simple string content
        return {
          role: m.role as 'user' | 'assistant' | 'system',
          content: textContent
        }
      }

      // Handle user messages with images for other providers
      if (m.role === 'user' && images.length > 0 && supportsVision) {
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string } | { type: 'file'; data: string; mediaType: string }> = [
          { type: 'text', text: textContent }
        ]

        for (const imgData of images) {
          // AI SDK expects base64 data without the data URL prefix for some providers
          // But the image type accepts data URLs directly
          content.push({
            type: 'file',
            data: imgData,
            mediaType: 'image'
          })
        }

        return {
          role: 'user' as const,
          content
        }
      }

      // Simple text message
      return {
        role: m.role,
        content: textContent
      }
    });
  }

  // Get the appropriate model instance for a given model ID
  private async getModelInstance(modelId: string, provider: string): Promise<LanguageModel> {
    switch (provider) {
      case 'openai':
        if (!openaiProvider) throw new Error('OpenAI API key not configured')
        return openaiProvider(modelId)
      case 'anthropic':
        if (!anthropicProvider) throw new Error('Anthropic API key not configured')
        return anthropicProvider(modelId)
      case 'google':
        if (!googleProvider) throw new Error('Google API key not configured')
        return googleProvider(modelId)
      case 'groq':
        // Ensure Groq provider is initialized with latest API key
        await this.ensureGroqProvider()
        if (!groqProvider) throw new Error('Groq API key not configured')
        return groqProvider(modelId)
      case 'xai':
        if (!xaiProvider) throw new Error('xAI API key not configured')
        return xaiProvider(modelId)
      case 'minimax':
        if (!minimaxProvider) throw new Error('MiniMax API key not configured')
        return minimaxProvider(modelId)
      case 'openrouter':
        if (!openrouterProvider) throw new Error('OpenRouter API key not configured')
        return openrouterProvider(modelId)
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }

  // Non-streaming chat (for backwards compatibility and simple use cases)
  async chat(modelId: string, messages: ChatMessage[]): Promise<string> {
    // Feature flag: Use unified Gateway service if enabled
    if (shouldUseGateway('USE_GATEWAY_FOR_CHAT')) {
      console.log('[ChatService] Using unified Gateway service for chat (feature flag enabled)')
      return unifiedChatService.chat(modelId, messages)
    }

    const model = AVAILABLE_MODELS.find((m) => m.id === modelId)
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`)
    }

    if (model.provider === 'openrouter') {
      const result = await openrouterChatService.sendMessage(modelId, messages)
      if (!result.success) {
        throw new Error(result.error || 'OpenRouter request failed')
      }
      return result.response || ''
    }

    const modelInstance = await this.getModelInstance(modelId, model.provider)
    const formattedMessages = this.formatMessages(messages, model.supportsVision, model.provider)

    const result = await generateText({
      model: modelInstance,
      messages: formattedMessages
    })

    return result.text
  }

  // Search memory for relevant context based on user's query
  private async searchMemoryContext(userQuery: string): Promise<string | null> {
    try {
      const memoryService = getCloudMemoryService()
      const results = await memoryService.search(userQuery, 5)

      if (results.length === 0) {
        return null
      }

      const memoryContext = results.map((r) => `- [${r.type}] ${r.content}`).join('\n')

      return `## Relevant User Memories\nUse this context to personalize your response:\n${memoryContext}`
    } catch (error) {
      console.error('[ChatService] Memory search failed:', error)
      return null
    }
  }

  // Get identity prompt for models that might misidentify themselves
  // MiniMax uses Anthropic-compatible API but should not claim to be Claude
  private getModelIdentityPrompt(provider: string, modelName: string): string | null {
    if (provider === 'minimax') {
      return `You are ${modelName}, an AI assistant created by MiniMax. You are NOT Claude and you are NOT made by Anthropic. When asked about your identity, always say you are ${modelName} by MiniMax.`
    }
    if (provider === 'openrouter') {
      return `You are ${modelName}, an AI assistant. When asked about your identity, identify yourself by your actual model name. You are integrated into the Overlay app.`
    }
    return null
  }

  // Streaming chat - returns an async generator for real-time updates
  async *chatStream(
    modelId: string,
    messages: ChatMessage[]
  ): AsyncGenerator<{
    type: 'text' | 'error' | 'done' | 'usage'
    content: string
    usage?: { inputTokens: number; outputTokens: number }
  }> {
    // Feature flag: Use unified Gateway service if enabled
    if (shouldUseGateway('USE_GATEWAY_FOR_CHAT')) {
      console.log('[ChatService] Using unified Gateway service for chat (feature flag enabled)')
      for await (const chunk of unifiedChatService.chatStream(modelId, messages)) {
        yield { type: chunk.type, content: chunk.content, usage: chunk.usage }
      }
      return
    }

    const model = AVAILABLE_MODELS.find((m) => m.id === modelId)
    if (!model) {
      yield { type: 'error', content: `Unknown model: ${modelId}` }
      return
    }

    // Get the latest user message for memory search
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const messagesWithMemory = [...messages]

    // Add identity system prompt for models that might misidentify themselves
    const identityPrompt = this.getModelIdentityPrompt(model.provider, model.name)
    if (identityPrompt) {
      messagesWithMemory.unshift({
        role: 'system',
        content: identityPrompt
      })
    }

    if (lastUserMessage) {
      const memoryContext = await this.searchMemoryContext(lastUserMessage.content)
      if (memoryContext) {
        // Prepend system message with memory context
        const systemMessage: ChatMessage = {
          role: 'system',
          content: memoryContext
        }
        // Insert after any existing system messages, or at the beginning
        const firstNonSystemIdx = messagesWithMemory.findIndex((m) => m.role !== 'system')
        if (firstNonSystemIdx === -1) {
          messagesWithMemory.push(systemMessage)
        } else {
          messagesWithMemory.splice(firstNonSystemIdx, 0, systemMessage)
        }
      }
    }

    // Use native OpenRouter service for OpenRouter models to avoid Vercel AI SDK issues
    if (model.provider === 'openrouter') {
      yield* openrouterChatService.streamMessageGenerator(modelId, messagesWithMemory)
      return
    }

    // Use Vercel AI SDK for other providers
    try {
      const modelInstance = await this.getModelInstance(modelId, model.provider)
      const formattedMessages = this.formatMessages(
        messagesWithMemory,
        model.supportsVision,
        model.provider
      )

      const result = streamText({
        model: modelInstance,
        messages: formattedMessages
      })

      // Stream the text parts
      for await (const textPart of result.textStream) {
        yield { type: 'text', content: textPart }
      }

      yield { type: 'done', content: '' }
    } catch (error) {
      console.error('[ChatService] Stream error:', error)
      yield { type: 'error', content: String(error) }
    }
  }
}

export const chatService = new ChatService()
