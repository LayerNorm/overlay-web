import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { and, eq } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import {
  agentRuns,
  conversationMessages,
  conversations,
  users,
  workspaceMemberships,
  workspacePrincipals,
  workspaces,
} from '@/server/database/postgres/schema'
import { PostgresBackgroundMaintenanceService } from '@/server/app-data/PostgresBackgroundMaintenanceService'
import { PostgresActConversationRepository } from './PostgresActConversationRepository'
import type { Id } from '../../../convex/_generated/dataModel'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres AgentRun lifecycle is atomic, cancellable, and lease-reconciled', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const repository = new PostgresActConversationRepository(db)
  const maintenance = new PostgresBackgroundMaintenanceService(db)
  const suffix = randomUUID()
  const userId = `agent_run_user_${suffix}`
  const workspaceId = `agent_run_workspace_${suffix}`
  const principalId = `agent_run_principal_${suffix}`
  const conversationId = `agent_run_conversation_${suffix}` as Id<'conversations'>
  const now = new Date()

  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
    await db.insert(workspaces).values({
      id: workspaceId,
      kind: 'personal',
      name: 'Personal',
      slug: `agent-run-${suffix}`,
      status: 'active',
      personalOwnerUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspacePrincipals).values({
      id: principalId,
      workspaceId,
      type: 'human',
      userId,
      displayName: 'AgentRun tester',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspaceMemberships).values({
      workspaceId,
      principalId,
      role: 'owner',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    })
    await db.insert(conversations).values({
      id: conversationId,
      userId,
      title: 'AgentRun contract',
      lastMode: 'act',
      askModelIds: ['openrouter/free'],
      actModelId: 'openrouter/free',
      conversationType: 'personal',
      workspaceId,
      createdByPrincipalId: principalId,
      createdAt: now,
      lastModified: now,
      updatedAt: now,
    })

    const userMessageId = await repository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_complete',
      role: 'user',
      mode: 'act',
      content: 'complete this run',
      contentType: 'text',
      modelId: 'openrouter/free',
      authorPrincipalId: principalId,
      skipMemoryExtraction: true,
    })
    assert.ok(userMessageId)
    const run = await repository.startAgentRun({
      conversationId,
      userId,
      userMessageId,
      turnId: 'turn_complete',
      mode: 'chat',
      runner: 'tool_loop',
      modelId: 'openrouter/free',
      leaseExpiresAt: Date.now() + 60_000,
    })
    assert.equal(run?.status, 'queued')
    assert.ok(run?.assistantMessageId)
    await assert.rejects(() => repository.transitionAgentRun({
      runId: run!.id,
      userId,
      status: 'completed',
    }), /Invalid AgentRun transition/)
    assert.equal((await repository.transitionAgentRun({
      runId: run!.id,
      userId,
      status: 'running',
    }))?.status, 'running')
    assert.equal((await repository.completeAgentRun({
      runId: run!.id,
      userId,
      content: 'final-only result',
      parts: [{ type: 'text', text: 'final-only result' }],
      tokens: { input: 2, output: 3 },
      metrics: {
        firstTokenAt: Date.now(),
        inputTokens: 2,
        outputTokens: 3,
        providerCostMicros: 7,
      },
    }))?.status, 'completed')
    const measuredRun = await repository.recordAgentRunMetrics({
      runId: run!.id,
      userId,
      metrics: { toolCallCount: 1, toolSuccessCount: 1 },
    })
    assert.equal(measuredRun?.metrics?.providerCostMicros, 7)
    assert.equal(measuredRun?.metrics?.toolSuccessCount, 1)
    const metricRuns = await repository.listAgentRunsForMetrics({
      userId,
      from: now.getTime() - 1_000,
      to: Date.now() + 1_000,
      limit: 10,
    })
    assert.ok(metricRuns.some((candidate) => candidate.id === run!.id))

    const duplicateUserMessageId = await repository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_duplicate',
      role: 'user',
      mode: 'act',
      content: 'start exactly once',
      contentType: 'text',
      modelId: 'openrouter/free',
      authorPrincipalId: principalId,
      skipMemoryExtraction: true,
    })
    assert.ok(duplicateUserMessageId)
    const duplicateArgs = {
      conversationId,
      userId,
      userMessageId: duplicateUserMessageId,
      turnId: 'turn_duplicate',
      mode: 'chat' as const,
      runner: 'tool_loop' as const,
      modelId: 'openrouter/free',
      leaseExpiresAt: Date.now() + 60_000,
    }
    const [duplicateA, duplicateB] = await Promise.all([
      repository.startAgentRun(duplicateArgs),
      repository.startAgentRun(duplicateArgs),
    ])
    assert.equal(duplicateA?.id, duplicateB?.id)
    assert.equal(duplicateA?.assistantMessageId, duplicateB?.assistantMessageId)
    const duplicateRows = await db.select({ id: agentRuns.id }).from(agentRuns).where(and(
      eq(agentRuns.userId, userId),
      eq(agentRuns.turnId, 'turn_duplicate'),
    ))
    assert.equal(duplicateRows.length, 1)
    await repository.transitionAgentRun({ runId: duplicateA!.id, userId, status: 'running' })
    await repository.completeAgentRun({
      runId: duplicateA!.id,
      userId,
      content: 'started once',
      parts: [{ type: 'text', text: 'started once' }],
      tokens: { input: 1, output: 1 },
    })

    const workUserMessageId = await repository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_work',
      role: 'user',
      mode: 'act',
      content: 'run durable work',
      contentType: 'text',
      modelId: 'openrouter/free',
      authorPrincipalId: principalId,
      skipMemoryExtraction: true,
    })
    assert.ok(workUserMessageId)
    const workRun = await repository.startAgentRun({
      conversationId,
      userId,
      userMessageId: workUserMessageId,
      turnId: 'turn_work',
      mode: 'work',
      runner: 'workflow',
      modelId: 'openrouter/free',
    })
    assert.equal(workRun?.status, 'queued')
    const attachedWorkRun = await repository.attachAgentRunWorkflow({
      runId: workRun!.id,
      userId,
      workflowRunId: 'workflow-test-run',
    })
    assert.equal(attachedWorkRun?.status, 'running')
    assert.equal(attachedWorkRun?.workflowRunId, 'workflow-test-run')
    const waitingWorkRun = await repository.transitionAgentRun({
      runId: workRun!.id,
      userId,
      status: 'waiting_for_approval',
      approval: {
        token: 'approval-test-token',
        requestedAt: Date.now(),
        requests: [{
          approvalId: 'approval-call-work',
          toolCallId: 'call-work',
          toolName: 'send_email',
          input: { subject: 'Approve me' },
        }],
      },
    })
    assert.equal(waitingWorkRun?.approval?.token, 'approval-test-token')
    const resumedWorkRun = await repository.transitionAgentRun({
      runId: workRun!.id,
      userId,
      status: 'running',
    })
    assert.equal(resumedWorkRun?.approval, undefined)
    assert.equal((await repository.completeAgentRun({
      runId: workRun!.id,
      userId,
      content: 'durable final-only result',
      parts: [{ type: 'text', text: 'durable final-only result' }],
      tokens: { input: 4, output: 5 },
    }))?.status, 'completed')

    const cancelledUserMessageId = await repository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_cancelled',
      role: 'user',
      mode: 'act',
      content: 'cancel this run',
      contentType: 'text',
      modelId: 'openrouter/free',
      authorPrincipalId: principalId,
      skipMemoryExtraction: true,
    })
    assert.ok(cancelledUserMessageId)
    const cancelledRun = await repository.startAgentRun({
      conversationId,
      userId,
      userMessageId: cancelledUserMessageId,
      turnId: 'turn_cancelled',
      mode: 'work',
      runner: 'workflow',
      modelId: 'openrouter/free',
      workflowRunId: 'workflow-test-cancel',
    })
    assert.ok(cancelledRun)
    await repository.transitionAgentRun({ runId: cancelledRun.id, userId, status: 'running' })
    const cancelled = await repository.cancelAgentRuns({ conversationId, userId })
    assert.deepEqual(cancelled.cancelledRunIds, [cancelledRun.id])
    assert.deepEqual(cancelled.cancelledWorkflowRunIds, ['workflow-test-cancel'])
    assert.equal((await repository.completeAgentRun({
      runId: cancelledRun.id,
      userId,
      content: 'late completion',
      parts: [{ type: 'text', text: 'late completion' }],
      tokens: { input: 1, output: 1 },
    }))?.status, 'cancelled')

    const leaseUserMessageId = await repository.addMessage({
      conversationId,
      userId,
      turnId: 'turn_expired',
      role: 'user',
      mode: 'act',
      content: 'expire this run',
      contentType: 'text',
      modelId: 'openrouter/free',
      authorPrincipalId: principalId,
      skipMemoryExtraction: true,
    })
    assert.ok(leaseUserMessageId)
    const expiredRun = await repository.startAgentRun({
      conversationId,
      userId,
      userMessageId: leaseUserMessageId,
      turnId: 'turn_expired',
      mode: 'chat',
      runner: 'tool_loop',
      modelId: 'openrouter/free',
      leaseExpiresAt: Date.now() - 1,
    })
    assert.ok(expiredRun)
    const leaseResult = await maintenance.expireToolLoopAgentRunLeases({ now: new Date() })
    assert.equal(leaseResult.failed, 1)
    const reconciled = await repository.getLatestAgentRun({ conversationId, userId })
    assert.equal(reconciled?.id, expiredRun.id)
    assert.equal(reconciled?.status, 'failed')
    assert.equal(reconciled?.terminalError?.code, 'tool_loop_lease_expired')
    const messages = await repository.getConversationMessages({ conversationId, userId })
    const expiredAssistant = messages.find((message) => message._id === expiredRun.assistantMessageId)
    assert.equal(expiredAssistant?.status, 'error')
    assert.match(expiredAssistant?.content ?? '', /chat process stopped/)
  } finally {
    await db.delete(agentRuns).where(eq(agentRuns.userId, userId))
    await db.delete(conversationMessages).where(eq(conversationMessages.userId, userId))
    await db.delete(conversations).where(eq(conversations.userId, userId))
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId))
    await db.delete(workspacePrincipals).where(eq(workspacePrincipals.workspaceId, workspaceId))
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await db.delete(users).where(eq(users.id, userId))
    await pool.end()
  }
})
