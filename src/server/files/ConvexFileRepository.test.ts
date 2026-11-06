import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { lazyConvex } from '@/server/database/lazy-convex'
import { ConvexFileRepository } from './ConvexFileRepository'

function secret(t: TestContext) {
  const previous = process.env.INTERNAL_API_SECRET
  process.env.INTERNAL_API_SECRET = 'fixture-internal'
  t.after(() => {
    if (previous === undefined) delete process.env.INTERNAL_API_SECRET
    else process.env.INTERNAL_API_SECRET = previous
  })
}

test('updateFile propagates the authoritative revision acknowledgment', async t => {
  secret(t)
  t.mock.method(lazyConvex, 'mutation', async (path, args, options) => {
    assert.equal(path, 'files/files:update')
    assert.equal(args.returnRevision, true)
    assert.equal(options?.throwOnError, true)
    return { updatedAt: 42 }
  })

  await assert.doesNotReject(async () => {
    assert.deepEqual(await new ConvexFileRepository().updateFile({
      fileId: 'file_1',
      userId: 'user_1',
      expectedUpdatedAt: 41,
    }), { updatedAt: 42 })
  })
})

test('updateFile retries without returnRevision only for an older argument validator', async t => {
  secret(t)
  const calls: Array<Record<string, unknown>> = []
  t.mock.method(lazyConvex, 'mutation', async (_path, args) => {
    calls.push(args)
    if (calls.length === 1) {
      throw new Error('ArgumentValidationError: Object contains extra field `returnRevision`')
    }
    return null
  })

  assert.equal(await new ConvexFileRepository().updateFile({
    fileId: 'file_1',
    userId: 'user_1',
  }), undefined)
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.returnRevision, true)
  assert.equal('returnRevision' in (calls[1] ?? {}), false)
})

test('updateFile does not retry unrelated failures', async t => {
  secret(t)
  let calls = 0
  t.mock.method(lazyConvex, 'mutation', async () => {
    calls += 1
    throw new Error('Network failure while requesting returnRevision')
  })

  await assert.rejects(new ConvexFileRepository().updateFile({
    fileId: 'file_1',
    userId: 'user_1',
  }), /Network failure/)
  assert.equal(calls, 1)
})
