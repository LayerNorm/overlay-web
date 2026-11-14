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

  test('support and billing_admin can read the user directory', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_support', 'support')
    await seedPrincipal(convex, 'user_billing', 'billing_admin')
    await expect(convex.withIdentity({ subject: 'user_support' }).query(query('listUserDirectory'), { serverSecret: adminSecret })).resolves.toEqual([])
    await expect(convex.withIdentity({ subject: 'user_billing' }).query(query('listUserDirectory'), { serverSecret: adminSecret })).resolves.toEqual([])
  })

  test('diagnostic lookup is ID-only, bounded, redacted, and excludes billing-only operators', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_support', 'support')
    await seedPrincipal(convex, 'user_auditor', 'auditor')
    await seedPrincipal(convex, 'user_billing', 'billing_admin')
    await convex.run(async ctx => {
      await ctx.db.insert('harnessDiagnosticIndex', {
        diagnosticId: 'hd_lookup_only', runId: 'run_lookup', workflowRunId: 'workflow_lookup',
        actorUserId: 'actor_lookup', workspaceId: 'workspace_lookup', sourceType: 'conversation',
        sourceId: 'conversation_lookup', operationId: 'tool-call-lookup', code: 'TOOL_FAILED', stage: 'tool',
        retryability: 'user_action', safeMessage: 'A tool could not complete its operation.',
        nextAction: 'Review the failed tool and saved work before continuing.', occurredAt: 101, indexedAt: 102,
      })
      await ctx.db.insert('harnessToolFailures', {
        runId: 'run_lookup', toolCallId: 'tool-call-lookup', workflowRunId: 'workflow_lookup',
        actorUserId: 'actor_lookup', workspaceId: 'workspace_lookup', sourceType: 'conversation',
        sourceId: 'conversation_lookup', toolName: 'computer_open_url', phase: 'pre_dispatch',
        causeClass: 'schema_validation', causeCode: 'INVALID_TOOL_INPUT',
        safeSummary: 'Tool input was rejected before execution.',
        validationIssues: [{ path: ['url'], code: 'invalid_format' }], createdAt: 103,
      })
      await ctx.db.insert('harnessDiagnosticIndex', {
        diagnosticId: 'hd_legacy', runId: 'run_legacy', actorUserId: 'actor_legacy',
        sourceType: 'unknown', code: 'TOOL_OUTCOME_UNKNOWN', stage: 'tool', retryability: 'reconcile',
        safeMessage: 'A tool operation ended without a confirmed outcome.',
        nextAction: 'Check whether the action took effect before retrying it.', occurredAt: 104, indexedAt: 105,
      })
    })
    const lookup = query('lookupHarnessDiagnostic')
    const args = { serverSecret: adminSecret, diagnosticId: 'hd_lookup_only' }
    const support = await convex.withIdentity({ subject: 'user_support' }).query(lookup, args)
    expect(support).toMatchObject({
      found: true, ambiguous: false, runId: 'run_lookup', workflowRunId: 'workflow_lookup',
      causeUnavailable: false,
      toolFailure: { toolName: 'computer_open_url', phase: 'pre_dispatch', causeCode: 'INVALID_TOOL_INPUT',
        validationIssues: [{ path: ['url'], code: 'invalid_format' }] },
    })
    expect(JSON.stringify(support)).not.toContain('file://')
    expect(support).not.toHaveProperty('snapshot')
    expect(support).not.toHaveProperty('transcript')
    expect(support).not.toHaveProperty('input')
    expect(await convex.withIdentity({ subject: 'user_auditor' }).query(lookup, args)).toMatchObject({ found: true })
    await expect(convex.withIdentity({ subject: 'user_billing' }).query(lookup, args)).rejects.toThrow(/Unauthorized/)
    await expect(convex.withIdentity({ subject: 'user_support' }).query(lookup, {
      ...args, serverSecret: internalSecret,
    })).rejects.toThrow(/Unauthorized/)
    await expect(convex.query(lookup, args)).rejects.toThrow(/Unauthorized/)
    await expect(convex.withIdentity({ subject: 'user_support' }).query(lookup, {
      serverSecret: adminSecret, diagnosticId: 'hd_legacy',
    })).resolves.toMatchObject({ found: true, causeUnavailable: true, toolFailure: null })
  })

  test('diagnostic ID collisions return no run instead of a potentially incorrect match', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_support', 'support')
    await convex.run(async ctx => {
      for (const runId of ['collision_a', 'collision_b']) await ctx.db.insert('harnessDiagnosticIndex', {
        diagnosticId: 'hd_collision', runId, actorUserId: 'actor', sourceType: 'unknown',
        code: 'UNKNOWN', stage: 'tool', retryability: 'reconcile', safeMessage: 'A safe summary.',
        nextAction: 'Review before retrying.', occurredAt: 1, indexedAt: 1,
      })
    })
    await expect(convex.withIdentity({ subject: 'user_support' }).query(query('lookupHarnessDiagnostic'), {
      serverSecret: adminSecret, diagnosticId: 'hd_collision',
    })).resolves.toEqual({ found: false, ambiguous: true, diagnosticId: 'hd_collision', causeUnavailable: true })
  })

  test('the user directory lists newest first with name, last active day and plan, and searches', async () => {
    const convex = convexTest(schema, modules)
    await seedPrincipal(convex, 'user_admin', 'admin')
    await convex.run(async (ctx) => {
      await ctx.db.insert('subscriptions', { userId: 'user_old', email: 'old@example.com', firstName: 'Olive', lastName: 'Old' })
      await ctx.db.insert('subscriptions', { userId: 'user_paid', email: 'paid@example.com', name: 'Pat Paid', billingAccountId: 'ba_paid' })
      await ctx.db.insert('billingAccountSubscriptions', {
        billingAccountId: 'ba_paid', provider: 'stripe', planKind: 'paid', planVersion: 'variable_v2', planAmountCents: 2000,
        markupBasisPoints: 2500, status: 'active', autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('growthUserDays', { userId: 'user_paid', day: '2026-10-29' })
      await ctx.db.insert('growthUserDays', { userId: 'user_paid', day: '2026-10-30' })
    })
    const asAdmin = convex.withIdentity(adminIdentity)
    const people = await asAdmin.query(query('listUserDirectory'), { serverSecret: adminSecret })
    expect(people.map((person: { userId: string }) => person.userId)).toEqual(['user_paid', 'user_old'])
    expect(people[0]).toMatchObject({ name: 'Pat Paid', email: 'paid@example.com', lastActiveDay: '2026-10-30', plan: 'paid' })
    expect(people[1]).toMatchObject({ name: 'Olive Old', plan: 'free' })
    expect(people[1].lastActiveDay).toBeUndefined()

    const byName = await asAdmin.query(query('listUserDirectory'), { serverSecret: adminSecret, query: 'olive' })
    expect(byName.map((person: { userId: string }) => person.userId)).toEqual(['user_old'])
    const byId = await asAdmin.query(query('listUserDirectory'), { serverSecret: adminSecret, query: 'user_paid' })
    expect(byId.map((person: { userId: string }) => person.userId)).toEqual(['user_paid'])
  })
})
