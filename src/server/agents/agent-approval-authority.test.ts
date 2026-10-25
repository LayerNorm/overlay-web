import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRunApprovalAccess } from './agent-approval-authority'
import type { AgentRun } from '@/shared/agents/agent-run'

const request = {
  actorUserId: 'initiator',
  agentRunId: 'run-a',
  conversationId: 'room-a',
  token: 'token-a',
}

const run: AgentRun = {
  id: 'run-a',
  conversationId: 'room-a',
  turnId: 'turn-a',
  userId: 'initiator',
  userMessageId: 'message-user',
  assistantMessageId: 'message-agent',
  mode: 'room',
  runner: 'workflow',
  status: 'waiting_for_approval',
  approval: { token: 'token-a', requestedAt: 1, requests: [] },
  createdAt: 1,
  updatedAt: 1,
}

test('room approval requires the exact active run, conversation, token, and initiator', () => {
  assert.equal(agentRunApprovalAccess(run, request), 'allowed')
  assert.equal(agentRunApprovalAccess({ ...run, id: 'run-b' }, request), 'inactive')
  assert.equal(agentRunApprovalAccess({ ...run, conversationId: 'room-b' }, request), 'inactive')
  assert.equal(agentRunApprovalAccess({ ...run, approval: { ...run.approval!, token: 'stale' } }, request), 'inactive')
  assert.equal(agentRunApprovalAccess({ ...run, status: 'completed' }, request), 'inactive')
  assert.equal(agentRunApprovalAccess(run, { ...request, actorUserId: 'room-member' }), 'initiator-only')
})

test('personal Work approval authority remains unchanged', () => {
  assert.equal(agentRunApprovalAccess({ ...run, mode: 'work', userId: 'initiator' }, request), 'allowed')
  assert.equal(agentRunApprovalAccess(
    { ...run, mode: 'work', userId: 'work-owner' },
    { ...request, actorUserId: 'work-owner' },
  ), 'allowed')
})
