import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceHandleCandidate,
  validateWorkspaceHandleAddress,
  validateWorkspaceHandleInput,
  workspaceHandleBaseFromName,
} from './handle-policy'

test('explicit handles normalize case and whitespace and reject malformed or reserved values', () => {
  assert.deepEqual(validateWorkspaceHandleInput(' Acme-Labs '), { ok: true, handle: 'acme-labs' })
  for (const handle of ['ab', '-acme', 'acme-', 'acme--labs', 'acme_labs', 'a'.repeat(64)]) {
    assert.equal(validateWorkspaceHandleInput(handle).ok, false, handle)
  }
  assert.deepEqual(validateWorkspaceHandleInput('admin'), { ok: false, reason: 'reserved' })
  assert.deepEqual(validateWorkspaceHandleInput('personal-random'), { ok: false, reason: 'reserved' })
})

test('generated personal addresses remain routable while name-based handles are stable', () => {
  assert.deepEqual(validateWorkspaceHandleAddress('personal-random'), { ok: true, handle: 'personal-random' })
  assert.equal(workspaceHandleBaseFromName('  Acme / Labs!  '), 'acme-labs')
  assert.equal(buildWorkspaceHandleCandidate('a'.repeat(63), '123456'), `${'a'.repeat(56)}-123456`)
})
