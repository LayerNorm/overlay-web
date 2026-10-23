import assert from 'node:assert/strict'
import test from 'node:test'
import type { Computer } from '@overlay/workspace-contracts'
import { changeAgentComputerControl } from './agent-computer-control'

const computer: Computer = {
  id: 'computer-1', workspaceId: 'workspace-1', ownerType: 'agent', ownerId: 'agent-1',
  provider: 'box', providerRef: 'machine-1', size: 'small', status: 'ready',
  createdBy: 'user-1', createdAt: 1, updatedAt: 1, lastActiveAt: null,
}

test('takeover waits for the scoped server confirmation before returning control', async () => {
  let confirm!: (value: { computer: Computer }) => void
  let opened = false
  const pending = changeAgentComputerControl({
    computer, userId: 'user-1', action: 'take',
    request: (workspaceId, computerId, action) => {
      assert.deepEqual([workspaceId, computerId, action], ['workspace-1', 'computer-1', 'take'])
      return new Promise((resolve) => { confirm = resolve })
    },
  }).then((result) => { opened = true; return result })
  await Promise.resolve()
  assert.equal(opened, false)
  confirm({ computer: { ...computer, controlledByUserId: 'user-1' } })
  assert.equal((await pending).controlledByUserId, 'user-1')
  assert.equal(opened, true)
})

test('takeover rejects failed requests and unconfirmed or wrong-computer responses', async () => {
  await assert.rejects(changeAgentComputerControl({
    computer, userId: 'user-1', action: 'take',
    request: async () => { throw new Error('Control denied') },
  }), /Control denied/)
  for (const updated of [computer, { ...computer, controlledByUserId: 'user-2' },
    { ...computer, controlledByUserId: 'user-1', id: 'computer-2' },
    { ...computer, controlledByUserId: 'user-1', workspaceId: 'workspace-2' }]) {
    await assert.rejects(changeAgentComputerControl({
      computer, userId: 'user-1', action: 'take', request: async () => ({ computer: updated }),
    }), /Could not confirm computer control/)
  }
})

test('hand-back only succeeds once the server has cleared control', async () => {
  const controlled = { ...computer, controlledByUserId: 'user-1' }
  await assert.rejects(changeAgentComputerControl({
    computer: controlled, userId: 'user-1', action: 'release', request: async () => ({ computer: controlled }),
  }), /Could not confirm computer control/)
  const updated = await changeAgentComputerControl({
    computer: controlled, userId: 'user-1', action: 'release',
    request: async (workspaceId, computerId, action) => {
      assert.deepEqual([workspaceId, computerId, action], ['workspace-1', 'computer-1', 'release'])
      return { computer }
    },
  })
  assert.equal(updated.controlledByUserId, undefined)
})
