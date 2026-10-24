// @vitest-environment node

import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { WorkspaceService } from '../src/server/workspaces/WorkspaceService'
import { ConvexWorkspaceRepository } from '../src/server/workspaces/ConvexWorkspaceRepository'
import type { WorkspaceRepository } from '../src/server/workspaces/WorkspaceRepository'
import type { WorkspaceAccess } from '../packages/overlay-workspace-contracts/src/types'
import { toWorkspaceSummaryWithRoutingHandle } from '../src/server/app-api/v1/workspaces/presentation'
import { buildWorkspaceHref, readWorkspaceRouteTarget } from '../src/shared/workspaces/routing'

const { lazyConvexMutation } = vi.hoisted(() => ({
  lazyConvexMutation: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/database/lazy-convex', () => ({
  lazyConvex: {
    query: vi.fn(),
    mutation: lazyConvexMutation,
    action: vi.fn(),
  },
}))
vi.mock('@/server/shared/internal-api-secret', () => ({
  getInternalApiSecret: () => secret,
}))

const modules = import.meta.glob('./**/*.ts')
const secret = 'workspace-handle-rollout-test-secret'
const now = 1_900_000_000_000
const ensurePersonal = makeFunctionReference<'mutation'>(
  'collaboration/workspaces:ensurePersonalWorkspaceByServer',
)
const resolveHandle = makeFunctionReference<'query'>(
  'collaboration/workspaces:resolveWorkspaceHandleByServer',
)
const createOrganization = makeFunctionReference<'mutation'>(
  'collaboration/workspaces:createOrganizationByServer',
)

const previousInternalSecret = process.env.INTERNAL_API_SECRET
const previousHandleWrites = process.env.OVERLAY_WORKSPACE_HANDLE_WRITES_ENABLED

beforeAll(() => {
  process.env.INTERNAL_API_SECRET = secret
  process.env.OVERLAY_WORKSPACE_HANDLE_WRITES_ENABLED = 'false'
})

afterAll(() => {
  if (previousInternalSecret === undefined) delete process.env.INTERNAL_API_SECRET
  else process.env.INTERNAL_API_SECRET = previousInternalSecret
  if (previousHandleWrites === undefined) delete process.env.OVERLAY_WORKSPACE_HANDLE_WRITES_ENABLED
  else process.env.OVERLAY_WORKSPACE_HANDLE_WRITES_ENABLED = previousHandleWrites
})

test('unregistered personal handles stay unresolved while ID navigation remains available', async () => {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'personal-workspace-123',
      kind: 'personal',
      name: 'Personal',
      slug: 'personal-user-123',
      status: 'active',
      createdByPrincipalId: 'principal-user-123',
      personalOwnerUserId: 'user-123',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'principal-user-123',
      workspaceId: 'personal-workspace-123',
      type: 'human',
      userId: 'user-123',
      displayName: 'User 123',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: 'membership-user-123',
      workspaceId: 'personal-workspace-123',
      principalId: 'principal-user-123',
      role: 'owner',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    })
  })

  const access = await convex.mutation(ensurePersonal, {
    serverSecret: secret,
    workspaceId: 'unused-workspace',
    principalId: 'unused-principal',
    membershipId: 'unused-membership',
    userId: 'user-123',
    displayName: 'User 123',
    workspaceName: 'Personal',
    slug: 'personal-new-handle',
    now: now + 1,
  }) as { workspace: { workspaceId: string }; membership: { role: string } }
  expect(access.workspace.workspaceId).toBe('personal-workspace-123')
  expect(access.membership.role).toBe('owner')
  expect(await convex.run(async (ctx) => ctx.db.query('workspaceHandles').collect())).toEqual([])
  expect(await convex.query(resolveHandle, {
    serverSecret: secret,
    handle: 'personal-user-123',
    userId: 'user-123',
  })).toBeNull()

  const summary = await toWorkspaceSummaryWithRoutingHandle({
    async resolveWorkspaceHandle({ userId, handle }) {
      return await convex.query(resolveHandle, { serverSecret: secret, userId, handle })
    },
  }, 'user-123', {
    workspace: {
      id: 'personal-workspace-123',
      kind: 'personal',
      name: 'Personal',
      slug: 'personal-user-123',
      status: 'active',
      createdByPrincipalId: 'principal-user-123',
      createdAt: now,
      updatedAt: now,
    },
    principal: {
      id: 'principal-user-123',
      workspaceId: 'personal-workspace-123',
      type: 'human',
      userId: 'user-123',
      displayName: 'User 123',
      createdAt: now,
      updatedAt: now,
    },
    membership: {
      workspaceId: 'personal-workspace-123',
      principalId: 'principal-user-123',
      role: 'owner',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    },
  } satisfies WorkspaceAccess)
  expect(summary.slug).toBe('personal-user-123')
  expect(summary).not.toHaveProperty('routingHandle')

  const idHref = buildWorkspaceHref('personal-workspace-123', '/app/chat')
  expect(readWorkspaceRouteTarget(idHref)).toEqual({
    kind: 'id',
    value: 'personal-workspace-123',
  })
})

test('disabled handle writes create organizations with safe slugs and no handle metadata', async () => {
  const convex = convexTest(schema, modules)
  const calls: Array<{ path: string; args: Record<string, unknown> }> = []
  let suffix = 0
  lazyConvexMutation.mockReset()
  lazyConvexMutation.mockImplementation((path: string, args: Record<string, unknown>) => {
    calls.push({ path, args })
    return convex.mutation(createOrganization, args as never)
  })

  const repository = new ConvexWorkspaceRepository()
  let nextId = 0
  const service = new WorkspaceService({
    listForUser: async () => [],
    createOrganization: repository.createOrganization.bind(repository),
  } as unknown as WorkspaceRepository, {
    createId: () => `workspace-${++nextId}`,
    now: () => now,
    workspaceHandleWritesEnabled: () => false,
    createHandleSuffix: () => `suffix${++suffix}`,
  })

  for (const name of ['X', 'Admin']) {
    const created = await service.createOrganization({
      actorUserId: 'owner-user',
      name,
    })
    const call = calls.at(-1)!
    expect(call.path).toBe('collaboration/workspaces:createOrganizationByServer')
    expect(created.workspace.name).toBe(name)
    expect(call.args).toMatchObject({
      name,
      slug: expect.stringMatching(/^workspace-suffix\d+$/),
    })
    expect(call.args).not.toHaveProperty('handleExplicit')
    expect(call.args).not.toHaveProperty('handleSuffixes')
    expect(created.workspace.slug).toBe(call.args.slug)
  }
})
