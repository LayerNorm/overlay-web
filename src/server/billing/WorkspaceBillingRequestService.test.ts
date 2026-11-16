import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceAccess, WorkspaceBillingSummaryResponse, WorkspaceMember } from '@overlay/workspace-contracts'
import type { LifecycleEventInput } from '@/server/lifecycle-events/contract'
import { WorkspaceBillingRequestService } from './WorkspaceBillingRequestService'
import { BillingServiceError } from './BillingCustomerService'

function member(userId: string, role: WorkspaceAccess['membership']['role'], human = true): WorkspaceAccess {
  return {
    workspace: { id: 'team-a', kind: 'organization', name: 'Acme', slug: 'acme', status: 'active', createdByPrincipalId: 'owner-1', createdAt: 1, updatedAt: 1 },
    principal: { id: `principal-${userId}`, workspaceId: 'team-a', type: human ? 'human' : 'agent', userId, displayName: userId === 'requester-1' ? 'Ada' : userId, createdAt: 1, updatedAt: 1 },
    membership: { workspaceId: 'team-a', principalId: `principal-${userId}`, role, status: 'active', joinedAt: 1, updatedAt: 1 },
  }
}

function fixture() {
  let actor: WorkspaceAccess | null = member('requester-1', 'member')
  let ready = false
  let now = Date.UTC(2026, 10, 12, 23, 59)
  const events: LifecycleEventInput[] = []
  let members: WorkspaceMember[] = [
    member('owner-1', 'owner'), member('admin-1', 'admin'), member('member-2', 'member'),
    member('agent-1', 'admin', false), member('owner-1', 'owner'),
    { ...member('removed', 'admin'), membership: { ...member('removed', 'admin').membership, status: 'removed' } },
  ]
  const service = new WorkspaceBillingRequestService({
    repository: { async getAccess() { return actor } },
    workspaces: { async listMembers() { return members } },
    billing: { async summary() { return { executionAccess: { canExecute: ready, state: ready ? 'ready' : 'subscription_required' }, canManage: actor?.membership.role === 'admin' || actor?.membership.role === 'owner' } as WorkspaceBillingSummaryResponse } },
    events: { async publish(event) { events.push(event); return null } },
    now: () => now,
  })
  return { service, events, setActor(value: WorkspaceAccess | null) { actor = value }, setReady(value: boolean) { ready = value }, nextDay() { now += 60_000 }, setMembers(value: WorkspaceMember[]) { members = value } }
}

const args = { actorUserId: 'requester-1', workspaceId: 'team-a' }

test('member request fans out to human active owner/admin users and repeats use the same daily keys', async () => {
  const f = fixture()
  assert.deepEqual(await f.service.request(args), { requested: true })
  assert.deepEqual(f.events.map(event => event.userId), ['owner-1', 'admin-1'])
  assert.deepEqual(f.events.map(event => event.idempotencyKey), [
    'workspace.billing_requested:team-a:requester-1:owner-1:2026-11-12',
    'workspace.billing_requested:team-a:requester-1:admin-1:2026-11-12',
  ])
  assert.equal(f.events[0].name, 'workspace.billing_requested')
  assert.deepEqual(f.events[0].attributes, { workspaceId: 'team-a', workspaceName: 'Acme', requesterName: 'Ada' })
  await f.service.request(args)
  assert.deepEqual(f.events.slice(2).map(event => event.idempotencyKey), f.events.slice(0, 2).map(event => event.idempotencyKey))
  f.nextDay()
  await f.service.request(args)
  assert.ok(f.events.at(-1)?.idempotencyKey.endsWith(':2026-11-13'))
})

test('paid workspaces reject with 409 before publishing', async () => {
  const f = fixture()
  f.setReady(true)
  await assert.rejects(f.service.request(args), error => error instanceof BillingServiceError && error.statusCode === 409)
  assert.equal(f.events.length, 0)
})

test('owner/admin callers reject with 400', async () => {
  for (const role of ['owner', 'admin'] as const) {
    const f = fixture()
    f.setActor(member('requester-1', role))
    await assert.rejects(f.service.request(args), error => error instanceof BillingServiceError && error.statusCode === 400)
    assert.equal(f.events.length, 0)
  }
})

test('non-members and removed memberships reject with 403', async () => {
  for (const actor of [null, { ...member('requester-1', 'member'), membership: { ...member('requester-1', 'member').membership, status: 'removed' as const } }]) {
    const f = fixture()
    f.setActor(actor)
    await assert.rejects(f.service.request(args), error => error instanceof BillingServiceError && error.statusCode === 403)
    assert.equal(f.events.length, 0)
  }
})

test('no eligible billing recipients is safe', async () => {
  const f = fixture()
  f.setMembers([])
  assert.deepEqual(await f.service.request(args), { requested: true })
  assert.equal(f.events.length, 0)
})
