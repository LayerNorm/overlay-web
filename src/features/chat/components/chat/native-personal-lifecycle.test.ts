import assert from 'node:assert/strict'
import test from 'node:test'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'
import {
  nativeLegacyLifecycleArgs,
  nativePendingTurnsForScope,
  claimNativeRunCommand,
  finishNativeRunCommand,
  nativeRunCommandAllowed,
  nativeRunCommandIdentity,
  toNativePersonalRun,
} from './native-personal-lifecycle'
import { projectPersonalTranscript, type PersonalPendingTurn } from './personal-transcript'
import {
  nativePersonalCurrentTurnId,
  nativePersonalTurnIsActive,
  selectNativePersonalScope,
} from './useNativePersonalTranscript'

const run = {
  id: 'run',
  conversationId: 'conversation',
  turnId: 'turn',
  userId: 'viewer',
  userMessageId: 'user-message',
  assistantMessageId: 'assistant-message',
  mode: 'work' as const,
  runner: 'workflow' as const,
  status: 'waiting_for_resources' as const,
  createdAt: 10,
  updatedAt: 11,
  plan: [{ id: 'step', title: 'Inspect', status: 'in_progress' }],
  fundingPause: { reason: 'budget_exceeded' as const, requiredCents: 10, availableCents: 0, reservedCents: 0 },
  authorizationPause: { reason: 'task_deadline_expired' as const, deadlineAt: 20, pausedAt: 21 },
  resourceRequest: { request: { token: 'resource-token' }, awaitingReceipt: true },
}

test('native lifecycle mapping preserves public controls while omitting private workflow identities', () => {
  const projected = toNativePersonalRun(run as never)
  assert.deepEqual(projected?.plan, run.plan)
  assert.deepEqual(projected?.fundingPause, run.fundingPause)
  assert.deepEqual(projected?.authorizationPause, run.authorizationPause)
  assert.deepEqual(projected?.resourceRequest, run.resourceRequest)
  assert.equal('workflowRunId' in (projected ?? {}), false)
  assert.equal('harnessRunId' in (projected ?? {}), false)
})

test('native mode makes the legacy lifecycle query inert', () => {
  assert.deepEqual(nativeLegacyLifecycleArgs(true, 'conversation', true), {
    conversationId: null, enabled: false,
  })
  assert.deepEqual(nativeLegacyLifecycleArgs(false, 'conversation', true), {
    conversationId: 'conversation', enabled: true,
  })
})

test('native route ownership does not depend on the error-boundary availability fallback', () => {
  const summary = {
    _id: 'conversation',
    workspaceId: 'workspace',
    askModelIds: [],
    actModelId: 'model',
  }
  const selection = selectNativePersonalScope({
    nativePersonalRoute: true,
    isTemporaryChat: false,
    hasAutomationContext: false,
    activeChatId: 'conversation',
    isNativePersonalChat: () => true,
    pendingRunConversationId: null,
    pendingTurns: 0,
    personal: {
      available: false,
      selectedConversationId: 'conversation',
      selectedSummary: summary,
      workspaceId: 'workspace',
      active: { rows: [summary] },
      archived: { rows: [] },
    } as never,
    selectedModels: [],
    selectedActModel: 'model',
  })
  assert.equal(selection.enabled, true)
  assert.equal(selection.active, true)
  assert.equal(selection.conversationId, 'conversation')
})

test('pending journal rows are isolated to the verified owner and workspace', () => {
  const pendingTurn = (turnId: string, ownerId: string, workspaceId: string) => ({
    turnId,
    ownerId,
    workspaceId,
    user: {},
    responses: [],
    userAcknowledged: false,
  }) as unknown as PersonalPendingTurn
  const turns = new Map([
    ['current', pendingTurn('current', 'viewer', 'workspace')],
    ['other-user', pendingTurn('other-user', 'other', 'workspace')],
    ['other-workspace', pendingTurn('other-workspace', 'viewer', 'other')],
  ])
  assert.deepEqual([...nativePendingTurnsForScope(turns, 'viewer', 'workspace').keys()], ['current'])
  assert.equal(nativePendingTurnsForScope(turns, null, 'workspace').size, 0)
})

test('native command identity fences user, workspace, conversation, run and token', () => {
  const projected = toNativePersonalRun({ ...run, status: 'waiting_for_approval' } as never)!
  const scope = {
    enabled: true,
    writable: true,
    status: 'ready' as const,
    scopeKey: JSON.stringify(['viewer', 'workspace', 'conversation']),
    userId: 'viewer',
    workspaceId: 'workspace',
    conversationId: 'conversation',
    isCurrentScope: () => true,
  }
  assert.equal(nativeRunCommandAllowed({ scope, run: projected, activeChatId: 'conversation' }), true)
  assert.equal(nativeRunCommandAllowed({
    scope, run: projected, activeChatId: PENDING_FIRST_CHAT_ID,
  }), true)
  assert.equal(nativeRunCommandAllowed({
    scope, run: projected, activeChatId: 'other-conversation',
  }), false)
  assert.equal(nativeRunCommandAllowed({
    scope: { ...scope, writable: false }, run: projected, activeChatId: 'conversation',
  }), false)
  assert.equal(nativeRunCommandAllowed({
    scope: { ...scope, isCurrentScope: () => false }, run: projected, activeChatId: 'conversation',
  }), false)
  assert.equal(nativeRunCommandAllowed({
    scope: { ...scope, userId: 'other' }, run: projected, activeChatId: 'conversation',
  }), false)
  assert.notEqual(nativeRunCommandIdentity(scope.scopeKey, 'run', 'token-a'),
    nativeRunCommandIdentity(scope.scopeKey, 'run', 'token-b'))

  const pending = { current: null as string | null }
  const consumed = { current: null as string | null }
  const identity = nativeRunCommandIdentity(scope.scopeKey, 'run', 'approval-token')
  assert.equal(claimNativeRunCommand(identity, pending, consumed), true)
  assert.equal(claimNativeRunCommand(identity, pending, consumed), false)
  finishNativeRunCommand(identity, pending, consumed, true)
  assert.equal(claimNativeRunCommand(identity, pending, consumed), false)
  assert.equal(claimNativeRunCommand(nativeRunCommandIdentity(scope.scopeKey, 'run', 'new-token'), pending, consumed), true)
})

test('terminal canonical turns stop stale activity without hiding a newer pending turn', () => {
  const terminal = {
    exchanges: [{ turnId: 'old-turn', user: { createdAt: 10 }, responses: [] }],
    terminalTurnIds: new Set(['old-turn']),
  } as never
  const staleRun = { turnId: 'old-turn', status: 'running', createdAt: 10 }
  assert.equal(nativePersonalTurnIsActive({
    projection: terminal, pendingTurns: [], run: staleRun,
  }), false)

  const newer = {
    exchanges: [{ turnId: 'old-turn', user: { createdAt: 900 }, responses: [] }],
    terminalTurnIds: new Set(['old-turn']),
  } as never
  const pendingNewer = {
    turnId: 'new-turn',
    user: { createdAt: 1 },
    responses: [],
  } as never
  assert.equal(nativePersonalCurrentTurnId(newer, staleRun, [pendingNewer]), 'new-turn')
  assert.equal(nativePersonalTurnIsActive({
    projection: newer,
    pendingTurns: [pendingNewer],
    run: staleRun,
  }), true)
  const failedAdmission = {
    turnId: 'failed-turn',
    localGenerationResults: [{ status: 'failed' }],
    responses: [],
  } as never
  assert.equal(nativePersonalCurrentTurnId(newer, null, [failedAdmission]), 'old-turn')
  assert.equal(nativePersonalTurnIsActive({
    projection: newer, pendingTurns: [failedAdmission], run: null,
  }), false)
  const activeDurableRun = { turnId: 'active-turn', status: 'running' }
  assert.equal(nativePersonalCurrentTurnId(newer, activeDurableRun, [failedAdmission]), 'active-turn')
  assert.equal(nativePersonalTurnIsActive({
    projection: newer, pendingTurns: [failedAdmission], run: activeDurableRun,
  }), true)
  assert.equal(nativePersonalTurnIsActive({
    projection: projectPersonalTranscript([], []),
    pendingTurns: [],
    run: null,
  }), false)
})
