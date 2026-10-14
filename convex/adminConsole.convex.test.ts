import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const adminSecret = 'admin-console-secret'
const internalSecret = 'web-internal-secret'

beforeAll(() => {
  process.env.ADMIN_API_SECRET = adminSecret
  process.env.INTERNAL_API_SECRET = internalSecret
})

const query = (name: string) => makeFunctionReference<'query'>(`admin/console:${name}`)
const mutation = (name: string) => makeFunctionReference<'mutation'>(`admin/console:${name}`)

const adminIdentity = { subject: 'user_admin' }

async function seedPrincipal(
  convex: ReturnType<typeof convexTest>,
  userId: string,
  role: 'admin' | 'auditor' | 'billing_admin' | 'support',
  revokedAt?: number,
) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('administrativePrincipals', {
      userId,
      role,
      createdAt: 1,
      updatedAt: 1,
      revokedAt,
    })
  })
}

const roleArgs = {
  serverSecret: adminSecret,
  roleId: 'role_1',
  name: 'Support Leads',
  capabilities: ['admin.view'],
  isSystem: false,
}

describe('admin console functions', () => {
  test('the internal secret is rejected by every console function', async () => {
    const convex = convexTest(schema, modules)
    const asAdmin = convex.withIdentity(adminIdentity)
    await seedPrincipal(convex, 'user_admin', 'admin')
    await expect(asAdmin.query(query('listRoles'), { serverSecret: internalSecret, includeArchived: false })).rejects.toThrow(/Unauthorized/)
    await expect(asAdmin.mutation(mutation('createRole'), { ...roleArgs, serverSecret: internalSecret })).rejects.toThrow(/Unauthorized/)
    await expect(asAdmin.query(query('listAudit'), { serverSecret: internalSecret })).rejects.toThrow(/Unauthorized/)
    await expect(asAdmin.query(query('listUserDirectory'), { serverSecret: internalSecret })).rejects.toThrow(/Unauthorized/)
  })

  test('the admin secret without an operator identity is rejected', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_admin', 'admin')
    await expect(convex.query(query('listRoles'), { serverSecret: adminSecret, includeArchived: false })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('createRole'), roleArgs)).rejects.toThrow(/Unauthorized/)
  })

  test('a revoked operator is rejected', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_admin', 'admin', Date.now())
    const asAdmin = convex.withIdentity(adminIdentity)
    await expect(asAdmin.query(query('listRoles'), { serverSecret: adminSecret, includeArchived: false })).rejects.toThrow(/Unauthorized/)
    await expect(asAdmin.mutation(mutation('createRole'), roleArgs)).rejects.toThrow(/Unauthorized/)
  })

  test('an auditor can list audit events but cannot write', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_auditor', 'auditor')
    const asAuditor = convex.withIdentity({ subject: 'user_auditor' })
    await expect(asAuditor.query(query('listAudit'), { serverSecret: adminSecret })).resolves.toEqual([])
    await expect(asAuditor.query(query('listRoles'), { serverSecret: adminSecret, includeArchived: false })).resolves.toEqual([])
    await expect(asAuditor.mutation(mutation('createRole'), roleArgs)).rejects.toThrow(/Unauthorized/)
    await expect(asAuditor.mutation(mutation('grantPrincipal'), {
      serverSecret: adminSecret,
      grantedBy: 'user_auditor',
      role: 'support',
      userId: 'user_other',
    })).rejects.toThrow(/Unauthorized/)
  })

  test('each write records its own audit row', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_admin', 'admin')
    const asAdmin = convex.withIdentity(adminIdentity)
    await asAdmin.mutation(mutation('createRole'), roleArgs)
    await asAdmin.mutation(mutation('grantPrincipal'), {
      serverSecret: adminSecret,
      grantedBy: 'user_admin',
      role: 'support',
      userId: 'user_new',
    })
    const rows = await convex.run(async (ctx) => await ctx.db.query('auditEvents').collect())
    const actions = rows.map((row) => row.action).sort()
    expect(actions).toEqual(['administration.principal.grant', 'authorization.role.create'])
    expect(rows[0].actorUserId).toBe('user_admin')
  })

  test('support reads the user directory, billing_admin cannot', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_support', 'support')
    await seedPrincipal(convex, 'user_billing', 'billing_admin')
    await expect(convex.withIdentity({ subject: 'user_support' }).query(query('listUserDirectory'), { serverSecret: adminSecret })).resolves.toEqual([])
    await expect(convex.withIdentity({ subject: 'user_billing' }).query(query('listUserDirectory'), { serverSecret: adminSecret })).rejects.toThrow(/Unauthorized/)
  })
})
