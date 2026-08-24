import 'server-only'

import { and, asc, eq, inArray, lte, max, or, sql } from 'drizzle-orm'
import type { AgentBinding, AgentEnvironment, AgentRemoteSession, AgentRunCommand } from '@overlay/workspace-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  agentBindings, agentEnvironments, agentRemoteSessions, agentRunCommands,
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
const ms = (value: Date | null) => value?.getTime()
const date = (value?: number) => value === undefined ? undefined : new Date(value)
function environment(row: EnvironmentRow): AgentEnvironment { return { ...row, kind: row.kind as AgentEnvironment['kind'], status: row.status as AgentEnvironment['status'], lastSeenAt: ms(row.lastSeenAt), revokedAt: ms(row.revokedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(), publicKey: row.publicKey ?? undefined, hostVersion: row.hostVersion ?? undefined, platform: row.platform ?? undefined } }
function binding(row: BindingRow): AgentBinding { return { ...row, protocolAdapter: row.protocolAdapter as AgentBinding['protocolAdapter'], createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function session(row: SessionRow): AgentRemoteSession { return { ...row, status: row.status as AgentRemoteSession['status'], remoteSessionId: row.remoteSessionId ?? undefined, startedAt: ms(row.startedAt), endedAt: ms(row.endedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function command(row: CommandRow): AgentRunCommand { return { ...row, type: row.type as AgentRunCommand['type'], status: row.status as AgentRunCommand['status'], claimedAt: ms(row.claimedAt), claimExpiresAt: ms(row.claimExpiresAt), acknowledgedAt: ms(row.acknowledgedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
