import * as SecureStore from 'expo-secure-store'
import { ChatModel, AVAILABLE_MODELS } from './chatTypes'

const API_KEY_PREFIX = 'dawn-api-key-'

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'groq' | 'xai'

export async function getApiKey(provider: AIProvider): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(`${API_KEY_PREFIX}${provider}`)
  } catch {
    return null
  }
}

export async function setApiKey(provider: AIProvider, key: string): Promise<void> {
  await SecureStore.setItemAsync(`${API_KEY_PREFIX}${provider}`, key)
}

export async function deleteApiKey(provider: AIProvider): Promise<void> {
  await SecureStore.deleteItemAsync(`${API_KEY_PREFIX}${provider}`)
}

export async function getAvailableModels(): Promise<ChatModel[]> {
  const providers: AIProvider[] = ['openai', 'anthropic', 'google', 'groq', 'xai']
  const hasKey: Record<string, boolean> = {}

  for (const p of providers) {
    const key = await getApiKey(p)
    hasKey[p] = !!key && key.length > 0
  }

  return AVAILABLE_MODELS.filter((m) => hasKey[m.provider])
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  imageData?: string
}

interface StreamChunk {
  type: 'text' | 'error' | 'done'
  content: string
}

export async function* chatStream(
  modelId: string,
  messages: ChatMessage[]
): AsyncGenerator<StreamChunk> {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId)
  if (!model) {
    yield { type: 'error', content: `Unknown model: ${modelId}` }
    return
  }

  const apiKey = await getApiKey(model.provider)
  if (!apiKey) {
    yield { type: 'error', content: `No API key configured for ${model.provider}` }
    return
  }

  try {
    switch (model.provider) {
      case 'openai':
        yield* streamOpenAI(apiKey, modelId, messages)
        break
      case 'anthropic':
        yield* streamAnthropic(apiKey, modelId, messages)
        break
      case 'google':
        yield* streamGoogle(apiKey, modelId, messages)
        break
      case 'groq':
        yield* streamGroq(apiKey, modelId, messages)
        break
      case 'xai':
        yield* streamXAI(apiKey, modelId, messages)
        break
      default:
        yield { type: 'error', content: `Unsupported provider: ${model.provider}` }
    }
  } catch (error) {
    yield { type: 'error', content: String(error) }
  }
}

async function* streamOpenAI(
  apiKey: string,
  modelId: string,
  messages: ChatMessage[]
): AsyncGenerator<StreamChunk> {
  const body = {
    model: modelId,
    messages: formatOpenAIMessages(messages),
    stream: true
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const err = await response.text()
    yield { type: 'error', content: `OpenAI error: ${err}` }
    return
  }

  yield* parseSSEStream(response)
}

async function* streamAnthropic(
  apiKey: string,
  modelId: string,
  messages: ChatMessage[]
): AsyncGenerator<StreamChunk> {
  const formattedMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role,
      content: m.imageData && m.role === 'user'
        ? [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.imageData.replace(/^data:image\/\w+;base64,/, '') } },
            { type: 'text', text: m.content }
          ]
        : m.content
    }))

  const systemMsg = messages.find((m) => m.role === 'system')

  const body: Record<string, unknown> = {
    model: modelId,
    messages: formattedMessages,
    max_tokens: 4096,
    stream: true
  }
  if (systemMsg) {
    body.system = systemMsg.content
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const err = await response.text()
    yield { type: 'error', content: `Anthropic error: ${err}` }
    return
  }

  yield* parseAnthropicSSE(response)
}

async function* streamGoogle(
  apiKey: string,
  modelId: string,
  messages: ChatMessage[]
): AsyncGenerator<StreamChunk> {
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: m.imageData && m.role === 'user'
        ? [
            { inlineData: { mimeType: 'image/jpeg', data: m.imageData.replace(/^data:image\/\w+;base64,/, '') } },
            { text: m.content }
          ]
        : [{ text: m.content }]
    }))

  const systemMsg = messages.find((m) => m.role === 'system')
  const body: Record<string, unknown> = { contents }
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const err = await response.text()
    yield { type: 'error', content: `Google error: ${err}` }
    return
  }

  yield* parseGoogleSSE(response)
}

async function* streamGroq(
  apiKey: string,
  modelId: string,
  messages: ChatMessage[]
): AsyncGenerator<StreamChunk> {
  const body = {
    model: modelId,
    messages: formatOpenAIMessages(messages),
    stream: true
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const err = await response.text()
    yield { type: 'error', content: `Groq error: ${err}` }
    return
  }

  yield* parseSSEStream(response)
}

async function* streamXAI(
  apiKey: string,
  modelId: string,
  messages: ChatMessage[]
): AsyncGenerator<StreamChunk> {
  const body = {
    model: modelId,
    messages: formatOpenAIMessages(messages),
    stream: true
  }

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const err = await response.text()
    yield { type: 'error', content: `xAI error: ${err}` }
    return
  }

  yield* parseSSEStream(response)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatOpenAIMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    if (m.imageData && m.role === 'user') {
      return {
        role: m.role,
        content: [
          { type: 'image_url' as const, image_url: { url: m.imageData } },
          { type: 'text' as const, text: m.content }
        ]
      }
    }
    return { role: m.role, content: m.content }
  })
}

async function* parseSSEStream(response: Response): AsyncGenerator<StreamChunk> {
  // React Native's fetch may not support ReadableStream, so fall back to text
  const text = await response.text()
  const lines = text.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data: ')) continue
    const data = trimmed.slice(6)
    if (data === '[DONE]') {
      yield { type: 'done', content: '' }
      return
    }
    try {
      const parsed = JSON.parse(data)
      const content = parsed.choices?.[0]?.delta?.content
      if (content) {
        yield { type: 'text', content }
      }
    } catch {
      // skip malformed JSON
    }
  }
  yield { type: 'done', content: '' }
}

async function* parseAnthropicSSE(response: Response): AsyncGenerator<StreamChunk> {
  const text = await response.text()
  const lines = text.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data: ')) continue
    const data = trimmed.slice(6)
    try {
      const parsed = JSON.parse(data)
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        yield { type: 'text', content: parsed.delta.text }
      } else if (parsed.type === 'message_stop') {
        yield { type: 'done', content: '' }
        return
      }
    } catch {
      // skip malformed JSON
    }
  }
  yield { type: 'done', content: '' }
}

async function* parseGoogleSSE(response: Response): AsyncGenerator<StreamChunk> {
  const text = await response.text()
  const lines = text.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data: ')) continue
    const data = trimmed.slice(6)
    try {
      const parsed = JSON.parse(data)
      const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text
      if (content) {
        yield { type: 'text', content }
      }
    } catch {
      // skip malformed JSON
    }
  }
  yield { type: 'done', content: '' }
}
