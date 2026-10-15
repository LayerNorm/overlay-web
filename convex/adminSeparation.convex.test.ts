import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import * as legacyAdmin from './admin/administration'
import * as legacyAuthorization from './admin/authorization'
import * as users from './auth/users'
const modules = import.meta.glob('./**/*.ts')

describe('customer/operator separation', () => {
  test('legacy operator reads and writes are absent', () => {
    expect(Object.keys(legacyAdmin)).toEqual(['appendAuditByServer'])
    expect(Object.keys(legacyAuthorization).every(name => /^(get|list)/.test(name))).toBe(true)
    expect(users).not.toHaveProperty('listUserDirectoryByServer')
  })
  test('customer audit remains append-only while operator reads require separate authentication', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    process.env.ADMIN_API_SECRET = 'operator-test-only'
    const t = convexTest(schema, modules)
    await t.mutation(makeFunctionReference<'mutation'>('admin/administration:appendAuditByServer'), {
      serverSecret: 'web-test-only', eventId: 'event_1', actorType: 'service', action: 'operational.test',
      resourceType: 'test', outcome: 'success', metadataJson: '{}', createdAt: 1,
    })
    await expect(t.query(makeFunctionReference<'query'>('admin/console:listAudit'), { serverSecret: 'web-test-only' })).rejects.toThrow(/Unauthorized/)
    await expect(t.query(makeFunctionReference<'query'>('admin/console:listAudit'), { serverSecret: 'operator-test-only' })).rejects.toThrow(/Unauthorized/)
    expect(await t.run(async ctx => (await ctx.db.query('auditEvents').collect()).length)).toBe(1)
  })
})
