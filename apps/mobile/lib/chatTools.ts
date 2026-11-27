import type { CapabilityCheck } from '@overlay/app-core'
import type { ChatToolRequestId } from '../services/aiService'
import type { Feather } from '@expo/vector-icons'

/**
 * Per-request tool grants, mirrored from web `ChatComposer`'s
 * TOOL_REQUEST_OPTIONS + `isToolRequestEnabled`. Keep in sync with
 * `src/features/chat/components/ChatComposer.tsx` and
 * `src/shared/chat/tool-requests.ts`.
 */

export interface ChatToolOption {
  id: ChatToolRequestId
  label: string
  description: string
  featherIcon: React.ComponentProps<typeof Feather>['name']
}

export const CHAT_TOOL_OPTIONS: readonly ChatToolOption[] = [
  {
    id: 'web_search',
    label: 'Web Search',
    description: 'Use live web results',
    featherIcon: 'globe',
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    description: 'Run code or commands',
    featherIcon: 'terminal',
  },
]

/** Same gate as web `isToolRequestEnabled` — memory also requires vector search. */
export function isChatToolEnabled(
  toolId: ChatToolRequestId,
  capabilities: CapabilityCheck | null | undefined,
): boolean {
  if (!capabilities) return false
  if (toolId === 'web_search') return Boolean(capabilities.webSearch)
  if (toolId === 'sandbox') return Boolean(capabilities.sandboxes)
  if (toolId === 'memory') return Boolean(capabilities.memory && capabilities.vectorSearch)
  return true
}

export function isMemoryToggleAvailable(
  capabilities: CapabilityCheck | null | undefined,
): boolean {
  return Boolean(capabilities?.memory && capabilities?.vectorSearch)
}

export function chatToolOptionsForCapabilities(
  capabilities: CapabilityCheck | null | undefined,
): ChatToolOption[] {
  return CHAT_TOOL_OPTIONS.filter((option) => isChatToolEnabled(option.id, capabilities))
}
