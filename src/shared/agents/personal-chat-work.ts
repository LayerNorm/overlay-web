import type { Entitlements } from '@/shared/app/app-contracts'
import type { ProjectSettings } from '@/shared/projects/project-settings'

export type PersonalChatWorkToolDefinition = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  needsApproval: boolean
}

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
  memoryEnabled: boolean
  paid: boolean
  projectSettings?: ProjectSettings
  requestFingerprint: string
  requestedToolIds: string[]
  turnId: string
  userId: string
  workspaceId: string
}
