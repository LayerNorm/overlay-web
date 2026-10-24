import assert from 'node:assert/strict'
import test from 'node:test'
import { confirmComputerToolRemoval, isAgentEditSaveFailure } from './agent-edit-save-result'

test('cancelling computer removal restores the tool toggle without reporting a save failure', () => {
  const enabledToolGroups = new Set<string>()
  let dirty = true
  let version = 1
  const toggleToolGroup = (groupId: string) => {
    version += 1
    dirty = true
    if (enabledToolGroups.has(groupId)) enabledToolGroups.delete(groupId)
    else enabledToolGroups.add(groupId)
  }

  const result = confirmComputerToolRemoval({
    shouldConfirm: true,
    confirm: () => false,
    revertToggle: () => toggleToolGroup('computer'),
  })

  assert.equal(result, 'cancelled')
  assert.equal(enabledToolGroups.has('computer'), true)
  assert.equal(dirty, true)
  assert.equal(version, 2)
  assert.equal(isAgentEditSaveFailure('cancelled'), false)
})
