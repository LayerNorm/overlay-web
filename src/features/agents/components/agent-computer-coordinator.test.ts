import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentComputerCoordinator } from './agent-computer-coordinator'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('pending control commits confirmed ownership despite polling and rejects duplicate operations', async () => {
  const coordinator = new AgentComputerCoordinator()
  coordinator.setScope('workspace:agent')
  const pending = deferred<string>()
  const updates: string[] = []
  let queued = false
  const callbacks = {
    start() {}, apply: (value: string) => updates.push(value), error: () => assert.fail('unexpected mutation error'),
    finish: (refresh: boolean) => { queued = refresh },
  }
  const result = coordinator.mutate('control', () => pending.promise, callbacks)
  assert.equal(await coordinator.mutate('start', async () => { assert.fail('duplicate request') }, callbacks), null)
  assert.equal(coordinator.beginRefresh(), null)
  pending.resolve('confirmed-controller')
  assert.equal(await result, 'confirmed-controller')
  assert.deepEqual(updates, ['confirmed-controller'])
  assert.equal(queued, true)
  assert.ok(coordinator.beginRefresh())
})

test('late wake success and failure cannot replace new state or clear its busy slot', async () => {
  for (const fail of [false, true]) {
    const coordinator = new AgentComputerCoordinator()
    coordinator.setScope('workspace:old')
    const pending = deferred<string>()
    const result = coordinator.mutate('start', () => pending.promise, {
      start() {}, apply: () => assert.fail('stale computer applied'),
      error: () => assert.fail('stale error displayed'),
      finish: () => assert.fail('stale request cleared current busy state'),
    })
    coordinator.setScope('workspace:new')
    assert.ok(coordinator.beginMutation('control'))
    if (fail) pending.reject(new Error('old failure'))
    else pending.resolve('old computer')
    assert.equal(await result, null)
    assert.equal(coordinator.getBusyKind(), 'control')
  }
})

test('polling queues behind control without invalidating its response', () => {
  const coordinator = new AgentComputerCoordinator()
  coordinator.setScope('workspace:agent')
  const control = coordinator.beginMutation('control')
  assert.ok(control)
  assert.equal(coordinator.beginRefresh(), null)
  assert.equal(coordinator.isCurrent(control), true)
  assert.equal(coordinator.finishMutation(control), true)
  const refresh = coordinator.beginRefresh()
  assert.ok(refresh)
  assert.equal(coordinator.isCurrent(refresh), true)
})

test('scope changes invalidate stale wake and cannot clear the new busy slot', () => {
  const coordinator = new AgentComputerCoordinator()
  coordinator.setScope('workspace:old')
  const wake = coordinator.beginMutation('start')
  assert.ok(wake)
  coordinator.setScope('workspace:new')
  const control = coordinator.beginMutation('control')
  assert.ok(control)
  assert.equal(coordinator.isCurrent(wake), false)
  assert.equal(coordinator.finishMutation(wake), false)
  assert.equal(coordinator.getBusyKind(), 'control')
  assert.equal(coordinator.finishMutation(control), false)
})

test('same-tick mutations are rejected and unmount invalidates ownership', () => {
  const coordinator = new AgentComputerCoordinator()
  coordinator.setScope('workspace:agent')
  const first = coordinator.beginMutation('delete')
  assert.ok(first)
  assert.equal(coordinator.beginMutation('start'), null)
  coordinator.invalidate()
  assert.equal(coordinator.isCurrent(first), false)
  assert.equal(coordinator.getBusyKind(), null)
})
