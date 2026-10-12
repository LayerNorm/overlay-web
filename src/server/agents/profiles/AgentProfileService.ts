import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import {
  analyzeAgentProfileUpload,
  bundleFromAnalysis,
  isAgentProfileHarness,
  summarizeAgentProfile,
  type AgentProfileBundle,
  type AgentProfileHarness,
} from '@layernorm/overlay-agent-bridge-protocol'
import type { AuditService } from '@/server/admin'
import type { ByokCredentialStore } from '@/server/ai/gateway/byok-credential-store'
import {
  AgentProfileError,
  decodeProfileBundle,
  encodeProfileBundle,
  readProfileUpload,
} from './agent-profile-codec'
import type { AgentProfileMeta, AgentProfileRecord, AgentProfileRepository } from './AgentProfileRepository'

const IMPORT_CODE_TTL_MS = 15 * 60_000
const MAX_DROPPED_SHOWN = 400
const MAX_SECRET_VALUE_CHARS = 4_096
const SECRET_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/
/** Names a value may not take: they would change how the agent signs in, or how its process starts. */
const RESERVED_SECRET_NAME = /^(?:PATH|HOME|SHELL|USER|IFS|BASH_ENV|ENV|LD_.*|DYLD_.*|NODE_.*|NPM_.*|PYTHON.*|OVERLAY_.*|CLAUDE.*|ANTHROPIC_.*|OPENAI_.*|CODEX_.*)$/

export const EXPORT_CONFIG_PACKAGE = '@layernorm/overlay-agent-host@latest'

export type ApplyProfile = (args: {
  workspaceId: string
  agentId: string
  bundle: AgentProfileBundle
  hooksEnabled: boolean
  version: number
}) => Promise<void>

type Editable = { requireEditable(args: { actorUserId: string; workspaceId: string; agentId: string }): Promise<unknown> }

export function hashImportCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

export function isReservedSecretName(name: string): boolean {
  return !SECRET_NAME.test(name) || RESERVED_SECRET_NAME.test(name)
}

/** A profile as the page shows it: no chunk storage details, bounded lists. */
export function publicProfile(record: AgentProfileRecord) {
  return {
    id: record.id, version: record.version, status: record.status, harness: record.harness, summary: record.summary ?? null,
    meta: record.meta ? { ...record.meta, dropped: record.meta.dropped.slice(0, MAX_DROPPED_SHOWN), droppedTotal: record.meta.dropped.length } : null,
    hooksEnabled: record.hooksEnabled, createdAt: record.createdAt, uploadedAt: record.uploadedAt ?? null,
    appliedAt: record.appliedAt ?? null, codeExpiresAt: record.codeExpiresAt ?? null,
  }
}

/**
 * An Overlay Cloud agent's imported harness config: staged for review, applied to its machine, versioned so a bad import
 * can be rolled back. A version is only ever cleaned bundle contents; the values it needs (an MCP server's token) are set
 * separately, kept in the credential vault, and handed to the agent per run.
 */
export class AgentProfileService {
  constructor(private readonly dependencies: {
    repository: AgentProfileRepository
    agents: Editable
    store: Pick<ByokCredentialStore, 'write' | 'read' | 'delete'>
    apply: ApplyProfile
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

  /** A one-time code the person's computer (or browser) uploads with. */
  async createImportCode(args: { actorUserId: string; workspaceId: string; agentId: string; harness: unknown; serverUrl: string }) {
    await this.dependencies.agents.requireEditable(args)
    if (!isAgentProfileHarness(args.harness)) throw new AgentProfileError('Choose Claude Code or Codex.', 400, 'harness_invalid')
    const code = `ovprof_${randomBytes(24).toString('base64url')}`
    const now = this.now()
    const expiresAt = now + IMPORT_CODE_TTL_MS
    await this.dependencies.repository.createImport({
      workspaceId: args.workspaceId, agentId: args.agentId, userId: args.actorUserId, harness: args.harness,
      codeHash: hashImportCode(code), codeExpiresAt: expiresAt, now,
    })
    const server = args.serverUrl.replace(/\/+$/, '')
    return {
      code, expiresAt, uploadUrl: `${server}/api/v1/agent-profiles/upload`,
      command: `npx --yes --package node@24 --package ${EXPORT_CONFIG_PACKAGE} overlay-agent-host export-config ${args.harness} --server ${server} --code ${code}`,
    }
  }

  /** The upload endpoint: authenticated by the code alone. The upload is cleaned again here before anything is stored. */
  async receiveUpload(args: { code: string; body: Uint8Array }) {
    if (!args.code.startsWith('ovprof_')) throw new AgentProfileError('The import code is not valid.', 401, 'import_code_invalid')
    const upload = readProfileUpload(args.body)
    const analysis = analyzeAgentProfileUpload(upload)
    if (analysis.files.length === 0 && Object.keys(analysis.mcpServers).length === 0) {
      throw new AgentProfileError('Nothing in that upload can be imported.', 422, 'profile_empty')
    }
    const bundle = bundleFromAnalysis(analysis)
    const { chunks, digest } = encodeProfileBundle(bundle)
    const meta: AgentProfileMeta = {
      dropped: analysis.dropped.slice(0, 1_000), redactions: analysis.redactions.slice(0, 200), warnings: analysis.warnings.slice(0, 200),
      secrets: analysis.secrets, hooks: analysis.hooks, mcpServers: Object.keys(analysis.mcpServers),
    }
    const staged = await this.dependencies.repository.stageByCode({
      codeHash: hashImportCode(args.code), harness: upload.harness, summary: summarizeAgentProfile(analysis), meta, digest, chunks, now: this.now(),
    })
    if (!staged) throw new AgentProfileError('The import code is invalid, expired, or already used.', 401, 'import_code_invalid')
    await this.audit('agent_profile.staged', 'system', staged.profileId, { workspaceId: staged.workspaceId, agentId: staged.agentId, files: bundle.files.length })
    return { profileId: staged.profileId }
  }

  /** Applies a staged version, or rolls back to a superseded one, and makes it the active version. */
  async apply(args: { actorUserId: string; workspaceId: string; agentId: string; profileId: string; hooksEnabled?: boolean }) {
    const profile = await this.requireProfile(args)
    if (profile.status !== 'staged' && profile.status !== 'superseded') {
      throw new AgentProfileError('Only a version waiting for review, or an earlier version, can be applied.', 409, 'profile_not_applicable')
    }
    if (args.hooksEnabled !== undefined && args.hooksEnabled !== profile.hooksEnabled) {
      await this.dependencies.repository.setHooksEnabled({ profileId: profile.id, enabled: args.hooksEnabled })
    }
    const hooksEnabled = args.hooksEnabled ?? profile.hooksEnabled
    const bundle = decodeProfileBundle(await this.dependencies.repository.readChunks(profile.id))
    await this.dependencies.apply({ workspaceId: args.workspaceId, agentId: args.agentId, bundle, hooksEnabled, version: profile.version })
    await this.dependencies.repository.activate({ profileId: profile.id, now: this.now() })
    await this.audit('agent_profile.applied', 'user', profile.id, { workspaceId: args.workspaceId, agentId: args.agentId, actorUserId: args.actorUserId, version: profile.version })
    return { version: profile.version }
  }

  /** Turn imported hooks on or off; an active version is applied again so the machine matches. */
  async setHooks(args: { actorUserId: string; workspaceId: string; agentId: string; profileId: string; enabled: boolean }) {
    const profile = await this.requireProfile(args)
    await this.dependencies.repository.setHooksEnabled({ profileId: profile.id, enabled: args.enabled })
    if (profile.status === 'active') {
      const bundle = decodeProfileBundle(await this.dependencies.repository.readChunks(profile.id))
      await this.dependencies.apply({ workspaceId: args.workspaceId, agentId: args.agentId, bundle, hooksEnabled: args.enabled, version: profile.version })
    }
    await this.audit('agent_profile.hooks', 'user', profile.id, { workspaceId: args.workspaceId, agentId: args.agentId, actorUserId: args.actorUserId, enabled: args.enabled })
  }

  async discard(args: { actorUserId: string; workspaceId: string; agentId: string; profileId: string }) {
    const profile = await this.requireProfile(args)
    if (!await this.dependencies.repository.discard(profile.id)) {
      throw new AgentProfileError('Only a version waiting for review can be discarded.', 409, 'profile_not_discardable')
    }
  }

  async setSecret(args: { actorUserId: string; workspaceId: string; agentId: string; name: string; value: unknown }) {
    await this.dependencies.agents.requireEditable(args)
    if (isReservedSecretName(args.name)) {
      throw new AgentProfileError('Use a name like GITHUB_TOKEN. Names that change how the agent signs in or starts are not allowed.', 400, 'secret_name_invalid')
    }
    if (typeof args.value !== 'string' || !args.value.trim() || args.value.length > MAX_SECRET_VALUE_CHARS) {
      throw new AgentProfileError('Enter the value.', 400, 'secret_value_invalid')
    }
    const credentialRef = await this.dependencies.store.write({
      apiKey: args.value.trim(),
      context: { purpose: 'agent-secret', userId: args.actorUserId, providerId: args.name, connectionId: args.agentId },
    })
    const replaced = await this.dependencies.repository.setSecret({
      workspaceId: args.workspaceId, agentId: args.agentId, userId: args.actorUserId, name: args.name, credentialRef, now: this.now(),
    })
    if (replaced) await this.dependencies.store.delete(replaced).catch((_error) => undefined)
    await this.audit('agent_profile.secret_set', 'user', args.agentId, { workspaceId: args.workspaceId, name: args.name, actorUserId: args.actorUserId })
  }

  async deleteSecret(args: { actorUserId: string; workspaceId: string; agentId: string; name: string }) {
    await this.dependencies.agents.requireEditable(args)
    const ref = await this.dependencies.repository.deleteSecret({ agentId: args.agentId, name: args.name })
    if (ref) await this.dependencies.store.delete(ref).catch((_error) => undefined)
  }

  /** The agent's own secret values, for one run's environment. */
  async envForAgent(args: { agentId: string }): Promise<Record<string, string>> {
    const env: Record<string, string> = {}
    for (const { name, credentialRef } of await this.dependencies.repository.listSecretRefs(args.agentId)) {
      if (isReservedSecretName(name)) continue
      const value = await this.dependencies.store.read(credentialRef).catch((_error) => null)
      if (value) env[name] = value
    }
    return env
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
