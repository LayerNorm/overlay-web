import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { AgentProfileRecord, AgentProfileRepository } from './AgentProfileRepository'

const call = { throwOnError: true } as const
const secret = () => ({ serverSecret: getInternalApiSecret() })

export class ConvexAgentProfileRepository implements AgentProfileRepository {
  async createImport(args: Parameters<AgentProfileRepository['createImport']>[0]) {
    return (await convex.mutation<string>('agents/profiles:createImportByServer', { ...secret(), ...args }, call)) ?? ''
  }

  async stageByCode(args: Parameters<AgentProfileRepository['stageByCode']>[0]) {
    return await convex.mutation<{ profileId: string; agentId: string; workspaceId: string } | null>('agents/profiles:stageByCodeServer', { ...secret(), ...args }, call)
  }

  async get(profileId: string) {
    return await convex.query<AgentProfileRecord | null>('agents/profiles:getByServer', { ...secret(), profileId }, call)
  }

  async listByAgent(agentId: string) {
    return (await convex.query<AgentProfileRecord[]>('agents/profiles:listByAgentByServer', { ...secret(), agentId }, call)) ?? []
  }

  async readChunks(profileId: string) {
    return (await convex.query<string[]>('agents/profiles:readChunksByServer', { ...secret(), profileId }, call)) ?? []
  }

  async activate(args: { profileId: string; now: number }) {
    return Boolean(await convex.mutation<boolean>('agents/profiles:activateByServer', { ...secret(), ...args }, call))
  }

  async setHooksEnabled(args: { profileId: string; enabled: boolean }) {
    return Boolean(await convex.mutation<boolean>('agents/profiles:setHooksEnabledByServer', { ...secret(), ...args }, call))
  }

  async discard(profileId: string) {
    return Boolean(await convex.mutation<boolean>('agents/profiles:discardByServer', { ...secret(), profileId }, call))
  }

  async deleteAllForAgent(agentId: string) {
    return (await convex.mutation<{ profiles: number; secretRefs: string[] }>('agents/profiles:deleteAllForAgentByServer', { ...secret(), agentId }, call)) ?? { profiles: 0, secretRefs: [] }
  }

  async setSecret(args: Parameters<AgentProfileRepository['setSecret']>[0]) {
    return (await convex.mutation<string | null>('agents/profiles:setSecretByServer', { ...secret(), ...args }, call)) ?? null
  }

  async listSecretNames(agentId: string) {
    return (await convex.query<Array<{ name: string; updatedAt: number }>>('agents/profiles:listSecretNamesByServer', { ...secret(), agentId }, call)) ?? []
  }

  async listSecretRefs(agentId: string) {
    return (await convex.query<Array<{ name: string; credentialRef: string }>>('agents/profiles:listSecretRefsByServer', { ...secret(), agentId }, call)) ?? []
  }

  async deleteSecret(args: { agentId: string; name: string }) {
    return (await convex.mutation<string | null>('agents/profiles:deleteSecretByServer', { ...secret(), ...args }, call)) ?? null
  }
}
