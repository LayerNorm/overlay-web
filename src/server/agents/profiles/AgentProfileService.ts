import 'server-only'

import type { AuditService } from '@/server/admin'
import type { ByokCredentialStore } from '@/server/ai/gateway/byok-credential-store'
import type { AgentProfileHarness } from '@layernorm/overlay-agent-bridge-protocol'
import { AgentProfileError } from './agent-profile-codec'
import type { AgentProfileRecord, AgentProfileRepository } from './AgentProfileRepository'

const MAX_DROPPED_SHOWN = 400

type Editable = { requireEditable(args: { actorUserId: string; workspaceId: string; agentId: string }): Promise<unknown> }

/** A profile as the page shows it: no chunk storage details, bounded lists. */
export function publicProfile(record: AgentProfileRecord) {
  return {
    id: record.id, version: record.version, status: record.status, harness: record.harness, summary: record.summary ?? null,
    meta: record.meta ? { ...record.meta, dropped: record.meta.dropped.slice(0, MAX_DROPPED_SHOWN), droppedTotal: record.meta.dropped.length } : null,
    hooksEnabled: record.hooksEnabled, createdAt: record.createdAt, uploadedAt: record.uploadedAt ?? null,
    appliedAt: record.appliedAt ?? null, codeExpiresAt: record.codeExpiresAt ?? null,
  }
}

/** Read and safely remove historical Overlay Cloud profile data. */
export class AgentProfileService {
  constructor(private readonly dependencies: {
    repository: AgentProfileRepository
    agents: Editable
    store: Pick<ByokCredentialStore, 'delete'>
    audit: Pick<AuditService, 'record'>
    now?: () => number
  }) {}

  async state(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    await this.dependencies.agents.requireEditable(args)
    const [profiles, stored] = await Promise.all([
      this.dependencies.repository.listByAgent(args.agentId),
      this.dependencies.repository.listSecretNames(args.agentId),
    ])
    const current = profiles.find((profile) => profile.status === 'staged') ?? profiles.find((profile) => profile.status === 'active')
    const needed = new Map((current?.meta?.secrets ?? []).map((secret) => [secret.name, secret.usedBy]))
    const set = new Set(stored.map((secret) => secret.name))
    const names = [...new Set([...needed.keys(), ...set])].sort()
    return {
      profiles: profiles.map(publicProfile),
      secrets: names.map((name) => ({ name, usedBy: needed.get(name) ?? '', set: set.has(name) })),
    }
  }

  async discard(args: { actorUserId: string; workspaceId: string; agentId: string; profileId: string }) {
    const profile = await this.requireProfile(args)
    if (!await this.dependencies.repository.discard(profile.id)) {
      throw new AgentProfileError('Only a version waiting for review can be discarded.', 409, 'profile_not_discardable')
    }
  }

  async deleteSecret(args: { actorUserId: string; workspaceId: string; agentId: string; name: string }) {
    await this.dependencies.agents.requireEditable(args)
    const ref = await this.dependencies.repository.deleteSecret({ agentId: args.agentId, name: args.name })
    if (ref) await this.dependencies.store.delete(ref).catch((_error) => undefined)
  }

  /** The agent is going away: its versions, secret rows, and vault values go with it. */
  async deleteForAgent(agentId: string) {
    const removed = await this.dependencies.repository.deleteAllForAgent(agentId)
    await Promise.all(removed.secretRefs.map((ref) => this.dependencies.store.delete(ref).catch((_error) => undefined)))
  }

  private async requireProfile(args: { actorUserId: string; workspaceId: string; agentId: string; profileId: string }) {
    await this.dependencies.agents.requireEditable(args)
    const profile = await this.dependencies.repository.get(args.profileId)
    // A missing version and one that belongs to another agent look the same.
    if (!profile || profile.agentId !== args.agentId || profile.workspaceId !== args.workspaceId) {
      throw new AgentProfileError('Version not found.', 404, 'profile_not_found')
    }
    return profile
  }

  private async audit(action: string, actorType: 'user' | 'system', resourceId: string, metadata: Record<string, unknown>) {
    await this.dependencies.audit.record({
      action, actorType, ...(typeof metadata.actorUserId === 'string' ? { actorUserId: metadata.actorUserId } : {}),
      outcome: 'success', resourceType: 'agent_profile', resourceId, metadata,
    } as never).catch((_error) => undefined)
  }

  private now() {
    return this.dependencies.now?.() ?? Date.now()
  }
}

export type { AgentProfileHarness }
