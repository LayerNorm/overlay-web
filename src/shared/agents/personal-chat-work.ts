import type { Entitlements } from '@/shared/app/app-contracts'
import type { ProjectSettings } from '@/shared/projects/project-settings'

export type PersonalChatWorkToolDefinition = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  needsApproval: boolean
}

/**
 * Serializable tooling context for durable agent turns. Shared by the
 * personal-chat Work workflow and the automation agent workflow — the extra
 * automation fields let the same step-side tool reconstruction run an
 * automation execution turn (automation-management tools stay withheld).
 */
export type PersonalChatWorkToolingContext = {
  accountAllowedConnectorIds?: string[]
  accountAllowedToolIds?: string[]
  activeKnowledgeBaseIds: string[]
  baseUrl: string
  billingProgrammaticSubjectId?: string
  conversationId: string
  conversationProjectId?: string
  effectiveModelId: string
  entitlements: Entitlements
  latestUserText?: string
  mediaToolIntent?: 'image' | 'video' | null
  memoryEnabled: boolean
  /** Conversation-mode hint for tool gating; automation turns leave it unset. */
  mode?: 'chat' | 'automate'
  paid: boolean
  projectSettings?: ProjectSettings
  requestFingerprint: string
  requestedToolIds: string[]
  turnId: string
  userId: string
  workspaceId: string
  /** Marks the turn as an automation execution (withholds automation tools). */
  automationExecution?: boolean
  automationId?: string
}
