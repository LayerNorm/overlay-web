import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  WorkspaceAuditExportRecord,
  WorkspaceIdentityMapping,
  WorkspaceOperationalMetrics,
} from '@overlay/workspace-contracts'
import type { WorkspacePlatformInstallationRecord } from '@/server/workspaces/WorkspaceRepository'
import type { RateLimiter } from '@overlay/app-core'
import {
  isForbiddenByLimit,
  resolveCollaborationLimits,
  type CollaborationAction,
  type CollaborationLimitScope,
} from '@/shared/workspaces/collaboration-limits'
import type { AuditRepository } from '@/server/admin/AuditRepository'
import type { WorkspaceRepository } from '@/server/workspaces/WorkspaceRepository'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

/** Audit actions an export must include to reconcile with workspace state. */
export const WORKSPACE_AUDIT_EXPORT_ACTIONS = [
  'workspace.membership',
  'workspace.grant',
  'workspace.message',
  'workspace.agent_run',
  'workspace.approval',
  'workspace.external_action',
  'conversation.message.reported',
] as const

export type WorkspaceAuditEvent = {
  id: string
  action: string
  actorUserId?: string
  outcome: string
  resourceType: string
  resourceId?: string
  recordedAt: number
  metadata: Record<string, unknown>
}

/**
 * Enterprise controls that sit above the collaboration features: abuse limits,
 * immutable audit export, provider-neutral directory identity, retention, and
 * the operational signals an operator needs to trust a rollout.
 */
export class WorkspaceGovernanceService {
  constructor(private readonly deps: {
    audit: AuditRepository
    rateLimiter: RateLimiter
    repository: WorkspaceRepository
    workspaces: WorkspaceService
    appDataProvider: string
    requiresConvexClient: boolean
    metrics?: {
      outboxPending(workspaceId: string): Promise<{ count: number; oldestAgeMs: number }>
      failedDeliveries(workspaceId: string): Promise<number>
      agentRuns(workspaceId: string): Promise<{ queued: number; failed: number }>
      unreadDrift(workspaceId: string): Promise<number>
    }
    id?: () => string
    now?: () => number
  }) {}

  /**
   * Applies every limit that covers an action. A refusal is a 429 the caller can
   * surface; a zero limit for the scope is a 403 because it is a policy, not a
   * throttle.
   */
  async assertWithinLimits(args: {
    action: CollaborationAction
    scope: CollaborationLimitScope
  }): Promise<void> {
    for (const resolved of resolveCollaborationLimits(args.action, args.scope)) {
      if (isForbiddenByLimit(resolved.limits)) {
        throw new WorkspaceServiceError(
          `${args.action} is not permitted for this principal`,
          403,
          'forbidden',
        )
      }
      const result = await this.deps.rateLimiter.check(resolved.key, resolved.limits)
      if (!result.allowed) {
        throw new WorkspaceServiceError(
          `Too many ${args.action} attempts. Try again shortly.`,
          429,
          'conflict',
        )
      }
    }
  }

  /**
   * Immutable audit export for a workspace. Events are read append-only and
   * filtered to this workspace; the export itself is recorded so an operator can
   * prove which window was covered.
   */
  async exportAudit(args: {
    actorUserId: string
    workspaceId: string
    fromRecordedAt?: number
    limit?: number
  }): Promise<{ record: WorkspaceAuditExportRecord; events: WorkspaceAuditEvent[] }> {
    const access = await this.requireManager(args)
    await this.assertWithinLimits({
      action: 'audit.export',
      scope: { workspaceId: access.workspace.id, principalId: access.principal.id },
    })
    const now = (this.deps.now ?? Date.now)()
    const rows = await this.deps.audit.list({ limit: args.limit ?? 1_000 })
    const events = rows
      .map((row) => ({
        id: row.id,
        action: row.action,
        actorUserId: row.actorUserId ?? undefined,
        outcome: row.outcome,
        resourceType: row.resourceType,
        resourceId: row.resourceId ?? undefined,
        recordedAt: row.createdAt,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
      }))
      .filter((event) => event.metadata.workspaceId === access.workspace.id)
      .filter((event) => !args.fromRecordedAt || event.recordedAt >= args.fromRecordedAt)
      .sort((a, b) => a.recordedAt - b.recordedAt || a.id.localeCompare(b.id))
    const record = await this.deps.repository.recordAuditExport({
      id: (this.deps.id ?? randomUUID)(),
      workspaceId: access.workspace.id,
      requestedByPrincipalId: access.principal.id,
      fromRecordedAt: args.fromRecordedAt,
      toRecordedAt: now,
      eventCount: events.length,
      now,
    })
    return { record, events }
  }

  async listAuditExports(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceAuditExportRecord[]> {
    const access = await this.requireManager(args)
    return await this.deps.repository.listAuditExports({ workspaceId: access.workspace.id })
  }

  /**
   * Maps a directory identity to a workspace principal.
   *
   * The identity provider supplies identity, never authorization: group ids are
   * stored for reference but the caller must still assign workspace roles and
   * teams explicitly. A provider claim can never promote anybody.
   */
  async linkDirectoryIdentity(args: {
    actorUserId: string
    workspaceId: string
    principalId: string
    directory: string
    externalId: string
    externalGroupIds?: string[]
  }): Promise<WorkspaceIdentityMapping> {
    const access = await this.requireManager(args)
    const principal = await this.deps.repository.getPrincipal(args.principalId)
    if (!principal || principal.workspaceId !== access.workspace.id || principal.archivedAt) {
      throw new WorkspaceServiceError('Principal not found in this workspace', 404, 'not_found')
    }
    const directory = normalized(args.directory, 'directory')
    const externalId = normalized(args.externalId, 'externalId')
    const mapping = await this.deps.repository.upsertIdentityMapping({
      id: (this.deps.id ?? randomUUID)(),
      workspaceId: access.workspace.id,
      principalId: principal.id,
      directory,
      externalId,
      externalGroupIds: [...new Set(args.externalGroupIds ?? [])],
      now: (this.deps.now ?? Date.now)(),
    })
    await this.recordGovernanceAudit({
      action: 'workspace.membership',
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      resourceId: principal.id,
      metadata: { directory, externalId, event: 'identity_linked' },
    })
    return mapping
  }

  async listDirectoryIdentities(args: {
    actorUserId: string
    workspaceId: string
    includeDeprovisioned?: boolean
  }): Promise<WorkspaceIdentityMapping[]> {
    const access = await this.requireManager(args)
    return await this.deps.repository.listIdentityMappings({
      workspaceId: access.workspace.id,
      includeDeprovisioned: args.includeDeprovisioned,
    })
  }

  /**
   * Links a chat-platform workspace (Slack team, Teams tenant, …) to this
   * Overlay workspace for bot surfaces. Manager-gated and audited like
   * directory identity linking. The token travels as server-side ciphertext;
   * this method never sees plaintext.
   */
  async linkPlatformInstallation(args: {
    actorUserId: string
    workspaceId: string
    directory: string
    externalTeamId: string
    enterpriseId?: string
    isEnterpriseInstall?: boolean
    teamName?: string
    botUserId?: string
    botTokenCipher: string
  }): Promise<WorkspacePlatformInstallationRecord> {
    const access = await this.requireManager(args)
    const installer = await this.deps.repository.getPrincipal(access.principal.id)
    if (!installer || installer.workspaceId !== access.workspace.id || installer.archivedAt) {
      throw new WorkspaceServiceError('Principal not found in this workspace', 404, 'not_found')
    }
    const directory = normalized(args.directory, 'directory')
    const externalTeamId = normalized(args.externalTeamId, 'externalTeamId')
    const botTokenCipher = normalized(args.botTokenCipher, 'botTokenCipher')
    // Storage key: enterprise id for org-wide installs, else the team id —
    // the same key Chat SDK's installationProvider receives.
    const installationId = args.isEnterpriseInstall && args.enterpriseId?.trim()
      ? args.enterpriseId.trim()
      : externalTeamId
    const installation = await this.deps.repository.upsertPlatformInstallation({
      installationId,
      workspaceId: access.workspace.id,
      directory,
      externalTeamId,
      enterpriseId: args.enterpriseId?.trim() || undefined,
      isEnterpriseInstall: args.isEnterpriseInstall ?? false,
      teamName: args.teamName?.trim() || undefined,
      botUserId: args.botUserId?.trim() || undefined,
      botTokenCipher,
      installedByPrincipalId: installer.id,
      now: (this.deps.now ?? Date.now)(),
    })
    await this.recordGovernanceAudit({
      action: 'workspace.membership',
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      resourceId: installation.id,
      metadata: { directory, externalTeamId, event: 'platform_install_linked' },
    })
    return installation
  }

  async listPlatformInstallations(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspacePlatformInstallationRecord[]> {
    // Token-free summaries: any active member may see which platforms are
    // connected (the editor's "Add your agent to" step needs this). Tokens
    // never leave the repository layer.
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    return await this.deps.repository.listPlatformInstallations({
      workspaceId: access.workspace.id,
    })
  }

  /**
   * Self-service linking: any active member may link or unlink their *own*
   * principal to a chat identity (the per-agent editor flow depends on this).
   * Linking anyone else stays manager-gated through `linkDirectoryIdentity`.
   */
  async linkOwnDirectoryIdentity(args: {
    actorUserId: string
    workspaceId: string
    directory: string
    externalId: string
  }): Promise<WorkspaceIdentityMapping> {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const directory = normalized(args.directory, 'directory')
    const externalId = normalized(args.externalId, 'externalId')
    if (!['slack', 'msteams'].includes(directory)) {
      throw new WorkspaceServiceError('Unsupported chat platform', 400, 'validation')
    }
    const mapping = await this.deps.repository.upsertIdentityMapping({
      id: (this.deps.id ?? randomUUID)(),
      workspaceId: access.workspace.id,
      principalId: access.principal.id,
      directory,
      externalId,
      externalGroupIds: [],
      now: (this.deps.now ?? Date.now)(),
    })
    await this.recordGovernanceAudit({
      action: 'workspace.membership',
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      resourceId: access.principal.id,
      metadata: { directory, externalId, event: 'identity_self_linked' },
    })
    return mapping
  }

  async unlinkOwnDirectoryIdentity(args: {
    actorUserId: string
    workspaceId: string
    directory: string
    externalId: string
  }): Promise<void> {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const existing = await this.deps.repository.getIdentityMapping({
      workspaceId: access.workspace.id,
      directory: normalized(args.directory, 'directory'),
      externalId: normalized(args.externalId, 'externalId'),
    })
    if (!existing || existing.principalId !== access.principal.id) {
      throw new WorkspaceServiceError('Directory identity not found', 404, 'not_found')
    }
    await this.deps.repository.deprovisionIdentityMapping({
      workspaceId: access.workspace.id,
      directory: existing.directory,
      externalId: existing.externalId,
      now: (this.deps.now ?? Date.now)(),
    })
    await this.recordGovernanceAudit({
      action: 'workspace.membership',
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      resourceId: access.principal.id,
      metadata: { directory: existing.directory, externalId: existing.externalId, event: 'identity_self_unlinked' },
    })
  }

  /**
   * Team-keyed install lookup for trusted bot processes holding the service
   * credential. Ungated like `resolvePlatformActor`: user-facing routes must
   * never expose it directly. Returns the ciphertext record; decryption is
   * the platform-bot layer's job.
   */
  async getPlatformInstallationByTeam(args: {
    directory: string
    externalTeamId: string
  }): Promise<WorkspacePlatformInstallationRecord | null> {
    return await this.deps.repository.getPlatformInstallationByTeam({
      directory: normalized(args.directory, 'directory'),
      externalTeamId: normalized(args.externalTeamId, 'externalTeamId'),
    })
  }

  /**
   * Claims a platform webhook delivery for at-most-once handling (trusted
   * bot path, like `getPlatformInstallationByTeam`). First claim wins;
   * redeliveries report false so the transport can ack without re-running.
   */
  async claimPlatformEvent(args: {
    workspaceId?: string
    directory: string
    externalTeamId: string
    eventId: string
  }): Promise<boolean> {
    return await this.deps.repository.claimPlatformEvent({
      workspaceId: args.workspaceId,
      directory: normalized(args.directory, 'directory'),
      externalTeamId: normalized(args.externalTeamId, 'externalTeamId'),
      eventId: normalized(args.eventId, 'eventId'),
      now: (this.deps.now ?? Date.now)(),
    })
  }

  /**
   * Removes a platform install. Message history and audit records are
   * preserved; the bot stops serving that team immediately.
   */
  async unlinkPlatformInstallation(args: {
    actorUserId: string
    workspaceId: string
    directory: string
    externalTeamId: string
  }): Promise<void> {
    const access = await this.requireManager(args)
    const removed = await this.deps.repository.deletePlatformInstallation({
      workspaceId: access.workspace.id,
      directory: normalized(args.directory, 'directory'),
      externalTeamId: normalized(args.externalTeamId, 'externalTeamId'),
    })
    if (!removed) {
      throw new WorkspaceServiceError('Platform installation not found', 404, 'not_found')
    }
    await this.recordGovernanceAudit({
      action: 'workspace.membership',
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      resourceId: `${args.directory}:${args.externalTeamId}`,
      metadata: { event: 'platform_install_unlinked' },
    })
  }

  /**
   * Resolves a chat-platform user (Slack, Teams, …) to its linked workspace
   * principal for bot surfaces. The link itself is created through the
   * manager-gated `linkDirectoryIdentity`; this lookup is deliberately
   * ungated so trusted bot processes holding the service credential can call
   * it — user-facing routes must never expose it directly.
   *
   * Unknown, deprovisioned, archived, or non-human identities all report as
   * `not_found`, so mapping existence never leaks to the platform. Callers
   * then act with the returned `userId` through the standard services, which
   * keeps directory, DM, and mention authorization (including creator-only
   * agent visibility) identical inside and outside Overlay.
   */
  async resolvePlatformActor(args: {
    workspaceId: string
    directory: string
    externalId: string
  }): Promise<{ principalId: string; userId: string }> {
    const unlinked = new WorkspaceServiceError('Platform identity is not linked', 404, 'not_found')
    const mapping = await this.deps.repository.getIdentityMapping({
      workspaceId: args.workspaceId,
      directory: normalized(args.directory, 'directory'),
      externalId: normalized(args.externalId, 'externalId'),
    })
    if (!mapping || mapping.status !== 'active') throw unlinked
    const principal = await this.deps.repository.getPrincipal(mapping.principalId)
    if (!principal
      || principal.workspaceId !== args.workspaceId
      || principal.archivedAt
      || principal.type !== 'human'
      || !principal.userId) throw unlinked
    return { principalId: principal.id, userId: principal.userId }
  }

  /**
   * SCIM deprovisioning: the mapping is retired and the principal's membership
   * suspended. Message history and audit records are preserved.
   */
  async deprovisionDirectoryIdentity(args: {
    actorUserId: string
    workspaceId: string
    directory: string
    externalId: string
  }): Promise<WorkspaceIdentityMapping> {
    const access = await this.requireManager(args)
    const now = (this.deps.now ?? Date.now)()
    const mapping = await this.deps.repository.deprovisionIdentityMapping({
      workspaceId: access.workspace.id,
      directory: normalized(args.directory, 'directory'),
      externalId: normalized(args.externalId, 'externalId'),
      now,
    })
    if (!mapping) {
      throw new WorkspaceServiceError('Directory identity not found', 404, 'not_found')
    }
    await this.deps.workspaces.setMembershipStatus({
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      principalId: mapping.principalId,
      status: 'suspended',
    }).catch((error: unknown) => {
      // A last owner cannot be suspended; the mapping is still retired so the
      // directory stops resolving to this principal.
      if (!(error instanceof WorkspaceServiceError)) throw error
    })
    await this.recordGovernanceAudit({
      action: 'workspace.membership',
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      resourceId: mapping.principalId,
      metadata: { directory: mapping.directory, externalId: mapping.externalId, event: 'identity_deprovisioned' },
    })
    return mapping
  }

  /**
   * Chat-identity unlink: retires the platform mapping so the bot stops
   * resolving it, without touching workspace membership. Unlike SCIM
   * deprovisioning (offboarding — suspends the member), unlinking a Slack or
   * Teams identity leaves the person a full member; only future bot
   * invocation is retired. History and audit records are preserved.
   */
  async unlinkDirectoryIdentity(args: {
    actorUserId: string
    workspaceId: string
    directory: string
    externalId: string
  }): Promise<WorkspaceIdentityMapping> {
    const access = await this.requireManager(args)
    const mapping = await this.deps.repository.deprovisionIdentityMapping({
      workspaceId: access.workspace.id,
      directory: normalized(args.directory, 'directory'),
      externalId: normalized(args.externalId, 'externalId'),
      now: (this.deps.now ?? Date.now)(),
    })
    if (!mapping) {
      throw new WorkspaceServiceError('Directory identity not found', 404, 'not_found')
    }
    await this.recordGovernanceAudit({
      action: 'workspace.membership',
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      resourceId: mapping.principalId,
      metadata: { directory: mapping.directory, externalId: mapping.externalId, event: 'identity_unlinked' },
    })
    return mapping
  }

  /** Operational dashboard signals for one workspace. */
  async collectMetrics(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<WorkspaceOperationalMetrics> {
    const access = await this.requireManager(args)
    const workspaceId = access.workspace.id
    const [outbox, failedDeliveries, agentRuns, unreadDrift, auditRows] = await Promise.all([
      this.deps.metrics?.outboxPending(workspaceId) ?? Promise.resolve({ count: 0, oldestAgeMs: 0 }),
      this.deps.metrics?.failedDeliveries(workspaceId) ?? Promise.resolve(0),
      this.deps.metrics?.agentRuns(workspaceId) ?? Promise.resolve({ queued: 0, failed: 0 }),
      this.deps.metrics?.unreadDrift(workspaceId) ?? Promise.resolve(0),
      this.deps.audit.list({ limit: 500 }),
    ])
    const workspaceEvents = auditRows.filter((row) => (
      (row.metadata as Record<string, unknown> | undefined)?.workspaceId === workspaceId
    ))
    return {
      workspaceId,
      collectedAt: (this.deps.now ?? Date.now)(),
      outboxPendingEvents: outbox.count,
      outboxOldestPendingAgeMs: outbox.oldestAgeMs,
      failedDeliveries,
      agentRunsQueued: agentRuns.queued,
      agentRunsFailed: agentRuns.failed,
      authorizationDenials: workspaceEvents.filter((row) => row.outcome === 'denied').length,
      invitationFailures: workspaceEvents.filter((row) => (
        row.action.startsWith('workspace.invitation') && row.outcome !== 'success'
      )).length,
      unreadDriftConversations: unreadDrift,
      providerParity: {
        provider: this.deps.appDataProvider,
        requiresConvexClient: this.deps.requiresConvexClient,
      },
    }
  }

  /**
   * Retention decision for a workspace. Legal hold always wins: while it is on,
   * nothing is swept even if a retention window is configured.
   */
  async resolveRetention(args: {
    actorUserId: string
    workspaceId: string
  }): Promise<{ retentionDays?: number; legalHold: boolean; deleteBefore?: number }> {
    const policy = await this.deps.workspaces.getSharingPolicy(args)
    if (policy.legalHold || !policy.channelRetentionDays) {
      return { retentionDays: policy.channelRetentionDays, legalHold: policy.legalHold }
    }
    const now = (this.deps.now ?? Date.now)()
    return {
      retentionDays: policy.channelRetentionDays,
      legalHold: false,
      deleteBefore: now - policy.channelRetentionDays * 24 * 60 * 60 * 1_000,
    }
  }

  private async recordGovernanceAudit(args: {
    action: string
    actorUserId: string
    workspaceId: string
    resourceId?: string
    metadata: Record<string, unknown>
  }): Promise<void> {
    await this.deps.audit.append({
      action: args.action,
      actorType: 'user',
      actorUserId: args.actorUserId,
      outcome: 'success',
      resourceType: 'workspace',
      resourceId: args.resourceId,
      metadata: { ...args.metadata, workspaceId: args.workspaceId },
    })
  }

  private async requireManager(args: { actorUserId: string; workspaceId: string }) {
    const access = await this.deps.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (access.membership.role !== 'owner' && access.membership.role !== 'admin') {
      throw new WorkspaceServiceError(
        'Only workspace owners and admins can use governance controls',
        403,
        'forbidden',
      )
    }
    return access
  }
}

function normalized(value: string, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new WorkspaceServiceError(`${field} is required`, 400, 'validation')
  return trimmed
}
