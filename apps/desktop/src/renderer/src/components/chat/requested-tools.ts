import type { ElementType } from 'react'
import { Code, DatabaseZap, Globe, Search } from 'lucide-react'

export type RequestedToolId = 'web_search' | 'memory' | 'sandbox' | 'browser'

export interface RequestedToolOption {
  id: RequestedToolId
  label: string
  instruction: string
  icon: ElementType
  color: string
}

export const REQUESTED_TOOL_OPTIONS: readonly RequestedToolOption[] = [
  {
    id: 'web_search',
    label: 'Search',
    instruction:
      'The user explicitly selected Web Search for this turn. Use the web search tool before answering and ground the answer in current web information.',
    icon: Search,
    color: '#93c5fd'
  },
  {
    id: 'memory',
    label: 'Memory',
    instruction:
      'The user explicitly selected Memory for this turn. Search the user memory/context tools before answering and use relevant memory in the response.',
    icon: DatabaseZap,
    color: '#34d399'
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    instruction:
      'The user explicitly selected Sandbox for this turn. Use the sandbox/code execution tool for computation, code, data inspection, or file processing when applicable.',
    icon: Code,
    color: '#c4b5fd'
  },
  {
    id: 'browser',
    label: 'Browser',
    instruction:
      'The user explicitly selected Browser Use for this turn. Use browser tools to open, inspect, search, or interact with web pages as needed.',
    icon: Globe,
    color: '#67e8f9'
  }
] as const

export function buildRequestedToolInstruction(toolIds: readonly RequestedToolId[]): string {
  if (toolIds.length === 0) return ''
  const selected = REQUESTED_TOOL_OPTIONS.filter((tool) => toolIds.includes(tool.id))
  if (selected.length === 0) return ''
  return [
    '## User-Selected Tools',
    'The user selected the following tool chips for this turn. Treat them as explicit tool-use requests.',
    ...selected.map((tool) => `- ${tool.label}: ${tool.instruction}`)
  ].join('\n')
}
