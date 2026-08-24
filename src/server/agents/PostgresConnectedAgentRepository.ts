import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, max, or, sql } from 'drizzle-orm'
import type {
  AgentApprovalRequest, AgentBinding, AgentEnrollmentSession, AgentEnvironment,
  AgentEnvironmentCredential, AgentEnvironmentProofChallenge, AgentRemoteSession,
  AgentRunCommand, AgentSandboxLease,
} from '@overlay/workspace-contracts'
import { MAX_COMMAND_BYTES, MAX_EVENT_BATCH_BYTES } from '@overlay/agent-bridge-protocol'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  agentApprovalRequests, agentBindings, agentEnrollmentSessions, agentEnvironmentCredentials,
  agentEnvironmentProofChallenges, agentEnvironmentProofNonces, agentEnvironments,
  agentRemoteSessions, agentRunCommands, agentRuns, agentSandboxLeases, conversationEvents,
  conversationMessages, conversationParticipants, conversations, workspaceMemberships, workspacePrincipals,
} from '@/server/database/postgres/schema'
import { projectRemoteAgentEvents, waitingRemoteAgentParts } from '@/shared/agents/remote-agent-transcript'
import type {
  ApplyRemoteEventsResult, ConnectedAgentCreateBinding, ConnectedAgentCreateEnvironment,
  ConnectedAgentCreateSession, ConnectedAgentEnqueueCommand, ConnectedAgentRepository,
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
        eq(conversationMessages.turnId, input.turnId),
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
        leaseExpiresAt: new Date(online ? input.now + REMOTE_RUN_LEASE_MS : input.queueExpiresAt),
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
            modelId: input.modelId,
            userId: input.actorUserId,
            operationId: `workspace-agent:${input.turnId}`,
          },
          queueExpiresAt: input.queueExpiresAt,
          environmentName: target.environment.name,
        },
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

  async controlQueuedRemoteAgentTurn(args: Parameters<ConnectedAgentRepository['controlQueuedRemoteAgentTurn']>[0]) {
    return await this.db.transaction(async (tx) => {
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
          eq(agentRuns.userId, args.actorUserId),
          eq(agentRuns.runner, 'remote'),
          eq(agentRemoteSessions.workspaceId, args.workspaceId),
        )).limit(1).for('update')
      if (!row || row.run.status !== 'queued') return { applied: false }
      const now = new Date(args.now)
      if (args.action === 'cancel') {
        await tx.update(agentRuns).set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
          .where(eq(agentRuns.id, row.run.id))
        await tx.update(agentRemoteSessions).set({ status: 'cancelled', endedAt: now, updatedAt: now })
          .where(eq(agentRemoteSessions.id, row.session.id))
        await tx.update(agentRunCommands).set({ status: 'cancelled', claimExpiresAt: null, updatedAt: now })
          .where(and(eq(agentRunCommands.runId, row.run.id), inArray(agentRunCommands.status, ['pending', 'claimed'])))
        await tx.update(conversationMessages).set({
          content: 'Cancelled',
          parts: [{ type: 'text', text: 'Cancelled' }, {
            type: 'data-remote-agent-status',
            data: { environmentName: row.environmentName, queueExpiresAt: args.queueExpiresAt, runId: row.run.id, state: 'cancelled' },
          }],
          status: 'completed',
          updatedAt: now,
        }).where(eq(conversationMessages.id, row.run.assistantMessageId))
      } else {
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
      }
      await tx.insert(conversationEvents).values({
        conversationId: row.run.conversationId,
        messageId: row.run.assistantMessageId,
        type: args.action === 'cancel' ? 'message.completed' : 'message.delta',
        userId: args.actorUserId,
        createdAt: now,
      })
      return { applied: true, messageId: row.run.assistantMessageId }
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
        inArray(agentRuns.status, ['queued', 'running', 'waiting_for_approval']),
        or(isNull(agentRuns.leaseExpiresAt), gt(agentRuns.leaseExpiresAt, new Date(args.now))),
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
          ? { terminal: terminalBilling(current.capabilitySnapshot, messageRow.tokens) }
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
      if (['completed', 'failed', 'cancelled'].includes(runRow.status)) throw new Error('AGENT_RUN_TERMINAL')

      const snapshot = current.capabilitySnapshot as Record<string, unknown>
      const projection = projectRemoteAgentEvents({
        content: messageRow.content,
        parts: Array.isArray(messageRow.parts) ? messageRow.parts as Array<Record<string, unknown>> : [],
        events: args.events,
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
        ...(projection.terminal ? { terminal: terminalBilling(current.capabilitySnapshot, projection.tokens) } : {}),
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
function approval(row: ApprovalRow): AgentApprovalRequest { return { ...row, requestedAt: row.requestedAt.getTime(), resolution: row.resolution ?? undefined } }
function sandboxLease(row: SandboxLeaseRow): AgentSandboxLease { return { ...row, status: row.status as AgentSandboxLease['status'], providerReference: row.providerReference ?? undefined, runId: row.runId ?? undefined, reservationId: row.reservationId ?? undefined, reservedUntil: row.reservedUntil.getTime(), runtimeStartedAt: ms(row.runtimeStartedAt), runtimeEndedAt: ms(row.runtimeEndedAt), cleanupAfter: ms(row.cleanupAfter), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function sameResolution(
  left: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
  right: { decision: string; resolvedByPrincipalId: string; resolvedAt: number },
) { return left.decision === right.decision && left.resolvedByPrincipalId === right.resolvedByPrincipalId && left.resolvedAt === right.resolvedAt }
function enrollment(row: EnrollmentRow): AgentEnrollmentSession { return { ...row, status: row.status as AgentEnrollmentSession['status'], environmentId: row.environmentId ?? undefined, expiresAt: row.expiresAt.getTime(), redeemedAt: ms(row.redeemedAt), approvedAt: ms(row.approvedAt), createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() } }
function proofChallenge(row: ProofChallengeRow): AgentEnvironmentProofChallenge { return { ...row, expiresAt: row.expiresAt.getTime(), consumedAt: ms(row.consumedAt), createdAt: row.createdAt.getTime() } }
function credential(row: CredentialRow): AgentEnvironmentCredential { return { ...row, audience: row.audience as AgentEnvironmentCredential['audience'], methods: row.methods as AgentEnvironmentCredential['methods'], expiresAt: row.expiresAt.getTime(), revokedAt: ms(row.revokedAt), createdAt: row.createdAt.getTime() } }
function credentialValues(value: AgentEnvironmentCredential): typeof agentEnvironmentCredentials.$inferInsert { return { id: value.id, workspaceId: value.workspaceId, environmentId: value.environmentId, tokenHash: value.tokenHash, audience: value.audience, methods: value.methods, tokenNonce: value.tokenNonce, expiresAt: new Date(value.expiresAt), revokedAt: date(value.revokedAt), createdAt: new Date(value.createdAt) } }
function sameMethods(left: string[], right: string[]) { return left.length === right.length && left.every((method) => right.includes(method)) }
function jsonByteLength(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength }
function terminalBilling(snapshotValue: unknown, tokensValue: unknown) {
  const snapshot = snapshotValue && typeof snapshotValue === 'object'
    ? snapshotValue as Record<string, unknown> : {}
  const billing = snapshot.billing && typeof snapshot.billing === 'object'
    ? snapshot.billing as Record<string, unknown> : {}
  const tokens = tokensValue && typeof tokensValue === 'object'
    ? tokensValue as Record<string, unknown> : {}
  return {
    forceFreeTierLimits: false,
    inputTokens: typeof tokens.input === 'number' ? tokens.input : 0,
    modelId: typeof billing.modelId === 'string' ? billing.modelId : 'openrouter/free',
    operationId: typeof billing.operationId === 'string' ? billing.operationId : 'remote-agent',
    outputTokens: typeof tokens.output === 'number' ? tokens.output : 0,
    reservationId: typeof billing.reservationId === 'string' ? billing.reservationId : null,
    userId: typeof billing.userId === 'string' ? billing.userId : '',
  }
}
