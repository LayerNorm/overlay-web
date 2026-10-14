import assert from 'node:assert/strict'
import test from 'node:test'
import { createReleaseFlags } from './feature-flags'

const subject = { userId: 'user_fixture', workspaceId: 'workspace_fixture' }

test('request-local release flags evaluate once with the server-resolved workspace', async () => {
  let calls = 0
  const flags = createReleaseFlags(subject, ['new-editor', 'other-feature', 'new-editor'], { client: () => ({
    evaluateFlags: async (userId, options) => {
      calls++
      assert.equal(userId, subject.userId)
      assert.deepEqual(options.flagKeys, ['new-editor', 'other-feature'])
      assert.deepEqual(options.personProperties, { workspace_id: subject.workspaceId })
      assert.equal(options.disableGeoip, true)
      return { getFlag: key => key === 'new-editor' }
    },
  }) })
  assert.deepEqual(await Promise.all([flags.isEnabled('new-editor'), flags.isEnabled('other-feature')]), [true, false])
  assert.equal(await flags.isEnabled('new-editor'), true)
  assert.equal(calls, 1)
})

test('missing flags, variants, disabled providers and failed requests remain off', async () => {
  for (const value of [undefined, false, 'variant-a', 1]) {
    const flags = createReleaseFlags(subject, ['new-editor'], {
      client: () => ({ evaluateFlags: async () => ({ getFlag: () => value }) }),
    })
    assert.equal(await flags.isEnabled('new-editor'), false)
  }
  for (const client of [() => null, () => { throw new Error('configuration unavailable') },
    () => ({ evaluateFlags: async () => { throw new Error('provider unavailable') } })]) {
    assert.equal(await createReleaseFlags(subject, ['new-editor'], { client }).isEnabled('new-editor'), false)
  }
  const malformed = createReleaseFlags(subject, ['new-editor', 'other-feature'], { client: () => ({
    evaluateFlags: async () => ({ getFlag: key => {
      if (key === 'other-feature') throw new Error('malformed result')
      return true
    } }),
  }) })
  assert.equal(await malformed.isEnabled('new-editor'), false)
})

test('flag evaluations are bounded by a deadline and do not share state across requests', async () => {
  const slow = createReleaseFlags(subject, ['new-editor'], {
    timeoutMs: 5, client: () => ({ evaluateFlags: () => new Promise(() => {}) }),
  })
  assert.equal(await slow.isEnabled('new-editor'), false)
  const fresh = createReleaseFlags(subject, ['new-editor'], {
    client: () => ({ evaluateFlags: async () => ({ getFlag: () => true }) }),
  })
  assert.equal(await fresh.isEnabled('new-editor'), true)
})

test('unknown keys and unresolved subjects never make provider requests', async () => {
  const client = () => { throw new Error('must not be reached') }
  assert.equal(await createReleaseFlags(subject, ['new-editor'], { client }).isEnabled('unknown'), false)
  assert.equal(await createReleaseFlags({ ...subject, userId: '' }, ['new-editor'], { client }).isEnabled('new-editor'), false)
  assert.equal(await createReleaseFlags({ ...subject, workspaceId: '' }, ['new-editor'], { client }).isEnabled('new-editor'), false)
  assert.throws(() => createReleaseFlags(subject, ['../unsafe']))
  assert.throws(() => createReleaseFlags(subject, Array.from({ length: 65 }, (_, i) => 'flag-' + i)))
})
