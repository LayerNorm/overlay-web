import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeTargetInheritance,
  isShareAccessRole,
  shareRoleAllows,
  shareRoleOptions,
  shareRoleRejection,
  strongestShareRole,
} from './share-access-policy'

test('viewer, operator, and editor grant strictly widening actions', () => {
  assert.equal(shareRoleAllows('viewer', 'view'), true)
  assert.equal(shareRoleAllows('viewer', 'execute'), false)
  assert.equal(shareRoleAllows('viewer', 'edit'), false)

  assert.equal(shareRoleAllows('operator', 'view'), true)
  assert.equal(shareRoleAllows('operator', 'execute'), true)
  assert.equal(shareRoleAllows('operator', 'edit'), false)

  assert.equal(shareRoleAllows('editor', 'view'), true)
  assert.equal(shareRoleAllows('editor', 'execute'), true)
  assert.equal(shareRoleAllows('editor', 'edit'), true)
})

test('running an automation is separate from editing it', () => {
  assert.equal(shareRoleRejection('automation', 'operator'), null)
  assert.equal(shareRoleRejection('agent', 'operator'), null)
  assert.match(String(shareRoleRejection('file', 'operator')), /automations and agents/)
  assert.match(String(shareRoleRejection('project', 'operator')), /automations and agents/)
  assert.match(String(shareRoleRejection('knowledge_base', 'operator')), /automations and agents/)
})

test('conversations are shareable as view-only', () => {
  assert.equal(shareRoleRejection('conversation', 'viewer'), null)
  assert.match(String(shareRoleRejection('conversation', 'editor')), /view-only/)
  assert.deepEqual(shareRoleOptions('conversation').map((option) => option.value), ['viewer'])
})

test('offered permissions match what the API accepts per resource type', () => {
  assert.deepEqual(shareRoleOptions('file').map((option) => option.value), ['viewer', 'editor'])
  assert.deepEqual(shareRoleOptions('project').map((option) => option.value), ['viewer', 'editor'])
  assert.deepEqual(
    shareRoleOptions('automation').map((option) => option.value),
    ['viewer', 'operator', 'editor'],
  )
  assert.deepEqual(
    shareRoleOptions('agent').map((option) => option.value),
    ['viewer', 'operator', 'editor'],
  )
  for (const option of shareRoleOptions('agent')) {
    assert.equal(shareRoleRejection('agent', option.value), null)
  }
})

test('agent user permission does not describe access to instructions or secrets', () => {
  const operator = shareRoleOptions('agent').find((option) => option.value === 'operator')
  assert.match(String(operator?.description), /without seeing its instructions/)
  const editor = shareRoleOptions('agent').find((option) => option.value === 'editor')
  assert.match(String(editor?.description), /instructions/)
})

test('the strongest role wins when several grants overlap', () => {
  assert.equal(strongestShareRole(['viewer', 'editor', 'operator']), 'editor')
  assert.equal(strongestShareRole(['viewer', 'operator']), 'operator')
  assert.equal(strongestShareRole(['viewer']), 'viewer')
  assert.equal(strongestShareRole([]), undefined)
})

test('team and room targets are disclosed as dynamic, individuals are not', () => {
  assert.match(describeTargetInheritance('team'), /added later/)
  assert.match(describeTargetInheritance('room'), /added later/)
  assert.doesNotMatch(describeTargetInheritance('principal'), /added later/)
})

test('role parsing rejects unknown values', () => {
  assert.equal(isShareAccessRole('editor'), true)
  assert.equal(isShareAccessRole('owner'), false)
  assert.equal(isShareAccessRole(undefined), false)
})
