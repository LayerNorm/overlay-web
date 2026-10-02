import 'server-only'

import type {
  AgentProfileHarness,
  ProfileDrop,
  ProfileHook,
  ProfileSecretNeed,
  ProfileSummary,
  ProfileWarning,
} from '@layernorm/overlay-agent-bridge-protocol'

export type AgentProfileStatus = 'awaiting_upload' | 'staged' | 'active' | 'superseded' | 'discarded'

/** What the review screen needs about a version, short of the files themselves. */
export type AgentProfileMeta = {
  dropped: ProfileDrop[]
  redactions: Array<{ path: string; count: number }>
  warnings: ProfileWarning[]
  secrets: ProfileSecretNeed[]
  hooks: ProfileHook[]
  mcpServers: string[]
}

export type AgentProfileRecord = {
  id: string
  workspaceId: string
  agentId: string
  userId: string
  harness: AgentProfileHarness
  version: number
  status: AgentProfileStatus
  codeExpiresAt?: number
  summary?: ProfileSummary
  meta?: AgentProfileMeta
  digest?: string
  chunkCount?: number
  hooksEnabled: boolean
  createdAt: number
  uploadedAt?: number
  appliedAt?: number
}

export type StagedProfileInput = { summary: ProfileSummary; meta: AgentProfileMeta; digest: string; chunks: string[]; now: number }

export interface AgentProfileRepository {
  createImport(args: {
    workspaceId: string; agentId: string; userId: string; harness: AgentProfileHarness
    codeHash: string; codeExpiresAt: number; now: number
  }): Promise<string>
  stageByCode(args: { codeHash: string; harness: AgentProfileHarness } & StagedProfileInput): Promise<{ profileId: string; agentId: string; workspaceId: string } | null>
  get(profileId: string): Promise<AgentProfileRecord | null>
  listByAgent(agentId: string): Promise<AgentProfileRecord[]>
  readChunks(profileId: string): Promise<string[]>
  activate(args: { profileId: string; now: number }): Promise<boolean>
  setHooksEnabled(args: { profileId: string; enabled: boolean }): Promise<boolean>
  discard(profileId: string): Promise<boolean>
  deleteAllForAgent(agentId: string): Promise<{ profiles: number; secretRefs: string[] }>
  setSecret(args: { workspaceId: string; agentId: string; userId: string; name: string; credentialRef: string; now: number }): Promise<string | null>
  listSecretNames(agentId: string): Promise<Array<{ name: string; updatedAt: number }>>
  listSecretRefs(agentId: string): Promise<Array<{ name: string; credentialRef: string }>>
  deleteSecret(args: { agentId: string; name: string }): Promise<string | null>
}
