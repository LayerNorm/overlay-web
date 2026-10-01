import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { fileKeyPrefixForUser } from '../src/shared/storage/storage-keys'

const modules = import.meta.glob('./**/*.ts')
const secret = 'files-text-object-store-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const create = makeFunctionReference<'mutation'>('files/files:create')
const update = makeFunctionReference<'mutation'>('files/files:update')
const get = makeFunctionReference<'query'>('files/files:get')

describe('text kept in object storage', () => {
  test('its row can move to a new owned file key; other files cannot take one by update', async () => {
    const convex = convexTest(schema, modules)
    const prefix = fileKeyPrefixForUser('user_1')
    const large = await convex.mutation(create, {
      userId: 'user_1',
      serverSecret: secret,
      name: 'big.txt',
      type: 'file',
      kind: 'upload',
      r2Key: `${prefix}a/big.txt`,
      textInObjectStore: true,
      content: 'prefix',
      sizeBytesOverride: 900_000,
    })
    const row = await convex.query(get, { fileId: large, userId: 'user_1', serverSecret: secret })
    expect(row).toMatchObject({ textInObjectStore: true, sizeBytes: 900_000, textContent: 'prefix' })

    await convex.mutation(update, {
      userId: 'user_1', serverSecret: secret, fileId: large,
      content: 'prefix v2', r2Key: `${prefix}b/big.txt`, textInObjectStore: true, sizeBytes: 950_000,
    })
    expect(await convex.query(get, { fileId: large, userId: 'user_1', serverSecret: secret }))
      .toMatchObject({ r2Key: `${prefix}b/big.txt`, sizeBytes: 950_000 })

    const plain = await convex.mutation(create, {
      userId: 'user_1', serverSecret: secret, name: 'small.txt', type: 'file', kind: 'upload', content: 'hi',
    })
    await expect(convex.mutation(update, {
      userId: 'user_1', serverSecret: secret, fileId: plain, r2Key: `${prefix}c/other.bin`,
    })).rejects.toThrow(/Invalid storage key/)
    await expect(convex.mutation(update, {
      userId: 'user_1', serverSecret: secret, fileId: large, r2Key: `${fileKeyPrefixForUser('user_2')}x`,
    })).rejects.toThrow(/Invalid storage key/)
  })
})
