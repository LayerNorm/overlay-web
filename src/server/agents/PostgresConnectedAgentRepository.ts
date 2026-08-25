import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, max, or, sql } from 'drizzle-orm'
import type {
  AgentApprovalRequest, AgentArtifact, AgentBinding, AgentEnrollmentSession, AgentEnvironment,
  AgentEnvironmentCredential, AgentEnvironmentProofChallenge, AgentRemoteSession,
  AgentRunCommand, AgentSandboxLease,
} from '@overlay/workspace-contracts'
import { MAX_COMMAND_BYTES, MAX_EVENT_BATCH_BYTES } from '@overlay/agent-bridge-protocol'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  agentApprovalRequests, agentArtifacts, agentBindings, agentEnrollmentSessions, agentEnvironmentCredentials,
  agentEnvironmentProofChallenges, agentEnvironmentProofNonces, agentEnvironments, agentEventRateWindows,
  agentRemoteSessions, agentRunCommands, agentRuns, agentSandboxLeases, agentSandboxSettlements, conversationEvents,
  conversationMessages, conversationParticipants, conversations, workspaceMemberships, workspacePrincipals,
} from '@/server/database/postgres/schema'
import {
  projectRemoteAgentEvents, resolveRemoteRequestPart, waitingRemoteAgentParts,
} from '@/shared/agents/remote-agent-transcript'
import { assertValidElicitationResponse } from '@/shared/agents/elicitation-schema'
import type {
  ApplyRemoteEventsResult, ConnectedAgentCreateBinding, ConnectedAgentCreateEnvironment,
  ConnectedAgentCreateSession, ConnectedAgentEnqueueCommand, ConnectedAgentRepository,
  RemoteAgentUsageSettlement,
} from './ConnectedAgentRepository'

const REMOTE_RUN_LEASE_MS = 30 * 60_000

export class PostgresConnectedAgentRepository implements ConnectedAgentRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async createEnrollmentSession(input: AgentEnrollmentSession) {
    const [row] = await this.db.insert(agentEnrollmentSessions).values({
      id: input.id,
      workspaceId: input.workspaceId,
      createdByUserId: input.createdByUserId,
      codeHash: input.codeHash,
      verificationPhrase: input.verificationPhrase,
      status: input.status,
      expiresAt: new Date(input.expiresAt),
      environmentId: input.environmentId,
      redeemedAt: date(input.redeemedAt),
      approvedAt: date(input.approvedAt),
      maxEnvironments: input.maxEnvironments,
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.updatedAt),
    }).returning()
    return enrollment(row)
  }

  async redeemEnrollmentSession(args: Parameters<ConnectedAgentRepository['redeemEnrollmentSession']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(agentEnrollmentSessions)
        .where(eq(agentEnrollmentSessions.codeHash, args.codeHash)).for('update')
      if (!current || current.status !== 'created') return null
      if (current.expiresAt.getTime() <= args.now) {
        await tx.update(agentEnrollmentSessions).set({ status: 'expired', updatedAt: new Date(args.now) })
          .where(eq(agentEnrollmentSessions.id, current.id))
        return null
      }
      if (current.maxEnvironments !== null) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`connected-agent-environments:${current.workspaceId}`}, 0))`)
        const [usage] = await tx.select({ value: sql<number>`count(*)::int` }).from(agentEnvironments).where(and(
          eq(agentEnvironments.workspaceId, current.workspaceId), isNull(agentEnvironments.revokedAt),
        ))
        if (Number(usage?.value ?? 0) >= current.maxEnvironments) {
          throw new Error('CONNECTED_AGENT_POLICY_LIMIT:environments')
        }
      }
      const [environmentRow] = await tx.insert(agentEnvironments).values({
        id: args.environment.id,
        workspaceId: current.workspaceId,
        kind: args.environment.kind,
        name: args.environment.name,
        status: 'pending',
        publicKey: args.environment.publicKey,
        hostVersion: args.environment.hostVersion,
        platform: args.environment.platform,
        capabilities: args.environment.capabilities,
        createdAt: new Date(args.now),
        updatedAt: new Date(args.now),
      }).returning()
      const [challengeRow] = await tx.insert(agentEnvironmentProofChallenges).values({
        id: args.proofChallenge.id,
        workspaceId: current.workspaceId,
        environmentId: args.environment.id,
        challengeHash: args.proofChallenge.challengeHash,
        expiresAt: new Date(args.proofChallenge.expiresAt),
        createdAt: new Date(args.proofChallenge.createdAt),
      }).returning()
      const [enrollmentRow] = await tx.update(agentEnrollmentSessions).set({
        status: 'redeemed',
        environmentId: args.environment.id,
        redeemedAt: new Date(args.now),
        updatedAt: new Date(args.now),
      }).where(eq(agentEnrollmentSessions.id, current.id)).returning()
      return {
        enrollment: enrollment(enrollmentRow),
        environment: environment(environmentRow),
        proofChallenge: proofChallenge(challengeRow),
      }
    })
  }

  async listEnvironments(args: { workspaceId: string }) {
    const rows = await this.db.select().from(agentEnvironments)
      .where(eq(agentEnvironments.workspaceId, args.workspaceId))
      .orderBy(desc(agentEnvironments.createdAt))
    return rows.map(environment)
  }

  async getWorkspacePolicyUsage(args: { workspaceId: string }) {
    const [environmentCount, runCount, artifactTotal] = await Promise.all([
      this.db.select({ value: sql<number>`count(*)::int` }).from(agentEnvironments).where(and(
        eq(agentEnvironments.workspaceId, args.workspaceId), isNull(agentEnvironments.revokedAt),
      )),
      this.db.select({ value: sql<number>`count(*)::int` }).from(agentRemoteSessions).where(and(
        eq(agentRemoteSessions.workspaceId, args.workspaceId),
        inArray(agentRemoteSessions.status, ['starting', 'running', 'waiting_for_approval', 'recovering']),
      )),
      this.db.select({ value: sql<number>`COALESCE(sum(${agentArtifacts.size}), 0)::bigint` })
        .from(agentArtifacts).where(and(
          eq(agentArtifacts.workspaceId, args.workspaceId),
          inArray(agentArtifacts.status, ['pending_upload', 'scanning', 'clean', 'linked']),
          isNull(agentArtifacts.deletedAt),
        )),
    ])
    return {
      activeArtifactBytes: Number(artifactTotal[0]?.value ?? 0),
      activeRuns: Number(runCount[0]?.value ?? 0),
      environments: Number(environmentCount[0]?.value ?? 0),
    }
  }

  async getEnvironment(args: { workspaceId: string; environmentId: string }) {
    const [row] = await this.db.select().from(agentEnvironments).where(and(
      eq(agentEnvironments.id, args.environmentId),
      eq(agentEnvironments.workspaceId, args.workspaceId),
    ))
    return row ? environment(row) : null
  }

  async getEnvironmentEnrollment(args: Parameters<ConnectedAgentRepository['getEnvironmentEnrollment']>[0]) {
    const [row] = await this.db.select({
      environment: agentEnvironments,
      verificationPhrase: agentEnrollmentSessions.verificationPhrase,
      enrollmentExpiresAt: agentEnrollmentSessions.expiresAt,
    }).from(agentEnvironments).innerJoin(agentEnrollmentSessions, and(
      eq(agentEnrollmentSessions.environmentId, agentEnvironments.id),
      eq(agentEnrollmentSessions.workspaceId, agentEnvironments.workspaceId),
    )).where(and(
      eq(agentEnvironments.id, args.environmentId),
      eq(agentEnvironments.workspaceId, args.workspaceId),
    )).orderBy(desc(agentEnrollmentSessions.createdAt)).limit(1)
    return row ? {
      environment: environment(row.environment),
      verificationPhrase: row.verificationPhrase,
      enrollmentExpiresAt: row.enrollmentExpiresAt.getTime(),
    } : null
  }

  async approveEnvironment(args: Parameters<ConnectedAgentRepository['approveEnvironment']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(agentEnvironments).where(and(
        eq(agentEnvironments.id, args.environmentId),
        eq(agentEnvironments.workspaceId, args.workspaceId),
      )).for('update')
      if (!current || current.status !== 'pending') return null
      const [enrollmentRow] = await tx.select().from(agentEnrollmentSessions).where(and(
        eq(agentEnrollmentSessions.environmentId, args.environmentId),
        eq(agentEnrollmentSessions.workspaceId, args.workspaceId),
      )).for('update')
      if (!enrollmentRow || enrollmentRow.status !== 'redeemed' || enrollmentRow.expiresAt.getTime() <= args.now) return null
      const [row] = await tx.update(agentEnvironments).set({
        status: 'offline',
        filesystemGrant: args.filesystemGrant,
        approvedByUserId: args.approvedByUserId,
        approvedAt: new Date(args.now),
        updatedAt: new Date(args.now),
      }).where(eq(agentEnvironments.id, args.environmentId)).returning()
      await tx.update(agentEnrollmentSessions).set({
        status: 'approved', approvedAt: new Date(args.now), updatedAt: new Date(args.now),
      }).where(and(
        eq(agentEnrollmentSessions.environmentId, args.environmentId),
        eq(agentEnrollmentSessions.workspaceId, args.workspaceId),
      ))
      return environment(row)
    })
  }

  async updateEnvironmentFilesystemGrant(args: Parameters<ConnectedAgentRepository['updateEnvironmentFilesystemGrant']>[0]) {
    const [row] = await this.db.update(agentEnvironments).set({
      filesystemGrant: args.filesystemGrant,
      updatedAt: new Date(args.now),
    }).where(and(
      eq(agentEnvironments.id, args.environmentId),
      eq(agentEnvironments.workspaceId, args.workspaceId),
      isNotNull(agentEnvironments.approvedAt),
      sql`${agentEnvironments.status} <> 'pending'`,
      sql`${agentEnvironments.status} <> 'revoked'`,
    )).returning()
    return row ? environment(row) : null
  }

  async getEnvironmentProofChallenge(args: Parameters<ConnectedAgentRepository['getEnvironmentProofChallenge']>[0]) {
    const [row] = await this.db.select({ environment: agentEnvironments, challenge: agentEnvironmentProofChallenges })
      .from(agentEnvironmentProofChallenges)
      .innerJoin(agentEnvironments, eq(agentEnvironments.id, agentEnvironmentProofChallenges.environmentId))
      .where(and(
        eq(agentEnvironmentProofChallenges.environmentId, args.environmentId),
        isNull(agentEnvironmentProofChallenges.consumedAt),
        gt(agentEnvironmentProofChallenges.expiresAt, new Date(args.now)),
        isNull(agentEnvironments.revokedAt),
      )).orderBy(desc(agentEnvironmentProofChallenges.createdAt)).limit(1)
    if (!row || !row.environment.approvedAt || !row.environment.filesystemGrant) return null
    return { environment: environment(row.environment), proofChallenge: proofChallenge(row.challenge) }
  }

  async issueEnvironmentCredential(args: Parameters<ConnectedAgentRepository['issueEnvironmentCredential']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [challenge] = await tx.select().from(agentEnvironmentProofChallenges).where(and(
        eq(agentEnvironmentProofChallenges.id, args.proofChallengeId),
        eq(agentEnvironmentProofChallenges.workspaceId, args.workspaceId),
        eq(agentEnvironmentProofChallenges.environmentId, args.environmentId),
      )).for('update')
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= args.now ||
        challenge.challengeHash !== args.proofChallengeHash) return null
      const [environmentRow] = await tx.select().from(agentEnvironments).where(and(
        eq(agentEnvironments.id, args.environmentId),
        eq(agentEnvironments.workspaceId, args.workspaceId),
      )).for('update')
      if (!environmentRow || environmentRow.status === 'revoked' || !environmentRow.approvedAt || !environmentRow.filesystemGrant) return null
      const [row] = await tx.insert(agentEnvironmentCredentials).values(credentialValues(args.credential)).returning()
      await tx.update(agentEnvironmentProofChallenges).set({ consumedAt: new Date(args.now) })
        .where(eq(agentEnvironmentProofChallenges.id, challenge.id))
      return credential(row)
    })
  }

  async findEnvironmentCredential(args: { tokenHash: string }) {
    const [row] = await this.db.select().from(agentEnvironmentCredentials)
      .where(eq(agentEnvironmentCredentials.tokenHash, args.tokenHash))
    return row ? credential(row) : null
  }

  async consumeEnvironmentProofNonce(args: Parameters<ConnectedAgentRepository['consumeEnvironmentProofNonce']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(agentEnvironmentCredentials).where(
        eq(agentEnvironmentCredentials.id, args.credentialId),
      ).for('update')
      if (!current || current.revokedAt || current.expiresAt.getTime() <= args.now) return false
      const [environmentRow] = await tx.select({ status: agentEnvironments.status, approvedAt: agentEnvironments.approvedAt })
        .from(agentEnvironments).where(and(
          eq(agentEnvironments.id, current.environmentId),
          eq(agentEnvironments.workspaceId, current.workspaceId),
        )).for('update')
      if (!environmentRow || !environmentRow.approvedAt || environmentRow.status === 'pending' || environmentRow.status === 'revoked') return false
      const rows = await tx.insert(agentEnvironmentProofNonces).values({
        id: crypto.randomUUID(),
        credentialId: args.credentialId,
        nonceHash: args.nonceHash,
        expiresAt: new Date(args.expiresAt),
        createdAt: new Date(args.now),
      }).onConflictDoNothing().returning({ id: agentEnvironmentProofNonces.id })
      return rows.length === 1
    })
  }

  async rotateEnvironmentCredential(args: Parameters<ConnectedAgentRepository['rotateEnvironmentCredential']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(agentEnvironmentCredentials)
        .where(eq(agentEnvironmentCredentials.id, args.currentCredentialId)).for('update')
      if (!current || current.revokedAt || current.expiresAt.getTime() <= args.now ||
        current.workspaceId !== args.credential.workspaceId || current.environmentId !== args.credential.environmentId ||
        current.audience !== args.credential.audience || !sameMethods(current.methods, args.credential.methods)) return null
      const [environmentRow] = await tx.select().from(agentEnvironments).where(and(
        eq(agentEnvironments.id, current.environmentId),
        eq(agentEnvironments.workspaceId, current.workspaceId),
      )).for('update')
      if (!environmentRow || !environmentRow.approvedAt || environmentRow.status === 'pending' || environmentRow.status === 'revoked') return null
      await tx.update(agentEnvironmentCredentials).set({ revokedAt: new Date(args.now) })
        .where(eq(agentEnvironmentCredentials.id, current.id))
      const [row] = await tx.insert(agentEnvironmentCredentials).values(credentialValues(args.credential)).returning()
      return credential(row)
    })
  }

  async heartbeatEnvironment(args: Parameters<ConnectedAgentRepository['heartbeatEnvironment']>[0]) {
    const [row] = await this.db.update(agentEnvironments).set({
      status: 'online', lastSeenAt: new Date(args.now), updatedAt: new Date(args.now),
    }).where(and(
      eq(agentEnvironments.id, args.environmentId),
      eq(agentEnvironments.workspaceId, args.workspaceId),
      isNotNull(agentEnvironments.approvedAt),
      sql`${agentEnvironments.status} <> 'pending'`,
      sql`${agentEnvironments.status} <> 'revoked'`,
    )).returning()
    return row ? environment(row) : null
  }

  async updateEnvironmentCapabilities(args: Parameters<ConnectedAgentRepository['updateEnvironmentCapabilities']>[0]) {
    const [row] = await this.db.update(agentEnvironments).set({
      capabilities: args.capabilities,
      lastSeenAt: new Date(args.now),
      updatedAt: new Date(args.now),
    }).where(and(
      eq(agentEnvironments.id, args.environmentId),
      eq(agentEnvironments.workspaceId, args.workspaceId),
      isNotNull(agentEnvironments.approvedAt),
      sql`${agentEnvironments.status} <> 'pending'`,
      sql`${agentEnvironments.status} <> 'revoked'`,
    )).returning()
    return row ? environment(row) : null
  }

  async createEnvironment(input: ConnectedAgentCreateEnvironment) {
    const [row] = await this.db.insert(agentEnvironments).values({
      id: input.id, workspaceId: input.workspaceId, kind: input.kind, name: input.name,
      status: input.status, publicKey: input.publicKey, hostVersion: input.hostVersion,
      platform: input.platform, capabilities: input.capabilities,
      filesystemGrant: input.filesystemGrant,
      approvedAt: date(input.approvedAt), approvedByUserId: input.approvedByUserId,
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

  async upsertBinding(input: ConnectedAgentCreateBinding) {
    await this.requireActiveEnvironment(input.workspaceId, input.environmentId)
    const [agent] = await this.db.select({ id: workspacePrincipals.id }).from(workspacePrincipals).where(and(
      eq(workspacePrincipals.workspaceId, input.workspaceId),
      eq(workspacePrincipals.agentId, input.agentId),
      eq(workspacePrincipals.type, 'agent'),
      isNull(workspacePrincipals.archivedAt),
    )).limit(1)
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    return await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(agentBindings).where(and(
        eq(agentBindings.workspaceId, input.workspaceId),
        eq(agentBindings.agentId, input.agentId),
      )).orderBy(desc(agentBindings.updatedAt)).limit(1).for('update')
      if (existing) {
        const [row] = await tx.update(agentBindings).set({
          environmentId: input.environmentId,
          protocolAdapter: input.protocolAdapter,
          adapterConfig: input.adapterConfig,
          enabled: input.enabled,
          updatedAt: new Date(input.now),
        }).where(eq(agentBindings.id, existing.id)).returning()
        return binding(row)
      }
      const [row] = await tx.insert(agentBindings).values({
        ...input, createdAt: new Date(input.now), updatedAt: new Date(input.now),
      }).returning()
      return binding(row)
    })
  }

  async listBindings(args: { workspaceId: string; agentId?: string }) {
    const rows = await this.db.select().from(agentBindings).where(and(
      eq(agentBindings.workspaceId, args.workspaceId),
      ...(args.agentId ? [eq(agentBindings.agentId, args.agentId)] : []),
    )).orderBy(desc(agentBindings.updatedAt))
    return rows.map(binding)
  }

  async disableBindingsForAgent(args: { workspaceId: string; agentId: string; now: number }) {
    const rows = await this.db.update(agentBindings).set({ enabled: false, updatedAt: new Date(args.now) }).where(and(
      eq(agentBindings.workspaceId, args.workspaceId),
      eq(agentBindings.agentId, args.agentId),
      eq(agentBindings.enabled, true),
    )).returning({ id: agentBindings.id })
    return rows.length > 0
  }

  async findInvocationTarget(args: {
    workspaceId: string
    agentId: string
    now: number
    onlineWithinMs: number
  }) {
    const [row] = await this.db.select({ binding: agentBindings, environment: agentEnvironments })
      .from(agentBindings)
      .innerJoin(agentEnvironments, eq(agentEnvironments.id, agentBindings.environmentId))
      .where(and(
        eq(agentBindings.workspaceId, args.workspaceId),
        eq(agentBindings.agentId, args.agentId),
        eq(agentBindings.enabled, true),
        eq(agentEnvironments.workspaceId, args.workspaceId),
        isNotNull(agentEnvironments.approvedAt),
        isNull(agentEnvironments.revokedAt),
      )).orderBy(desc(agentBindings.updatedAt)).limit(1)
    if (!row) return null
    const targetEnvironment = environment(row.environment)
    const lastSeenAt = targetEnvironment.lastSeenAt ?? 0
    targetEnvironment.status = targetEnvironment.status === 'online'
      && lastSeenAt >= args.now - args.onlineWithinMs ? 'online' : 'offline'
    return { binding: binding(row.binding), environment: targetEnvironment }
  }

  async startRemoteAgentTurn(input: Parameters<ConnectedAgentRepository['startRemoteAgentTurn']>[0]) {
    if (jsonByteLength(input.startPayload) > MAX_COMMAND_BYTES) {
      throw new Error('AGENT_COMMAND_TOO_LARGE')
    }

    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.clientNonce}, 0))`)
      const [actor] = await tx.select({ principalId: workspacePrincipals.id })
        .from(workspacePrincipals)
        .innerJoin(workspaceMemberships, and(
          eq(workspaceMemberships.workspaceId, workspacePrincipals.workspaceId),
          eq(workspaceMemberships.principalId, workspacePrincipals.id),
        ))
        .innerJoin(conversationParticipants, and(
          eq(conversationParticipants.workspaceId, workspacePrincipals.workspaceId),
          eq(conversationParticipants.principalId, workspacePrincipals.id),
        ))
        .where(and(
          eq(workspacePrincipals.workspaceId, input.workspaceId),
          eq(workspacePrincipals.userId, input.actorUserId),
          eq(workspacePrincipals.type, 'human'),
          isNull(workspacePrincipals.archivedAt),
          eq(workspaceMemberships.status, 'active'),
          eq(conversationParticipants.conversationId, input.conversationId),
          eq(conversationParticipants.status, 'active'),
        )).limit(1)
      const [agent] = await tx.select({ principalId: workspacePrincipals.id })
        .from(workspacePrincipals)
        .innerJoin(conversationParticipants, and(
          eq(conversationParticipants.workspaceId, workspacePrincipals.workspaceId),
          eq(conversationParticipants.principalId, workspacePrincipals.id),
        ))
        .where(and(
          eq(workspacePrincipals.id, input.authorPrincipalId),
          eq(workspacePrincipals.workspaceId, input.workspaceId),
          eq(workspacePrincipals.agentId, input.agentId),
          eq(workspacePrincipals.type, 'agent'),
          isNull(workspacePrincipals.archivedAt),
          eq(conversationParticipants.conversationId, input.conversationId),
          eq(conversationParticipants.status, 'active'),
        )).limit(1)
      const [target] = await tx.select({ binding: agentBindings, environment: agentEnvironments })
        .from(agentBindings)
        .innerJoin(agentEnvironments, eq(agentEnvironments.id, agentBindings.environmentId))
        .where(and(
          eq(agentBindings.id, input.bindingId),
          eq(agentBindings.workspaceId, input.workspaceId),
          eq(agentBindings.agentId, input.agentId),
          eq(agentBindings.enabled, true),
          eq(agentEnvironments.id, input.environmentId),
          eq(agentEnvironments.workspaceId, input.workspaceId),
          isNotNull(agentEnvironments.approvedAt),
          isNull(agentEnvironments.revokedAt),
        )).limit(1).for('update')
      const [conversation] = await tx.select({ id: conversations.id }).from(conversations).where(and(
        eq(conversations.id, input.conversationId),
        eq(conversations.workspaceId, input.workspaceId),
        isNull(conversations.deletedAt),
      )).limit(1)
      const [userMessage] = await tx.select({ id: conversationMessages.id }).from(conversationMessages).where(and(
        eq(conversationMessages.id, input.userMessageId),
        eq(conversationMessages.conversationId, input.conversationId),
        eq(conversationMessages.userId, input.actorUserId),
        eq(conversationMessages.role, 'user'),
      )).limit(1)
      if (!actor || actor.principalId !== input.initiatorPrincipalId || !agent || !conversation || !userMessage) {
        throw new Error('CONVERSATION_ACCESS_DENIED')
      }
      if (!target) throw new Error('AGENT_BINDING_UNAVAILABLE')

      const [resumed] = await tx.select({
        messageId: conversationMessages.id,
        runId: agentRuns.id,
        commandId: agentRunCommands.id,
        environmentName: agentEnvironments.name,
        environmentStatus: agentEnvironments.status,
        lastSeenAt: agentEnvironments.lastSeenAt,
      }).from(conversationMessages)
        .innerJoin(agentRuns, eq(agentRuns.assistantMessageId, conversationMessages.id))
        .innerJoin(agentRemoteSessions, eq(agentRemoteSessions.runId, agentRuns.id))
        .innerJoin(agentRunCommands, eq(agentRunCommands.runId, agentRuns.id))
        .innerJoin(agentEnvironments, eq(agentEnvironments.id, agentRuns.environmentId))
        .where(and(
          eq(conversationMessages.conversationId, input.conversationId),
          eq(conversationMessages.clientNonce, input.clientNonce),
        )).limit(1)
      if (resumed) return {
        commandId: resumed.commandId,
        environmentName: resumed.environmentName,
        messageId: resumed.messageId,
        resumed: true,
        runId: resumed.runId,
        waiting: resumed.environmentStatus !== 'online'
          || (resumed.lastSeenAt?.getTime() ?? 0) < input.now - 45_000,
      }

      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`connected-agent-policy:${input.workspaceId}`}, 0))`)
      const [activeRuns] = await tx.select({ value: sql<number>`count(*)::int` }).from(agentRemoteSessions).where(and(
        eq(agentRemoteSessions.workspaceId, input.workspaceId),
        inArray(agentRemoteSessions.status, ['starting', 'running', 'waiting_for_approval', 'recovering']),
      ))
      if (Number(activeRuns?.value ?? 0) >= input.maxConcurrentRuns) {
        throw new Error('CONNECTED_AGENT_POLICY_LIMIT:concurrent_runs')
      }
      if (target.environment.kind === 'overlay_cloud') {
        const [managedEnvironmentRun] = await tx.select({ id: agentRemoteSessions.id }).from(agentRemoteSessions).where(and(
          eq(agentRemoteSessions.environmentId, input.environmentId),
          inArray(agentRemoteSessions.status, ['starting', 'running', 'waiting_for_approval', 'recovering']),
        )).limit(1)
        if (managedEnvironmentRun) throw new Error('CONNECTED_AGENT_POLICY_LIMIT:managed_environment_concurrency')
      }

      const online = target.environment.status === 'online'
        && (target.environment.lastSeenAt?.getTime() ?? 0) >= input.now - 45_000
      const now = new Date(input.now)
      const messageId = `message_${randomUUID()}`
      const waitingParts = waitingRemoteAgentParts({
        environmentName: target.environment.name,
        queueExpiresAt: input.queueExpiresAt,
        runId: input.runId,
      })
      await tx.insert(conversationMessages).values({
        id: messageId,
        conversationId: input.conversationId,
        userId: input.actorUserId,
        turnId: input.turnId,
        role: 'assistant',
        mode: 'act',
        content: online ? '' : `Waiting for ${target.environment.name}`,
        contentType: 'text',
        modelId: input.modelId,
        parts: online ? [] : waitingParts,
        status: 'generating',
        authorKind: 'agent',
        authorPrincipalId: input.authorPrincipalId,
        clientNonce: input.clientNonce,
        threadRootMessageId: input.threadRootMessageId,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(agentRuns).values({
        id: input.runId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        userId: input.actorUserId,
        userMessageId: input.userMessageId,
        assistantMessageId: messageId,
        agentId: input.agentId,
        agentPrincipalId: input.authorPrincipalId,
        initiatorPrincipalId: input.initiatorPrincipalId,
        environmentId: input.environmentId,
        bindingId: input.bindingId,
        mode: 'room',
        runner: 'remote',
        status: 'queued',
        leaseExpiresAt: new Date(Math.min(
          input.now + input.maxRunTimeMs,
          online ? input.now + REMOTE_RUN_LEASE_MS : input.queueExpiresAt,
        )),
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(agentRemoteSessions).values({
        id: input.sessionId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        bindingId: input.bindingId,
        runId: input.runId,
        status: 'starting',
        commandCursor: 0,
        eventCursor: 0,
        capabilitySnapshot: {
          ...target.environment.capabilities,
          billing: {
            reservationId: input.reservationId,
            agentId: input.agentId,
            environmentId: input.environmentId,
            modelId: input.modelId,
            modelUsageBilling: input.modelUsageBilling,
            runId: input.runId,
            userId: input.actorUserId,
            workspaceId: input.workspaceId,
            operationId: `workspace-agent:${input.turnId}`,
          },
          hardExpiresAt: input.now + input.maxRunTimeMs,
          ...(input.sandboxBilling ? { sandboxBilling: input.sandboxBilling } : {}),
          queueExpiresAt: input.queueExpiresAt,
          environmentName: target.environment.name,
          startPayload: input.startPayload,
        },
        createdAt: now,
        updatedAt: now,
      })
      if (input.sandboxBilling?.reservationId) await tx.insert(agentSandboxSettlements).values({
        reservationId: input.sandboxBilling.reservationId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        runId: input.runId,
        leaseId: input.sandboxBilling.leaseId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      const [cursor] = await tx.select({ value: max(agentRunCommands.sequence) })
        .from(agentRunCommands).where(eq(agentRunCommands.environmentId, input.environmentId))
      await tx.insert(agentRunCommands).values({
        id: input.commandId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        runId: input.runId,
        type: 'start',
        sequence: (cursor?.value ?? 0) + 1,
        payload: input.startPayload,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      await tx.update(conversations).set({ lastMode: 'act', lastModified: now, updatedAt: now })
        .where(and(eq(conversations.id, input.conversationId), eq(conversations.workspaceId, input.workspaceId)))
      await tx.insert(conversationEvents).values({
        conversationId: input.conversationId,
        messageId,
        type: 'message.created',
        userId: input.actorUserId,
        createdAt: now,
      })
      return {
        commandId: input.commandId,
        environmentName: target.environment.name,
        messageId,
        resumed: false,
        runId: input.runId,
        waiting: !online,
      }
    })
  }

  async controlRemoteAgentTurn(args: Parameters<ConnectedAgentRepository['controlRemoteAgentTurn']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [actor] = await tx.select({ principalId: workspacePrincipals.id })
        .from(workspacePrincipals)
        .innerJoin(workspaceMemberships, and(
          eq(workspaceMemberships.workspaceId, workspacePrincipals.workspaceId),
          eq(workspaceMemberships.principalId, workspacePrincipals.id),
        ))
        .innerJoin(conversationParticipants, and(
          eq(conversationParticipants.workspaceId, workspacePrincipals.workspaceId),
          eq(conversationParticipants.principalId, workspacePrincipals.id),
        ))
        .where(and(
          eq(workspacePrincipals.workspaceId, args.workspaceId),
          eq(workspacePrincipals.userId, args.actorUserId),
          eq(workspacePrincipals.type, 'human'),
          isNull(workspacePrincipals.archivedAt),
          eq(workspaceMemberships.status, 'active'),
          eq(conversationParticipants.conversationId, args.conversationId),
          eq(conversationParticipants.status, 'active'),
        )).limit(1)
      if (!actor) return { applied: false }
      const [row] = await tx.select({
        run: agentRuns,
        session: agentRemoteSessions,
        environmentName: agentEnvironments.name,
      }).from(agentRuns)
        .innerJoin(agentRemoteSessions, eq(agentRemoteSessions.runId, agentRuns.id))
        .innerJoin(agentEnvironments, eq(agentEnvironments.id, agentRemoteSessions.environmentId))
        .where(and(
          eq(agentRuns.id, args.runId),
          eq(agentRuns.conversationId, args.conversationId),
          eq(agentRuns.runner, 'remote'),
          eq(agentRemoteSessions.workspaceId, args.workspaceId),
        )).limit(1).for('update')
      if (!row) return { applied: false }
      const now = new Date(args.now)
      if (args.action === 'cancel') {
        if (row.run.status === 'cancelled') return { applied: true, messageId: row.run.assistantMessageId }
        if (row.run.status === 'completed') return { applied: false }
        const [existingCancel] = await tx.select({ id: agentRunCommands.id }).from(agentRunCommands).where(and(
          eq(agentRunCommands.runId, row.run.id), eq(agentRunCommands.type, 'cancel'),
          inArray(agentRunCommands.status, ['pending', 'claimed']),
        )).limit(1)
        let commandId = existingCancel?.id
        if (!commandId) {
          const [cursor] = await tx.select({ value: max(agentRunCommands.sequence) }).from(agentRunCommands)
            .where(eq(agentRunCommands.environmentId, row.session.environmentId))
          commandId = `command_${randomUUID()}`
          await tx.insert(agentRunCommands).values({
            id: commandId, workspaceId: args.workspaceId, environmentId: row.session.environmentId,
            runId: row.run.id, type: 'cancel', sequence: (cursor?.value ?? 0) + 1,
            payload: { reason: 'Cancelled from Overlay' }, status: 'pending', createdAt: now, updatedAt: now,
          })
        }
        await tx.update(agentRuns).set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
          .where(eq(agentRuns.id, row.run.id))
        await tx.update(agentRemoteSessions).set({ status: 'cancelled', endedAt: now, updatedAt: now })
          .where(eq(agentRemoteSessions.id, row.session.id))
        await tx.update(agentRunCommands).set({ status: 'cancelled', claimExpiresAt: null, updatedAt: now })
          .where(and(eq(agentRunCommands.runId, row.run.id), inArray(agentRunCommands.status, ['pending', 'claimed']), sql`${agentRunCommands.type} <> 'cancel'`))
        await tx.update(agentApprovalRequests).set({ resolution: {
          decision: 'cancelled', resolvedByPrincipalId: actor.principalId, resolvedAt: args.now,
        } }).where(and(eq(agentApprovalRequests.runId, row.run.id), isNull(agentApprovalRequests.resolution)))
        await tx.update(conversationMessages).set({
          content: 'Cancelled',
          parts: [{ type: 'text', text: 'Cancelled' }, {
            type: 'data-remote-agent-status',
            data: { environmentName: row.environmentName, queueExpiresAt: args.queueExpiresAt, runId: row.run.id, state: 'cancelled' },
          }],
          status: 'completed',
          updatedAt: now,
        }).where(eq(conversationMessages.id, row.run.assistantMessageId))
        await tx.insert(conversationEvents).values({
          conversationId: row.run.conversationId, messageId: row.run.assistantMessageId,
          type: 'message.completed', userId: row.run.userId, createdAt: now,
        })
        return {
          applied: true, commandId, messageId: row.run.assistantMessageId,
          terminal: terminalBilling(row.session.capabilitySnapshot, { input: 0, output: 0 }, 'cancelled'),
        }
      }
      if (args.action === 'retry' && row.run.status === 'queued') {
        await tx.update(agentRuns).set({ leaseExpiresAt: new Date(args.queueExpiresAt), updatedAt: now })
          .where(eq(agentRuns.id, row.run.id))
        await tx.update(agentRunCommands).set({ status: 'pending', claimedAt: null, claimExpiresAt: null, updatedAt: now })
          .where(and(eq(agentRunCommands.runId, row.run.id), sql`${agentRunCommands.status} <> 'acknowledged'`))
        await tx.update(agentRemoteSessions).set({
          capabilitySnapshot: {
            ...(row.session.capabilitySnapshot as Record<string, unknown>),
            queueExpiresAt: args.queueExpiresAt,
          },
          updatedAt: now,
        }).where(eq(agentRemoteSessions.id, row.session.id))
        await tx.update(conversationMessages).set({
          content: `Waiting for ${row.environmentName}`,
          parts: waitingRemoteAgentParts({ environmentName: row.environmentName, queueExpiresAt: args.queueExpiresAt, runId: row.run.id }),
          status: 'generating',
          updatedAt: now,
        }).where(eq(conversationMessages.id, row.run.assistantMessageId))
        await tx.insert(conversationEvents).values({
          conversationId: row.run.conversationId, messageId: row.run.assistantMessageId,
          type: 'message.delta', userId: row.run.userId, createdAt: now,
        })
        return { applied: true, messageId: row.run.assistantMessageId }
      }
      if (!['failed', 'cancelled'].includes(row.run.status)) return { applied: false }
      const snapshot = row.session.capabilitySnapshot as Record<string, unknown>
      const storedStart = snapshot.startPayload && typeof snapshot.startPayload === 'object'
        ? snapshot.startPayload as Record<string, unknown> : null
      const remoteSessionId = row.session.remoteSessionId
      const mode = args.action === 'start_fresh' ? 'start_fresh'
        : args.action === 'resume' ? 'resume'
          : remoteSessionId ? 'resume' : 'start_fresh'
      if (mode === 'resume' && !remoteSessionId) return { applied: false }
      if (mode === 'start_fresh' && !storedStart) return { applied: false }
      const [cursor] = await tx.select({ value: max(agentRunCommands.sequence) }).from(agentRunCommands)
        .where(eq(agentRunCommands.environmentId, row.session.environmentId))
      const commandId = `command_${randomUUID()}`
      await tx.insert(agentRunCommands).values({
        id: commandId, workspaceId: args.workspaceId, environmentId: row.session.environmentId,
        runId: row.run.id, type: mode === 'resume' ? 'reconnect' : 'start',
        sequence: (cursor?.value ?? 0) + 1,
        payload: mode === 'resume'
          ? { remoteSessionId }
          : { ...storedStart, sessionId: undefined, fresh: true },
        status: 'pending', createdAt: now, updatedAt: now,
      })
      await tx.update(agentRuns).set({
        status: 'queued', leaseExpiresAt: new Date(args.queueExpiresAt), failedAt: null,
        cancelledAt: null, terminalError: null, updatedAt: now,
        metrics: { ...(row.run.metrics ?? {}), workflowRetryCount: (row.run.metrics?.workflowRetryCount ?? 0) + 1 },
      }).where(eq(agentRuns.id, row.run.id))
      await tx.update(agentRemoteSessions).set({
        status: 'recovering', endedAt: null,
        capabilitySnapshot: { ...snapshot, queueExpiresAt: args.queueExpiresAt }, updatedAt: now,
      }).where(eq(agentRemoteSessions.id, row.session.id))
      await tx.update(conversationMessages).set({ status: 'generating', updatedAt: now })
        .where(eq(conversationMessages.id, row.run.assistantMessageId))
      await tx.insert(conversationEvents).values({
        conversationId: row.run.conversationId,
        messageId: row.run.assistantMessageId,
        type: 'message.delta', userId: row.run.userId,
        createdAt: now,
      })
      return { applied: true, commandId, messageId: row.run.assistantMessageId }
    })
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

  async getRemoteSessionForRun(args: Parameters<ConnectedAgentRepository['getRemoteSessionForRun']>[0]) {
    const [row] = await this.db.select().from(agentRemoteSessions).where(and(
      eq(agentRemoteSessions.workspaceId, args.workspaceId),
      eq(agentRemoteSessions.environmentId, args.environmentId),
      eq(agentRemoteSessions.runId, args.runId),
    ))
    return row ? session(row) : null
  }

  async enqueueCommand(input: ConnectedAgentEnqueueCommand) {
    if (!input.type || input.type.length > 64 || jsonByteLength(input.payload) > MAX_COMMAND_BYTES) {
      throw new Error('AGENT_COMMAND_TOO_LARGE')
    }
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.environmentId}, 0))`)
      const [environmentRow] = await tx.select({ status: agentEnvironments.status }).from(agentEnvironments).where(and(
        eq(agentEnvironments.id, input.environmentId),
        eq(agentEnvironments.workspaceId, input.workspaceId),
      ))
      if (!environmentRow || environmentRow.status === 'pending' || environmentRow.status === 'revoked') {
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
      const candidates = await tx.select({ id: agentRunCommands.id }).from(agentRunCommands)
        .innerJoin(agentRuns, eq(agentRuns.id, agentRunCommands.runId)).where(and(
        eq(agentRunCommands.workspaceId, args.workspaceId), eq(agentRunCommands.environmentId, args.environmentId),
        or(
          and(
            inArray(agentRuns.status, ['queued', 'running', 'waiting_for_approval']),
            or(isNull(agentRuns.leaseExpiresAt), gt(agentRuns.leaseExpiresAt, new Date(args.now))),
          ),
          eq(agentRunCommands.type, 'cancel'),
        ),
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
      if (args.accepted === false) {
        await tx.update(agentRunCommands).set({
          status: 'cancelled', claimExpiresAt: null, updatedAt: new Date(args.now),
        }).where(eq(agentRunCommands.id, row.id))
        return true
      }
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
        kind: input.kind,
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

  async resolveRemoteRequest(args: Parameters<ConnectedAgentRepository['resolveRemoteRequest']>[0]) {
    return await this.db.transaction(async (tx) => {
      const [actor] = await tx.select({ principalId: workspacePrincipals.id })
        .from(workspacePrincipals)
        .innerJoin(workspaceMemberships, and(
          eq(workspaceMemberships.workspaceId, workspacePrincipals.workspaceId),
          eq(workspaceMemberships.principalId, workspacePrincipals.id),
        ))
        .innerJoin(conversationParticipants, and(
          eq(conversationParticipants.workspaceId, workspacePrincipals.workspaceId),
          eq(conversationParticipants.principalId, workspacePrincipals.id),
        ))
        .where(and(
          eq(workspacePrincipals.workspaceId, args.workspaceId),
          eq(workspacePrincipals.userId, args.actorUserId),
          eq(workspacePrincipals.type, 'human'),
          isNull(workspacePrincipals.archivedAt),
          eq(workspaceMemberships.status, 'active'),
          eq(conversationParticipants.conversationId, args.conversationId),
          eq(conversationParticipants.status, 'active'),
        )).limit(1)
      if (!actor) return { applied: false }
      const [row] = await tx.select({
        request: agentApprovalRequests,
        run: agentRuns,
        session: agentRemoteSessions,
        message: conversationMessages,
      }).from(agentApprovalRequests)
        .innerJoin(agentRuns, eq(agentRuns.id, agentApprovalRequests.runId))
        .innerJoin(agentRemoteSessions, eq(agentRemoteSessions.id, agentApprovalRequests.remoteSessionId))
        .innerJoin(conversationMessages, eq(conversationMessages.id, agentRuns.assistantMessageId))
        .where(and(
          eq(agentApprovalRequests.workspaceId, args.workspaceId),
          eq(agentApprovalRequests.requestKey, args.requestKey),
          eq(agentRuns.id, args.runId),
          eq(agentRuns.conversationId, args.conversationId),
        )).limit(1).for('update')
      if (!row || !['waiting_for_approval', 'running'].includes(row.run.status)) return { applied: false }
      if (row.request.resolution) {
        if (row.request.resolution.decision !== args.decision
          || !sameJson(row.request.resolution.response ?? null, args.response ?? null)) {
          throw new Error('AGENT_REMOTE_REQUEST_ALREADY_RESOLVED')
        }
        const [existing] = await tx.select({ id: agentRunCommands.id }).from(agentRunCommands).where(and(
          eq(agentRunCommands.runId, row.run.id),
          sql`${agentRunCommands.payload}->>'requestKey' = ${args.requestKey}`,
        )).limit(1)
        return { applied: true, commandId: existing?.id, messageId: row.message.id }
      }
      const kind = row.request.kind === 'elicitation' ? 'elicitation' : 'permission'
      if (kind === 'permission' && !row.request.options.includes(args.decision)) throw new Error('AGENT_APPROVAL_OPTION_INVALID')
      if (kind === 'elicitation' && !['accept', 'decline', 'cancel'].includes(args.decision)) throw new Error('AGENT_ELICITATION_ACTION_INVALID')
      if (kind === 'elicitation' && args.decision === 'accept') assertValidElicitationResponse(row.request.payload, args.response)
      const resolution = {
        decision: args.decision,
        ...(args.response ? { response: args.response } : {}),
        resolvedByPrincipalId: actor.principalId,
        resolvedAt: args.now,
      }
      await tx.update(agentApprovalRequests).set({ resolution }).where(eq(agentApprovalRequests.id, row.request.id))
      const [cursor] = await tx.select({ value: max(agentRunCommands.sequence) }).from(agentRunCommands)
        .where(eq(agentRunCommands.environmentId, row.session.environmentId))
      const commandId = `command_${randomUUID()}`
      await tx.insert(agentRunCommands).values({
        id: commandId, workspaceId: args.workspaceId, environmentId: row.session.environmentId,
        runId: row.run.id, type: kind === 'permission' ? 'approval_response' : 'elicitation_response',
        sequence: (cursor?.value ?? 0) + 1,
        payload: kind === 'permission'
          ? { requestKey: args.requestKey, optionId: args.decision }
          : { requestKey: args.requestKey, action: args.decision, ...(args.response ? { content: args.response } : {}) },
        status: 'pending', createdAt: new Date(args.now), updatedAt: new Date(args.now),
      })
      await tx.update(agentRuns).set({ status: 'running', approval: null, updatedAt: new Date(args.now) })
        .where(eq(agentRuns.id, row.run.id))
      await tx.update(agentRemoteSessions).set({ status: 'running', updatedAt: new Date(args.now) })
        .where(eq(agentRemoteSessions.id, row.session.id))
      await tx.update(conversationMessages).set({
        parts: resolveRemoteRequestPart(
          Array.isArray(row.message.parts) ? row.message.parts as Array<Record<string, unknown>> : [],
          args.requestKey,
          resolution,
        ),
        status: 'generating', updatedAt: new Date(args.now),
      }).where(eq(conversationMessages.id, row.message.id))
      await tx.insert(conversationEvents).values({
        conversationId: row.run.conversationId, messageId: row.message.id,
        type: 'message.delta', userId: row.run.userId, createdAt: new Date(args.now),
      })
      return { applied: true, commandId, messageId: row.message.id }
    })
  }

  async createArtifact(input: Parameters<ConnectedAgentRepository['createArtifact']>[0]) {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`connected-agent-artifacts:${input.workspaceId}`}, 0))`)
      const [sessionRow] = await tx.select({ id: agentRemoteSessions.id }).from(agentRemoteSessions).where(and(
        eq(agentRemoteSessions.id, input.remoteSessionId), eq(agentRemoteSessions.workspaceId, input.workspaceId),
        eq(agentRemoteSessions.environmentId, input.environmentId), eq(agentRemoteSessions.runId, input.runId),
      ))
      if (!sessionRow) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
      if (input.maxWorkspaceArtifactBytes !== undefined) {
        const [total] = await tx.select({ value: sql<number>`COALESCE(sum(${agentArtifacts.size}), 0)::bigint` })
          .from(agentArtifacts).where(and(
            eq(agentArtifacts.workspaceId, input.workspaceId),
            inArray(agentArtifacts.status, ['pending_upload', 'scanning', 'clean', 'linked']),
            isNull(agentArtifacts.deletedAt),
          ))
        if (Number(total?.value ?? 0) + input.size > input.maxWorkspaceArtifactBytes) {
          throw new Error('CONNECTED_AGENT_POLICY_LIMIT:artifact_bytes')
        }
      }
      const [row] = await tx.insert(agentArtifacts).values({
        id: input.id, workspaceId: input.workspaceId, environmentId: input.environmentId,
        runId: input.runId, remoteSessionId: input.remoteSessionId, name: input.name,
        mediaType: input.mediaType, size: input.size, sha256: input.sha256, objectKey: input.objectKey,
        status: input.status, scanResult: input.scanResult, expiresAt: new Date(input.expiresAt),
        linkedAt: date(input.linkedAt), deletedAt: date(input.deletedAt),
        createdAt: new Date(input.createdAt), updatedAt: new Date(input.updatedAt),
      }).returning()
      return artifact(row)
    })
  }

  async getArtifact(args: Parameters<ConnectedAgentRepository['getArtifact']>[0]) {
    const [row] = await this.db.select().from(agentArtifacts).where(and(
      eq(agentArtifacts.id, args.artifactId), eq(agentArtifacts.workspaceId, args.workspaceId),
      eq(agentArtifacts.environmentId, args.environmentId),
    ))
    return row ? artifact(row) : null
  }

  async getArtifactForDownload(args: Parameters<ConnectedAgentRepository['getArtifactForDownload']>[0]) {
    const [row] = await this.db.select({ artifact: agentArtifacts }).from(agentArtifacts)
      .innerJoin(agentRuns, eq(agentRuns.id, agentArtifacts.runId))
      .innerJoin(workspacePrincipals, and(
        eq(workspacePrincipals.workspaceId, agentArtifacts.workspaceId),
        eq(workspacePrincipals.userId, args.actorUserId),
        eq(workspacePrincipals.type, 'human'),
      ))
      .innerJoin(workspaceMemberships, and(
        eq(workspaceMemberships.workspaceId, agentArtifacts.workspaceId),
        eq(workspaceMemberships.principalId, workspacePrincipals.id),
        eq(workspaceMemberships.status, 'active'),
      ))
      .innerJoin(conversationParticipants, and(
        eq(conversationParticipants.conversationId, agentRuns.conversationId),
        eq(conversationParticipants.principalId, workspacePrincipals.id),
        eq(conversationParticipants.status, 'active'),
      ))
      .where(and(
        eq(agentArtifacts.id, args.artifactId), eq(agentArtifacts.workspaceId, args.workspaceId),
        inArray(agentArtifacts.status, ['clean', 'linked']), isNull(agentArtifacts.deletedAt),
        isNull(workspacePrincipals.archivedAt),
      )).limit(1)
    return row ? artifact(row.artifact) : null
  }

  async finalizeArtifact(args: Parameters<ConnectedAgentRepository['finalizeArtifact']>[0]) {
    const [row] = await this.db.update(agentArtifacts).set({
      status: args.status, scanResult: args.scanResult,
      ...(args.expiresAt === undefined ? {} : { expiresAt: new Date(args.expiresAt) }),
      updatedAt: new Date(args.now),
    }).where(and(
      eq(agentArtifacts.id, args.artifactId), eq(agentArtifacts.workspaceId, args.workspaceId),
      eq(agentArtifacts.environmentId, args.environmentId), inArray(agentArtifacts.status, ['pending_upload', 'scanning']),
    )).returning()
    return row ? artifact(row) : null
  }

  async listArtifactsForCleanup(args: Parameters<ConnectedAgentRepository['listArtifactsForCleanup']>[0]) {
    const rows = await this.db.select().from(agentArtifacts).where(and(
      lte(agentArtifacts.expiresAt, new Date(args.now)),
      inArray(agentArtifacts.status, ['pending_upload', 'clean', 'rejected', 'linked']),
    )).orderBy(asc(agentArtifacts.expiresAt)).limit(args.limit)
    return rows.map(artifact)
  }

  async markArtifactDeleted(args: Parameters<ConnectedAgentRepository['markArtifactDeleted']>[0]) {
    const rows = await this.db.update(agentArtifacts).set({
      status: 'deleted', deletedAt: new Date(args.now), updatedAt: new Date(args.now),
    }).where(and(eq(agentArtifacts.id, args.artifactId), sql`${agentArtifacts.status} <> 'deleted'`))
      .returning({ id: agentArtifacts.id })
    return rows.length === 1
  }

  async sweepRemoteRuns(args: Parameters<ConnectedAgentRepository['sweepRemoteRuns']>[0]) {
    return await this.db.transaction(async (tx) => {
      const rows = await tx.select({ run: agentRuns, session: agentRemoteSessions, environment: agentEnvironments, message: conversationMessages })
        .from(agentRuns)
        .innerJoin(agentRemoteSessions, eq(agentRemoteSessions.runId, agentRuns.id))
        .innerJoin(agentEnvironments, eq(agentEnvironments.id, agentRemoteSessions.environmentId))
        .innerJoin(conversationMessages, eq(conversationMessages.id, agentRuns.assistantMessageId))
        .where(and(
          eq(agentRuns.runner, 'remote'), inArray(agentRuns.status, ['queued', 'running', 'waiting_for_approval']),
          or(lte(agentRuns.leaseExpiresAt, new Date(args.now)), lte(agentEnvironments.lastSeenAt, new Date(args.hostOfflineBefore))),
        )).limit(args.limit).for('update')
      const settlements = []
      const alerts: import('./ConnectedAgentRepository').ConnectedAgentOperationalAlert[] = []
      for (const row of rows) {
        const offline = (row.environment.lastSeenAt?.getTime() ?? 0) <= args.hostOfflineBefore
        const code = offline ? 'remote_host_offline' : 'remote_run_timeout'
        const message = offline ? 'The connected environment disappeared.' : 'The connected agent run timed out.'
        const now = new Date(args.now)
        await tx.update(agentRuns).set({ status: 'failed', failedAt: now, terminalError: { code, message, retryable: true }, updatedAt: now })
          .where(eq(agentRuns.id, row.run.id))
        await tx.update(agentRemoteSessions).set({ status: 'failed', endedAt: now, updatedAt: now })
          .where(eq(agentRemoteSessions.id, row.session.id))
        await tx.update(conversationMessages).set({
          content: row.message.content || message,
          parts: recoveryParts(row.message.parts, row.run.id, row.environment.name, code, message, args.now),
          status: 'error', updatedAt: now,
        }).where(eq(conversationMessages.id, row.message.id))
        await tx.update(agentRunCommands).set({ status: 'cancelled', claimExpiresAt: null, updatedAt: now })
          .where(and(eq(agentRunCommands.runId, row.run.id), inArray(agentRunCommands.status, ['pending', 'claimed'])))
        await tx.update(agentApprovalRequests).set({ resolution: {
          decision: code, resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt: args.now,
        } }).where(and(eq(agentApprovalRequests.runId, row.run.id), isNull(agentApprovalRequests.resolution)))
        await tx.insert(conversationEvents).values({
          conversationId: row.run.conversationId, messageId: row.message.id,
          type: 'message.failed', userId: row.run.userId, createdAt: now,
        })
        settlements.push(terminalBilling(row.session.capabilitySnapshot, row.message.tokens, 'timeout'))
        const settlement = settlements.at(-1)!
        alerts.push({
          code: offline ? 'offline_environment' : 'lease_expired',
          workspaceId: row.session.workspaceId,
          agentId: settlement.agentId || row.run.agentId || undefined,
          environmentId: row.session.environmentId,
          runId: row.run.id,
          remoteSessionId: row.session.id,
          reservationId: settlement.reservationId ?? undefined,
          eventCursor: row.session.eventCursor,
        })
      }
      const offlineEnvironments = await tx.select({
        environmentId: agentEnvironments.id,
        workspaceId: agentEnvironments.workspaceId,
        lastSeenAt: agentEnvironments.lastSeenAt,
      }).from(agentEnvironments).where(and(
        isNotNull(agentEnvironments.approvedAt),
        isNull(agentEnvironments.revokedAt),
        or(eq(agentEnvironments.status, 'offline'), lte(agentEnvironments.lastSeenAt, new Date(args.hostOfflineBefore))),
      )).limit(args.limit)
      const alertedEnvironments = new Set(alerts.map((alert) => alert.environmentId).filter(Boolean))
      alerts.push(...offlineEnvironments.filter(environment => !alertedEnvironments.has(environment.environmentId)).map(environment => ({
        code: 'offline_environment' as const,
        workspaceId: environment.workspaceId,
        environmentId: environment.environmentId,
        ageMs: environment.lastSeenAt ? args.now - environment.lastSeenAt.getTime() : undefined,
      })))
      const oldCommands = await tx.select({
        commandId: agentRunCommands.id,
        environmentId: agentRunCommands.environmentId,
        runId: agentRunCommands.runId,
        workspaceId: agentRunCommands.workspaceId,
        updatedAt: agentRunCommands.updatedAt,
      }).from(agentRunCommands).where(and(
        inArray(agentRunCommands.status, ['pending', 'claimed']),
        lte(agentRunCommands.updatedAt, new Date(args.now - 2 * 60_000)),
      )).limit(args.limit)
      alerts.push(...oldCommands.map((command) => ({
        code: 'stuck_command' as const,
        workspaceId: command.workspaceId,
        environmentId: command.environmentId,
        runId: command.runId,
        commandId: command.commandId,
        ageMs: args.now - command.updatedAt.getTime(),
      })))
      const oldApprovals = await tx.select({
        approvalId: agentApprovalRequests.id,
        workspaceId: agentApprovalRequests.workspaceId,
        runId: agentApprovalRequests.runId,
        remoteSessionId: agentApprovalRequests.remoteSessionId,
        requestedAt: agentApprovalRequests.requestedAt,
        environmentId: agentRemoteSessions.environmentId,
        eventCursor: agentRemoteSessions.eventCursor,
      }).from(agentApprovalRequests).innerJoin(
        agentRemoteSessions, eq(agentRemoteSessions.id, agentApprovalRequests.remoteSessionId),
      ).where(and(
        isNull(agentApprovalRequests.resolution),
        lte(agentApprovalRequests.requestedAt, new Date(args.now - 15 * 60_000)),
      )).limit(args.limit)
      alerts.push(...oldApprovals.map((approval) => ({
        code: 'approval_age' as const,
        workspaceId: approval.workspaceId,
        environmentId: approval.environmentId,
        runId: approval.runId,
        remoteSessionId: approval.remoteSessionId,
        eventCursor: approval.eventCursor,
        ageMs: args.now - approval.requestedAt.getTime(),
      })))
      const failedCleanups = await tx.select().from(agentSandboxLeases).where(
        eq(agentSandboxLeases.status, 'cleanup_failed'),
      ).limit(args.limit)
      alerts.push(...failedCleanups.map((lease) => ({
        code: 'cleanup_failure' as const,
        workspaceId: lease.workspaceId,
        environmentId: lease.environmentId,
        runId: lease.runId ?? undefined,
        providerReference: lease.providerReference ?? undefined,
        reservationId: lease.reservationId ?? undefined,
        ageMs: args.now - lease.updatedAt.getTime(),
      })))
      return { alerts, expiredRunIds: rows.map((row) => row.run.id), settlements }
    })
  }

  async listPendingSandboxSettlements(args: { limit: number }) {
    const rows = await this.db.select({ session: agentRemoteSessions, tokens: conversationMessages.tokens })
      .from(agentSandboxSettlements)
      .innerJoin(agentRemoteSessions, eq(agentRemoteSessions.runId, agentSandboxSettlements.runId))
      .innerJoin(agentRuns, eq(agentRuns.id, agentSandboxSettlements.runId))
      .innerJoin(conversationMessages, eq(conversationMessages.id, agentRuns.assistantMessageId))
      .where(and(
        eq(agentSandboxSettlements.status, 'pending'),
        inArray(agentRemoteSessions.status, ['completed', 'failed', 'cancelled']),
      ))
      .orderBy(asc(agentSandboxSettlements.updatedAt))
      .limit(args.limit)
    return rows.map((row): RemoteAgentUsageSettlement => terminalBilling(
      row.session.capabilitySnapshot, row.tokens, terminalOutcome(row.session.status),
    ))
  }

  async markSandboxSettlementComplete(args: { workspaceId: string; reservationId: string; settledAt: number }) {
    const rows = await this.db.update(agentSandboxSettlements).set({
      status: 'settled', settledAt: new Date(args.settledAt), updatedAt: new Date(args.settledAt),
    }).where(and(
      eq(agentSandboxSettlements.reservationId, args.reservationId),
      eq(agentSandboxSettlements.workspaceId, args.workspaceId),
      eq(agentSandboxSettlements.status, 'pending'),
    )).returning({ reservationId: agentSandboxSettlements.reservationId })
    if (rows.length === 1) return true
    const [existing] = await this.db.select({ status: agentSandboxSettlements.status }).from(agentSandboxSettlements).where(and(
      eq(agentSandboxSettlements.reservationId, args.reservationId),
      eq(agentSandboxSettlements.workspaceId, args.workspaceId),
    )).limit(1)
    return existing?.status === 'settled'
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

  async getActiveSandboxLease(args: { workspaceId: string; environmentId: string }) {
    const [row] = await this.db.select().from(agentSandboxLeases).where(and(
      eq(agentSandboxLeases.workspaceId, args.workspaceId),
      eq(agentSandboxLeases.environmentId, args.environmentId),
      inArray(agentSandboxLeases.status, ['reserved', 'provisioning', 'running']),
    )).orderBy(desc(agentSandboxLeases.updatedAt)).limit(1)
    return row ? sandboxLease(row) : null
  }

  async applyRemoteEvents(args: Parameters<ConnectedAgentRepository['applyRemoteEvents']>[0]): Promise<ApplyRemoteEventsResult> {
    return await this.db.transaction(async (tx) => {
      const [environmentRow] = await tx.select({ status: agentEnvironments.status }).from(agentEnvironments).where(and(
        eq(agentEnvironments.id, args.environmentId), eq(agentEnvironments.workspaceId, args.workspaceId),
      )).for('update')
      if (!environmentRow || environmentRow.status === 'pending' || environmentRow.status === 'revoked') {
        throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
      }
      const [current] = await tx.select().from(agentRemoteSessions).where(and(
        eq(agentRemoteSessions.id, args.sessionId), eq(agentRemoteSessions.workspaceId, args.workspaceId),
        eq(agentRemoteSessions.environmentId, args.environmentId),
      )).for('update')
      if (!current) throw new Error('AGENT_REMOTE_SESSION_NOT_FOUND')
      const [runRow] = await tx.select().from(agentRuns).where(eq(agentRuns.id, current.runId)).for('update')
      if (!runRow || runRow.runner !== 'remote' || runRow.environmentId !== args.environmentId) {
        throw new Error('AGENT_REMOTE_RUN_NOT_FOUND')
      }
      const [messageRow] = await tx.select().from(conversationMessages)
        .where(eq(conversationMessages.id, runRow.assistantMessageId)).for('update')
      if (!messageRow) throw new Error('AGENT_REMOTE_MESSAGE_NOT_FOUND')
      const duplicateResult = () => ({
        accepted: true as const,
        acknowledgedSequence: current.eventCursor,
        duplicate: true,
        ...(['completed', 'failed', 'cancelled'].includes(runRow.status)
          ? { terminal: terminalBilling(current.capabilitySnapshot, messageRow.tokens, terminalOutcome(runRow.status)) }
          : {}),
      })
      if (args.events.length === 0) return duplicateResult()
      if (args.events.length > 100 || jsonByteLength(args.events) > MAX_EVENT_BATCH_BYTES) {
        throw new Error('AGENT_EVENT_BATCH_TOO_LARGE')
      }
      if (args.events.some((event) => event.protocolVersion !== 1) ||
        new Set(args.events.map((event) => event.eventId)).size !== args.events.length) {
        throw new Error('AGENT_EVENT_BATCH_INVALID')
      }
      const sequences = args.events.map((event) => event.sourceSequence)
      const first = sequences[0]!
      if (sequences.some((value, index) => value !== first + index)) throw new Error('AGENT_EVENT_BATCH_NOT_CONTIGUOUS')
      if (args.events.some((event) => event.environmentId !== args.environmentId || event.runId !== current.runId)) {
        throw new Error('AGENT_EVENT_SCOPE_MISMATCH')
      }
      if (sequences.at(-1)! <= current.eventCursor) {
        return duplicateResult()
      }
      const expected = current.eventCursor + 1
      if (first !== expected) return { accepted: false, expectedSequence: expected }
      if (args.maxEventsPerMinute !== undefined) {
        const windowStartedAt = new Date(Math.floor(args.now / 60_000) * 60_000)
        const [window] = await tx.insert(agentEventRateWindows).values({
          environmentId: args.environmentId,
          windowStartedAt,
          eventCount: args.events.length,
          workspaceId: args.workspaceId,
          updatedAt: new Date(args.now),
        }).onConflictDoUpdate({
          target: [agentEventRateWindows.environmentId, agentEventRateWindows.windowStartedAt],
          set: {
            eventCount: sql`${agentEventRateWindows.eventCount} + ${args.events.length}`,
            updatedAt: new Date(args.now),
          },
        }).returning({ eventCount: agentEventRateWindows.eventCount })
        if ((window?.eventCount ?? 0) > args.maxEventsPerMinute) {
          throw new Error('CONNECTED_AGENT_POLICY_LIMIT:event_rate')
        }
      }
      if (['completed', 'failed', 'cancelled'].includes(runRow.status)) {
        if (!isCompatibleTerminalAcknowledgement(runRow.status, args.events)) throw new Error('AGENT_RUN_TERMINAL')
        await tx.update(agentRemoteSessions).set({ eventCursor: sequences.at(-1)!, updatedAt: new Date(args.now) })
          .where(eq(agentRemoteSessions.id, current.id))
        return { accepted: true, acknowledgedSequence: sequences.at(-1)!, duplicate: false,
          terminal: terminalBilling(current.capabilitySnapshot, messageRow.tokens, terminalOutcome(runRow.status)) }
      }

      const snapshot = current.capabilitySnapshot as Record<string, unknown>
      const normalizedEvents: typeof args.events = []
      for (const event of args.events) {
        if (event.type === 'approval_requested' || event.type === 'elicitation_requested') {
          const requestKey = typeof event.payload.requestKey === 'string' ? event.payload.requestKey : ''
          if (!requestKey) throw new Error('AGENT_REMOTE_REQUEST_INVALID')
          const options = event.type === 'approval_requested' && Array.isArray(event.payload.options)
            ? event.payload.options.map((option) => option && typeof option === 'object'
              ? String((option as Record<string, unknown>).id ?? '') : '').filter(Boolean)
            : ['accept', 'decline', 'cancel']
          if (options.length === 0) throw new Error('AGENT_REMOTE_REQUEST_INVALID')
          await tx.insert(agentApprovalRequests).values({
            id: `approval_${randomUUID()}`, workspaceId: args.workspaceId, runId: runRow.id,
            remoteSessionId: current.id, requestKey,
            kind: event.type === 'approval_requested' ? 'permission' : 'elicitation',
            prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'Agent request',
            options, payload: event.payload, requestedAt: new Date(event.occurredAt),
          }).onConflictDoNothing()
        }
        if (event.type === 'artifact') {
          const reference = typeof event.payload.uploadReference === 'string' ? event.payload.uploadReference : ''
          const [artifactRow] = await tx.select().from(agentArtifacts).where(and(
            eq(agentArtifacts.id, reference), eq(agentArtifacts.workspaceId, args.workspaceId),
            eq(agentArtifacts.environmentId, args.environmentId), eq(agentArtifacts.runId, runRow.id),
            eq(agentArtifacts.remoteSessionId, current.id), inArray(agentArtifacts.status, ['clean', 'linked']),
          )).limit(1).for('update')
          if (!artifactRow || artifactRow.name !== event.payload.name || artifactRow.mediaType !== event.payload.mediaType
            || artifactRow.size !== event.payload.size || artifactRow.sha256 !== event.payload.sha256) {
            throw new Error('AGENT_ARTIFACT_NOT_VALIDATED')
          }
          if (artifactRow.status !== 'linked') {
            await tx.update(agentArtifacts).set({ status: 'linked', linkedAt: new Date(args.now), updatedAt: new Date(args.now) })
              .where(eq(agentArtifacts.id, artifactRow.id))
          }
          normalizedEvents.push({ ...event, payload: {
            ...event.payload, url: `/api/v1/conversations/run/remote/artifacts/${artifactRow.id}`,
          } })
          continue
        }
        normalizedEvents.push(event)
      }
      const projection = projectRemoteAgentEvents({
        content: messageRow.content,
        parts: Array.isArray(messageRow.parts) ? messageRow.parts as Array<Record<string, unknown>> : [],
        events: normalizedEvents,
        environmentName: typeof snapshot.environmentName === 'string' ? snapshot.environmentName : 'connected environment',
        queueExpiresAt: typeof snapshot.queueExpiresAt === 'number' ? snapshot.queueExpiresAt : args.now,
        runId: runRow.id,
      })
      const now = new Date(args.now)
      await tx.update(agentRemoteSessions).set({
        eventCursor: sequences.at(-1)!,
        status: projection.sessionStatus,
        ...(projection.remoteSessionId ? { remoteSessionId: projection.remoteSessionId } : {}),
        ...(!current.startedAt ? { startedAt: now } : {}),
        ...(projection.terminal ? { endedAt: now } : {}),
        updatedAt: now,
      }).where(eq(agentRemoteSessions.id, args.sessionId))
      await tx.update(agentRuns).set({
        status: projection.runStatus,
        ...(projection.remoteSessionId ? { remoteSessionId: projection.remoteSessionId } : {}),
        ...(!runRow.startedAt ? { startedAt: now } : {}),
        ...(projection.runStatus === 'completed' ? { completedAt: now } : {}),
        ...(projection.runStatus === 'failed' ? { failedAt: now, terminalError: projection.terminalError } : {}),
        ...(projection.runStatus === 'cancelled' ? { cancelledAt: now } : {}),
        ...(projection.terminal ? { metrics: { ...(runRow.metrics ?? {}), inputTokens: projection.tokens.input, outputTokens: projection.tokens.output } } : {}),
        ...(!projection.terminal ? { leaseExpiresAt: new Date(Math.min(
          args.now + REMOTE_RUN_LEASE_MS,
          typeof snapshot.hardExpiresAt === 'number' ? snapshot.hardExpiresAt : args.now + REMOTE_RUN_LEASE_MS,
        )) } : {}),
        updatedAt: now,
      }).where(eq(agentRuns.id, runRow.id))
      await tx.update(conversationMessages).set({
        content: projection.content,
        parts: projection.parts,
        ...(projection.terminal ? { tokens: projection.tokens } : {}),
        status: projection.runStatus === 'failed' ? 'error' : projection.terminal ? 'completed' : 'generating',
        updatedAt: now,
      }).where(eq(conversationMessages.id, messageRow.id))
      await tx.update(conversations).set({ lastModified: now, updatedAt: now })
        .where(eq(conversations.id, runRow.conversationId))
      await tx.insert(conversationEvents).values({
        conversationId: runRow.conversationId,
        messageId: messageRow.id,
        type: projection.runStatus === 'failed'
          ? 'message.failed'
          : projection.terminal ? 'message.completed' : 'message.delta',
        userId: runRow.userId,
        createdAt: now,
      })
      if (projection.terminal) {
        await tx.update(agentApprovalRequests).set({ resolution: {
          decision: projection.runStatus === 'cancelled' ? 'cancelled' : projection.runStatus === 'failed' ? 'run_failed' : 'run_completed',
          resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt: args.now,
        } }).where(and(eq(agentApprovalRequests.runId, runRow.id), isNull(agentApprovalRequests.resolution)))
        await tx.update(agentRunCommands).set({
          status: 'acknowledged',
          acknowledgedAt: sql`COALESCE(${agentRunCommands.acknowledgedAt}, ${now})`,
          claimExpiresAt: null,
          updatedAt: now,
        }).where(and(eq(agentRunCommands.runId, runRow.id), sql`${agentRunCommands.status} <> 'cancelled'`))
      }
      return {
        accepted: true,
        acknowledgedSequence: sequences.at(-1)!,
        duplicate: false,
        ...(projection.terminal ? { terminal: terminalBilling(current.capabilitySnapshot, projection.tokens, terminalOutcome(projection.runStatus)) } : {}),
      }
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
      await tx.update(agentEnvironmentCredentials).set({ revokedAt: new Date(args.now) }).where(and(
        eq(agentEnvironmentCredentials.environmentId, args.environmentId),
        isNull(agentEnvironmentCredentials.revokedAt),
      ))
      await tx.update(agentSandboxLeases).set({
        status: 'stopping', reservedUntil: new Date(args.now), cleanupAfter: new Date(args.now),
        updatedAt: new Date(args.now),
      }).where(and(
        eq(agentSandboxLeases.environmentId, args.environmentId),
        inArray(agentSandboxLeases.status, ['reserved', 'provisioning', 'running']),
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
type ArtifactRow = typeof agentArtifacts.$inferSelect
type SandboxLeaseRow = typeof agentSandboxLeases.$inferSelect
type EnrollmentRow = typeof agentEnrollmentSessions.$inferSelect
type ProofChallengeRow = typeof agentEnvironmentProofChallenges.$inferSelect
type CredentialRow = typeof agentEnvironmentCredentials.$inferSelect
const ms = (value: Date | null) => value?.getTime()
const date = (value?: number) => value === undefined ? undefined : new Date(value)
function environment(row: EnvironmentRow): AgentEnvironment { return { ...row, kind: row.kind as AgentEnvironment['kind'], status: row.status as AgentEnvironment['status'], filesystemGrant: row.filesystemGrant ?? undefined, approvedAt: ms(row.approvedAt), approvedByUserId: row.approvedByUserId ?? undefined, lastSeenAt: ms(row.lastSeenAt), revokedAt: ms(row.revokedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(), publicKey: row.publicKey ?? undefined, hostVersion: row.hostVersion ?? undefined, platform: row.platform ?? undefined } }
function binding(row: BindingRow): AgentBinding { return { ...row, protocolAdapter: row.protocolAdapter as AgentBinding['protocolAdapter'], createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function session(row: SessionRow): AgentRemoteSession { return { ...row, status: row.status as AgentRemoteSession['status'], remoteSessionId: row.remoteSessionId ?? undefined, startedAt: ms(row.startedAt), endedAt: ms(row.endedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function command(row: CommandRow): AgentRunCommand { return { ...row, type: row.type as AgentRunCommand['type'], status: row.status as AgentRunCommand['status'], claimedAt: ms(row.claimedAt), claimExpiresAt: ms(row.claimExpiresAt), acknowledgedAt: ms(row.acknowledgedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function approval(row: ApprovalRow): AgentApprovalRequest { return { ...row, kind: row.kind === 'elicitation' ? 'elicitation' : 'permission', requestedAt: row.requestedAt.getTime(), resolution: row.resolution ?? undefined } }
function artifact(row: ArtifactRow): AgentArtifact { return { ...row, status: row.status as AgentArtifact['status'], scanResult: row.scanResult ?? undefined, expiresAt: row.expiresAt.getTime(), linkedAt: ms(row.linkedAt), deletedAt: ms(row.deletedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function sandboxLease(row: SandboxLeaseRow): AgentSandboxLease { return { ...row, status: row.status as AgentSandboxLease['status'], providerReference: row.providerReference ?? undefined, runId: row.runId ?? undefined, reservationId: row.reservationId ?? undefined, reservedUntil: row.reservedUntil.getTime(), runtimeStartedAt: ms(row.runtimeStartedAt), runtimeEndedAt: ms(row.runtimeEndedAt), cleanupAfter: ms(row.cleanupAfter), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function sameResolution(
  left: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
  right: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
) { return left.decision === right.decision && left.resolvedByPrincipalId === right.resolvedByPrincipalId && left.resolvedAt === right.resolvedAt }
function enrollment(row: EnrollmentRow): AgentEnrollmentSession { return { ...row, status: row.status as AgentEnrollmentSession['status'], environmentId: row.environmentId ?? undefined, expiresAt: row.expiresAt.getTime(), redeemedAt: ms(row.redeemedAt), approvedAt: ms(row.approvedAt), maxEnvironments: row.maxEnvironments ?? undefined, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function proofChallenge(row: ProofChallengeRow): AgentEnvironmentProofChallenge { return { ...row, expiresAt: row.expiresAt.getTime(), consumedAt: ms(row.consumedAt), createdAt: row.createdAt.getTime() } }
function credential(row: CredentialRow): AgentEnvironmentCredential { return { ...row, audience: row.audience as AgentEnvironmentCredential['audience'], methods: row.methods as AgentEnvironmentCredential['methods'], expiresAt: row.expiresAt.getTime(), revokedAt: ms(row.revokedAt), createdAt: row.createdAt.getTime() } }
function credentialValues(value: AgentEnvironmentCredential): typeof agentEnvironmentCredentials.$inferInsert { return { id: value.id, workspaceId: value.workspaceId, environmentId: value.environmentId, tokenHash: value.tokenHash, audience: value.audience, methods: value.methods, tokenNonce: value.tokenNonce, expiresAt: new Date(value.expiresAt), revokedAt: date(value.revokedAt), createdAt: new Date(value.createdAt) } }
function sameMethods(left: string[], right: string[]) { return left.length === right.length && left.every((method) => right.includes(method)) }
function jsonByteLength(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength }
function sameJson(left: unknown, right: unknown) { return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right)) }
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortJson(item)]))
}
function terminalBilling(snapshotValue: unknown, tokensValue: unknown, outcome: 'completed' | 'failed' | 'cancelled' | 'timeout') {
  const snapshot = snapshotValue && typeof snapshotValue === 'object'
    ? snapshotValue as Record<string, unknown> : {}
  const billing = snapshot.billing && typeof snapshot.billing === 'object'
    ? snapshot.billing as Record<string, unknown> : {}
  const tokens = tokensValue && typeof tokensValue === 'object'
    ? tokensValue as Record<string, unknown> : {}
  return {
    agentId: typeof billing.agentId === 'string' ? billing.agentId : '',
    environmentId: typeof billing.environmentId === 'string' ? billing.environmentId : '',
    forceFreeTierLimits: false,
    inputTokens: typeof tokens.input === 'number' ? tokens.input : 0,
    modelId: typeof billing.modelId === 'string' ? billing.modelId : 'openrouter/free',
    modelUsageBilling: billing.modelUsageBilling === 'overlay' ? 'overlay' as const : 'byok' as const,
    operationId: typeof billing.operationId === 'string' ? billing.operationId : 'remote-agent',
    outcome,
    outputTokens: typeof tokens.output === 'number' ? tokens.output : 0,
    reservationId: typeof billing.reservationId === 'string' ? billing.reservationId : null,
    runId: typeof billing.runId === 'string' ? billing.runId : '',
    sandboxBilling: snapshot.sandboxBilling && typeof snapshot.sandboxBilling === 'object'
      ? snapshot.sandboxBilling as import('./ConnectedAgentRepository').ConnectedAgentSandboxBilling
      : null,
    userId: typeof billing.userId === 'string' ? billing.userId : '',
    workspaceId: typeof billing.workspaceId === 'string' ? billing.workspaceId : '',
  }
}
function terminalOutcome(status: string): 'completed' | 'failed' | 'cancelled' {
  return status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed'
}
function isCompatibleTerminalAcknowledgement(status: string, events: Array<{ type: string }>) {
  const expected = status === 'cancelled' ? 'cancelled' : status === 'completed' ? 'completed' : 'failed'
  return events.every((event) => event.type === expected)
}

function recoveryParts(value: unknown, runId: string, environmentName: string, code: string, message: string, resolvedAt: number) {
  const parts = Array.isArray(value) ? value as Array<Record<string, unknown>> : []
  return [
    ...parts.filter((part) => part.type !== 'data-remote-agent-status').map((part) => {
      const data = part.data && typeof part.data === 'object' ? part.data as Record<string, unknown> : null
      return part.type === 'data-remote-agent-request' && data?.state === 'pending'
        ? { ...part, data: { ...data, state: 'resolved', resolution: {
          decision: code, resolvedByPrincipalId: 'system:remote-supervisor', resolvedAt,
        } } }
        : part
    }),
    { type: 'data-remote-agent-status', data: {
      runId, environmentName, queueExpiresAt: 0, state: 'recoverable', retryable: true,
      retryClass: code.includes('offline') ? 'host_offline' : 'timeout', message,
    } },
  ]
}
