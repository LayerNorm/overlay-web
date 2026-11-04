import { beforeEach, expect, test, vi } from 'vitest'
import { ActConversationServiceError } from '@/server/conversations/ActEntitlementService'
import { pendingHarnessPaymentVerification } from './funding-admission'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get } }))
vi.mock('@/server/conversations/ActEntitlementService', () => ({
  ActConversationServiceError: class extends Error {
    constructor(readonly payload: Record<string, unknown>, readonly statusCode: number) { super(String(payload.error)) }
  },
}))
const reference = { actorUserId: 'owner', workspaceId: 'workspace', runId: 'run', workflowRunId: 'workflow', executionGeneration: 3 }
const state = { policy: { actorUserId: 'owner', workspaceId: 'workspace', executionPolicyVersion: 2, spendingMode: 'workspace' },
  workflowRunId: 'workflow', executionGeneration: 3, status: 'waiting_for_resources', resourcePause: { receiptId: 'model:0' } }
const pending = () => new ActConversationServiceError({ error: 'payment_pending' }, 402)
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockResolvedValue(state) })

test('verified current ownership may retain an existing funding wait through payment verification', async () => {
  expect(await pendingHarnessPaymentVerification(pending(), reference)).toBe(true)
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith({ actorUserId: 'owner', runId: 'run' })
  expect(state.status).toBe('waiting_for_resources')
})

test.each([
  { workflowRunId: 'old' }, { executionGeneration: 2 }, { status: 'running' }, { resourcePause: undefined },
  { policy: { ...state.policy, actorUserId: 'other' } },
  { policy: { ...state.policy, workspaceId: 'other' } },
  { policy: { ...state.policy, executionPolicyVersion: 1 } },
  { policy: { ...state.policy, spendingMode: 'external' } },
])('payment-pending cannot bypass the paused run authority: %j', async patch => {
  mocks.get.mockResolvedValue({ ...state, ...patch })
  expect(await pendingHarnessPaymentVerification(pending(), reference)).toBe(false)
})

test.each([
  new Error('payment_pending'), new ActConversationServiceError({ error: 'payment_pending' }, 400),
  new ActConversationServiceError({ error: 'billing_suspended' }, 402),
  new ActConversationServiceError({ error: 'subscription_required' }, 402),
])('other failures cannot authorize a funding wait', async error => {
  expect(await pendingHarnessPaymentVerification(error, reference)).toBe(false)
  expect(mocks.get).not.toHaveBeenCalled()
})
