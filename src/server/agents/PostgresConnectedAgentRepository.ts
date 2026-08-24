import 'server-only'

import { and, asc, eq, inArray, lte, max, or, sql } from 'drizzle-orm'
import type {
  AgentApprovalRequest, AgentBinding, AgentEnvironment, AgentRemoteSession,
  AgentRunCommand, AgentSandboxLease,
} from '@overlay/workspace-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  agentApprovalRequests, agentBindings, agentEnvironments, agentRemoteSessions,
  agentRunCommands, agentSandboxLeases,
} from '@/server/database/postgres/schema'
import type {
  ApplyRemoteEventsResult, ConnectedAgentCreateBinding, ConnectedAgentCreateEnvironment,
  ConnectedAgentCreateSession, ConnectedAgentEnqueueCommand, ConnectedAgentRepository,
} from './ConnectedAgentRepository'

export class PostgresConnectedAgentRepository implements ConnectedAgentRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async createEnvironment(input: ConnectedAgentCreateEnvironment) {
    const [row] = await this.db.insert(agentEnvironments).values({
      id: input.id, workspaceId: input.workspaceId, kind: input.kind, name: input.name,
      status: input.status, publicKey: input.publicKey, hostVersion: input.hostVersion,
      platform: input.platform, capabilities: input.capabilities,
      lastSeenAt: date(input.lastSeenAt), revokedAt: date(input.revokedAt),
      createdAt: new Date(input.now), updatedAt: new Date(input.now),
    }).returning()
    return environment(row)
  }

  async createBinding(input: ConnectedAgentCreateBinding) {
    await this.requireActiveEnvironment(input.workspaceId, input.environmentId)
    const [row] = await this.db.insert(agentBindings).values({
      ...input, createdAt: new Date(input.now), updatedAt: new Date(input.now),
    }).returning()
    return binding(row)
  }

  async createRemoteSession(input: ConnectedAgentCreateSession) {
    await this.requireActiveEnvironment(input.workspaceId, input.environmentId)
    const [bindingRow] = await this.db.select({ id: agentBindings.id }).from(agentBindings).where(and(
      eq(agentBindings.id, input.bindingId),
      eq(agentBindings.workspaceId, input.workspaceId),
      eq(agentBindings.environmentId, input.environmentId),
      eq(agentBindings.enabled, true),
    ))
    if (!bindingRow) throw new Error('AGENT_BINDING_UNAVAILABLE')
    const [row] = await this.db.insert(agentRemoteSessions).values({
      id: input.id, workspaceId: input.workspaceId, environmentId: input.environmentId,
      bindingId: input.bindingId, runId: input.runId, remoteSessionId: input.remoteSessionId,
      status: input.status, commandCursor: input.commandCursor, eventCursor: input.eventCursor,
      capabilitySnapshot: input.capabilitySnapshot, startedAt: date(input.startedAt),
      endedAt: date(input.endedAt), createdAt: new Date(input.now), updatedAt: new Date(input.now),
    }).returning()
    return session(row)
  }

  async enqueueCommand(input: ConnectedAgentEnqueueCommand) {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.environmentId}, 0))`)
      const [environmentRow] = await tx.select({ status: agentEnvironments.status }).from(agentEnvironments).where(and(
        eq(agentEnvironments.id, input.environmentId),
        eq(agentEnvironments.workspaceId, input.workspaceId),
      ))
      if (!environmentRow || environmentRow.status === 'revoked') {
        throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
      }
      const [cursor] = await tx.select({ value: max(agentRunCommands.sequence) })
        .from(agentRunCommands).where(eq(agentRunCommands.environmentId, input.environmentId))
      const [row] = await tx.insert(agentRunCommands).values({
        id: input.id, workspaceId: input.workspaceId, environmentId: input.environmentId,
        runId: input.runId, type: input.type, payload: input.payload,
        sequence: (cursor?.value ?? 0) + 1, status: 'pending',
        createdAt: new Date(input.now), updatedAt: new Date(input.now),
      }).returning()
      return command(row)
    })
  }

  async claimCommands(args: { workspaceId: string; environmentId: string; now: number; leaseMs: number; limit: number }) {
    return await this.db.transaction(async (tx) => {
      const [environmentRow] = await tx.select().from(agentEnvironments).where(and(
        eq(agentEnvironments.id, args.environmentId), eq(agentEnvironments.workspaceId, args.workspaceId),
      )).for('update')
      if (!environmentRow || environmentRow.status === 'revoked') return []
      const candidates = await tx.select({ id: agentRunCommands.id }).from(agentRunCommands).where(and(
        eq(agentRunCommands.workspaceId, args.workspaceId), eq(agentRunCommands.environmentId, args.environmentId),
        or(eq(agentRunCommands.status, 'pending'), and(
          eq(agentRunCommands.status, 'claimed'), lte(agentRunCommands.claimExpiresAt, new Date(args.now)),
        )),
      )).orderBy(asc(agentRunCommands.sequence)).limit(Math.max(1, Math.min(args.limit, 100))).for('update', { skipLocked: true })
      if (candidates.length === 0) return []
      const rows = await tx.update(agentRunCommands).set({
        status: 'claimed', claimedAt: new Date(args.now),
        claimExpiresAt: new Date(args.now + args.leaseMs), updatedAt: new Date(args.now),
      }).where(inArray(agentRunCommands.id, candidates.map(({ id }) => id))).returning()
      return rows.sort((a, b) => a.sequence - b.sequence).map(command)
    })
  }

  async acknowledgeCommand(args: Parameters<ConnectedAgentRepository['acknowledgeCommand']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(agentRunCommands).where(and(
        eq(agentRunCommands.id, args.commandId),
        eq(agentRunCommands.workspaceId, args.workspaceId),
        eq(agentRunCommands.environmentId, args.environmentId),
      )).for('update')
      if (!row || row.status === 'cancelled') return false
      if (row.status !== 'acknowledged') {
        await tx.update(agentRunCommands).set({
          status: 'acknowledged',
          acknowledgedAt: new Date(args.now),
          claimExpiresAt: null,
          updatedAt: new Date(args.now),
        }).where(eq(agentRunCommands.id, row.id))
      }
      await tx.update(agentRemoteSessions).set({
        commandCursor: sql`GREATEST(${agentRemoteSessions.commandCursor}, ${row.sequence})`,
        updatedAt: new Date(args.now),
      }).where(and(
        eq(agentRemoteSessions.workspaceId, args.workspaceId),
        eq(agentRemoteSessions.environmentId, args.environmentId),
        eq(agentRemoteSessions.runId, row.runId),
      ))
      return true
    })
  }

  async createApprovalRequest(input: Parameters<ConnectedAgentRepository['createApprovalRequest']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [sessionRow] = await tx.select({ id: agentRemoteSessions.id }).from(agentRemoteSessions).where(and(
        eq(agentRemoteSessions.id, input.remoteSessionId),
        eq(agentRemoteSessions.workspaceId, input.workspaceId),
        eq(agentRemoteSessions.runId, input.runId),
      ))
      if (!sessionRow) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
      const [existing] = await tx.select().from(agentApprovalRequests).where(and(
        eq(agentApprovalRequests.remoteSessionId, input.remoteSessionId),
        eq(agentApprovalRequests.requestKey, input.requestKey),
      ))
      if (existing) return approval(existing)
      const [row] = await tx.insert(agentApprovalRequests).values({
        id: input.id,
        workspaceId: input.workspaceId,
        runId: input.runId,
        remoteSessionId: input.remoteSessionId,
        requestKey: input.requestKey,
        prompt: input.prompt,
        options: input.options,
        payload: input.payload,
        requestedAt: new Date(input.requestedAt),
        resolution: input.resolution,
      }).returning()
      return approval(row)
    })
  }

  async resolveApprovalRequest(args: Parameters<ConnectedAgentRepository['resolveApprovalRequest']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(agentApprovalRequests).where(and(
        eq(agentApprovalRequests.id, args.approvalId),
        eq(agentApprovalRequests.workspaceId, args.workspaceId),
      )).for('update')
      if (!current) return null
      if (current.resolution) {
        if (!sameResolution(current.resolution, args.resolution)) {
          throw new Error('AGENT_APPROVAL_ALREADY_RESOLVED')
        }
        return approval(current)
      }
      const [row] = await tx.update(agentApprovalRequests).set({ resolution: args.resolution })
        .where(eq(agentApprovalRequests.id, args.approvalId)).returning()
      return approval(row)
    })
  }

  async createSandboxLease(input: Parameters<ConnectedAgentRepository['createSandboxLease']>[0]) {
    await this.requireActiveEnvironment(input.workspaceId, input.environmentId)
    const [row] = await this.db.insert(agentSandboxLeases).values({
      id: input.id,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      runId: input.runId,
      provider: input.provider,
      providerReference: input.providerReference,
      status: input.status,
      reservationId: input.reservationId,
      reservedUntil: new Date(input.reservedUntil),
      runtimeStartedAt: date(input.runtimeStartedAt),
      runtimeEndedAt: date(input.runtimeEndedAt),
      usage: input.usage,
      cleanupAttempts: input.cleanupAttempts,
      cleanupAfter: date(input.cleanupAfter),
      createdAt: new Date(input.now),
      updatedAt: new Date(input.now),
    }).returning()
    return sandboxLease(row)
  }

  async updateSandboxLease(input: Parameters<ConnectedAgentRepository['updateSandboxLease']>[0]) {
    const update: Partial<typeof agentSandboxLeases.$inferInsert> = { updatedAt: new Date(input.now) }
    if (input.status !== undefined) update.status = input.status
    if (input.providerReference !== undefined) update.providerReference = input.providerReference
    if (input.reservationId !== undefined) update.reservationId = input.reservationId
    if (input.reservedUntil !== undefined) update.reservedUntil = new Date(input.reservedUntil)
    if (input.runtimeStartedAt !== undefined) update.runtimeStartedAt = new Date(input.runtimeStartedAt)
    if (input.runtimeEndedAt !== undefined) update.runtimeEndedAt = new Date(input.runtimeEndedAt)
    if (input.usage !== undefined) update.usage = input.usage
    if (input.cleanupAttempts !== undefined) update.cleanupAttempts = input.cleanupAttempts
    if (input.cleanupAfter !== undefined) update.cleanupAfter = new Date(input.cleanupAfter)
    const [row] = await this.db.update(agentSandboxLeases).set(update).where(and(
      eq(agentSandboxLeases.id, input.leaseId),
      eq(agentSandboxLeases.workspaceId, input.workspaceId),
    )).returning()
    return row ? sandboxLease(row) : null
  }

  async applyRemoteEvents(args: Parameters<ConnectedAgentRepository['applyRemoteEvents']>[0]): Promise<ApplyRemoteEventsResult> {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(agentRemoteSessions).where(and(
        eq(agentRemoteSessions.id, args.sessionId), eq(agentRemoteSessions.workspaceId, args.workspaceId),
        eq(agentRemoteSessions.environmentId, args.environmentId),
      )).for('update')
      if (!current) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
      if (args.events.length === 0) return { accepted: true, acknowledgedSequence: current.eventCursor, duplicate: true }
      const sequences = args.events.map((event) => event.sourceSequence)
      const first = sequences[0]!
      if (sequences.some((value, index) => value !== first + index)) throw new Error('AGENT_EVENT_BATCH_NOT_CONTIGUOUS')
      if (args.events.some((event) => event.environmentId !== args.environmentId || event.runId !== current.runId)) {
        throw new Error('AGENT_EVENT_SCOPE_MISMATCH')
      }
      if (sequences.at(-1)! <= current.eventCursor) {
        return { accepted: true, acknowledgedSequence: current.eventCursor, duplicate: true }
      }
      const expected = current.eventCursor + 1
      if (first !== expected) return { accepted: false, expectedSequence: expected }
      await tx.update(agentRemoteSessions).set({ eventCursor: sequences.at(-1)!, updatedAt: new Date(args.now) })
        .where(eq(agentRemoteSessions.id, args.sessionId))
      return { accepted: true, acknowledgedSequence: sequences.at(-1)!, duplicate: false }
    })
  }

  async revokeEnvironment(args: { workspaceId: string; environmentId: string; now: number }) {
    return await this.db.transaction(async (tx) => {
      const rows = await tx.update(agentEnvironments).set({
        status: 'revoked', revokedAt: new Date(args.now), updatedAt: new Date(args.now),
      }).where(and(eq(agentEnvironments.id, args.environmentId), eq(agentEnvironments.workspaceId, args.workspaceId)))
        .returning({ id: agentEnvironments.id })
      if (rows.length === 0) return false
      await tx.update(agentBindings).set({ enabled: false, updatedAt: new Date(args.now) })
        .where(eq(agentBindings.environmentId, args.environmentId))
      await tx.update(agentRunCommands).set({ status: 'cancelled', updatedAt: new Date(args.now) }).where(and(
        eq(agentRunCommands.environmentId, args.environmentId),
        inArray(agentRunCommands.status, ['pending', 'claimed']),
      ))
      return true
    })
  }

  async deleteWorkspaceData(args: { workspaceId: string }) {
    await this.db.delete(agentEnvironments).where(eq(agentEnvironments.workspaceId, args.workspaceId))
  }

  private async requireActiveEnvironment(workspaceId: string, environmentId: string) {
    const [row] = await this.db.select({ status: agentEnvironments.status }).from(agentEnvironments).where(and(
      eq(agentEnvironments.id, environmentId), eq(agentEnvironments.workspaceId, workspaceId),
    ))
    if (!row || row.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
  }
}

type EnvironmentRow = typeof agentEnvironments.$inferSelect
type BindingRow = typeof agentBindings.$inferSelect
type SessionRow = typeof agentRemoteSessions.$inferSelect
type CommandRow = typeof agentRunCommands.$inferSelect
type ApprovalRow = typeof agentApprovalRequests.$inferSelect
type SandboxLeaseRow = typeof agentSandboxLeases.$inferSelect
const ms = (value: Date | null) => value?.getTime()
const date = (value?: number) => value === undefined ? undefined : new Date(value)
function environment(row: EnvironmentRow): AgentEnvironment { return { ...row, kind: row.kind as AgentEnvironment['kind'], status: row.status as AgentEnvironment['status'], lastSeenAt: ms(row.lastSeenAt), revokedAt: ms(row.revokedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(), publicKey: row.publicKey ?? undefined, hostVersion: row.hostVersion ?? undefined, platform: row.platform ?? undefined } }
function binding(row: BindingRow): AgentBinding { return { ...row, protocolAdapter: row.protocolAdapter as AgentBinding['protocolAdapter'], createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function session(row: SessionRow): AgentRemoteSession { return { ...row, status: row.status as AgentRemoteSession['status'], remoteSessionId: row.remoteSessionId ?? undefined, startedAt: ms(row.startedAt), endedAt: ms(row.endedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function command(row: CommandRow): AgentRunCommand { return { ...row, type: row.type as AgentRunCommand['type'], status: row.status as AgentRunCommand['status'], claimedAt: ms(row.claimedAt), claimExpiresAt: ms(row.claimExpiresAt), acknowledgedAt: ms(row.acknowledgedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function approval(row: ApprovalRow): AgentApprovalRequest { return { ...row, requestedAt: row.requestedAt.getTime(), resolution: row.resolution ?? undefined } }
function sandboxLease(row: SandboxLeaseRow): AgentSandboxLease { return { ...row, status: row.status as AgentSandboxLease['status'], providerReference: row.providerReference ?? undefined, runId: row.runId ?? undefined, reservationId: row.reservationId ?? undefined, reservedUntil: row.reservedUntil.getTime(), runtimeStartedAt: ms(row.runtimeStartedAt), runtimeEndedAt: ms(row.runtimeEndedAt), cleanupAfter: ms(row.cleanupAfter), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function sameResolution(
  left: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
  right: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
) { return left.decision === right.decision && left.resolvedByPrincipalId === right.resolvedByPrincipalId && left.resolvedAt === right.resolvedAt }
