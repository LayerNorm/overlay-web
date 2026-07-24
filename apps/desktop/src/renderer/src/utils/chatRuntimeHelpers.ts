import { buildRequestedToolInstruction } from '../components/chat/requested-tools'
import type { ChatSendOptions } from '../components/chat/ChatInputArea'

export const HIDDEN_CHAT_MODEL_IDS = new Set<string>([
  'openai/gpt-oss-20b',
  'meta-llama/llama-4-scout-17b-16e-instruct'
])

export const DESKTOP_ACT_SYSTEM_PROMPT = [
  'You are Overlay, a desktop AI assistant with access to tools through the cloud act endpoint.',
  'Every user turn is an act-capable turn. Decide silently whether tools are needed.',
  'Use tools when the user asks you to do something outside pure conversation, needs current information, references attached files or app data, asks for generated media, wants repeatable workflows, or asks you to interact with connected services.',
  'Do not use tools for ordinary conversation, explanation, drafting, summarization from already provided context, or questions you can answer directly.',
  'When using tools, use the real tool-calling channel only. Do not narrate tool names, raw JSON, or internal storage details.',
  'For third-party account actions, only act when the user explicitly requested that external service/account in this chat. If a required integration is not connected, guide the user to connect it.',
  'Keep final answers concise and specific about what was done or what information is still missing.'
].join('\n')

export function buildTurnToolInstruction(options?: ChatSendOptions): string {
  const sections: string[] = []
  const requestedToolInstruction = buildRequestedToolInstruction(options?.requestedTools ?? [])
  if (requestedToolInstruction) sections.push(requestedToolInstruction)
  if (options && !options.memoryEnabled) {
    sections.push(
      '## Memory Disabled\nMemory is disabled for this turn. Do not search, read, save, or otherwise invoke memory tools while producing this response.'
    )
  }
  return sections.join('\n\n')
}
