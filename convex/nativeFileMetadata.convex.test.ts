import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { NATIVE_POLICY_LEASE_MS } from '@/shared/authorization/native-deployment-policy'

const modules = import.meta.glob('./**/*.ts')
const workspaceId = 'ws-native-files'
const otherWorkspaceId = 'ws-other-files'
const backendUrl = 'https://fixture.convex.cloud'
const now = 1_800_000_000_000
const begin = makeFunctionReference<'mutation'>('platform/nativePolicy:beginRefresh')
const publish = makeFunctionReference<'mutation'>('platform/nativePolicy:publish')
const list = makeFunctionReference<'query'>('files/nativeMetadata:list')
const detail = makeFunctionReference<'query'>('files/nativeMetadata:detail')
const rename = makeFunctionReference<'mutation'>('files/nativeMetadata:rename')
const move = makeFunctionReference<'mutation'>('files/nativeMetadata:move')
const changeScope = makeFunctionReference<'mutation'>('files/nativeMetadata:changeScope')

const snapshot = {
  version: 1 as const,
  backendUrl,
  revision: 'a'.repeat(64),
  features: {
    files: true,
    skills: true,
    mcpServers: true,
    externalAgents: true,
    connectedAgents: true,
    workspaceHandles: false,
  },
  rollout: { stage: 'invited' as const, internalWorkspaceIds: 'internal', invitedWorkspaceIds: 'invited' },
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

type Convex = ReturnType<typeof convexTest>

async function fixture() {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')

  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    for (const ws of [workspaceId, otherWorkspaceId]) {
      await ctx.db.insert('workspaces', {
        workspaceId: ws,
        kind: 'organization',
        name: ws,
        slug: ws,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
    }
    for (const [userId, role, ws] of [
      ['owner', 'owner', workspaceId],
      ['member', 'member', workspaceId],
      ['restricted', 'member', workspaceId],
      ['outsider', 'owner', otherWorkspaceId],
    ] as const) {
      const principalId = `principal-${userId}`
      await ctx.db.insert('workspacePrincipals', {
        principalId,
        workspaceId: ws,
        type: 'human',
        userId,
        displayName: userId,
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: `membership-${userId}`,
        workspaceId: ws,
        principalId,
        role,
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      })
    }
    for (const userId of ['owner', 'member', 'outsider']) {
      const roleId = `files:${userId}`
      await ctx.db.insert('authorizationRoles', {
        roleId,
        name: roleId,
        capabilities: ['files.read', 'files.edit', 'files.share'],
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('authorizationUserRoles', { userId, roleId, createdAt: now })
    }
  })
  return t
}

async function enableFiles(t: Convex, enabled = true) {
  const challenge = '00000000-0000-4000-8000-000000000001'
  const { sequence } = await t.mutation(begin, { challenge })
  return t.mutation(publish, {
    issuedAt: Date.now(),
    sequence,
    challenge,
    snapshot: { ...snapshot, features: { ...snapshot.features, files: enabled } },
  })
}

async function addFile(
  t: Convex,
  options: {
    userId?: string
    workspaceId?: string
    name?: string
    type?: 'file' | 'folder'
    kind?: 'folder' | 'note' | 'upload' | 'output'
    scope?: 'personal' | 'workspace'
    parentId?: Id<'files'>
    updatedAt?: number
  } = {},
): Promise<Id<'files'>> {
  return t.run((ctx) => ctx.db.insert('files', {
    workspaceId: options.workspaceId ?? workspaceId,
    userId: options.userId ?? 'owner',
    name: options.name ?? 'Document.txt',
    type: options.type ?? 'file',
    kind: options.kind ?? 'upload',
    scope: options.scope ?? 'workspace',
    ...(options.parentId ? { parentId: options.parentId } : {}),
    content: 'private content',
    textContent: 'private text',
    textInObjectStore: true,
    r2Key: 'private-storage-key',
    outputUrl: 'https://provider.example/private',
    outputMetadata: { secret: 'private-metadata' },
    prompt: 'private prompt',
    shareToken: 'private-share-token',
    createdAt: now,
    updatedAt: options.updatedAt ?? now,
  }))
}

function asUser(t: Convex, userId: string) {
  return t.withIdentity({ subject: userId })
}

test('identity, membership, role capabilities, and argument validation fail closed', async () => {
  const t = await fixture()
  await enableFiles(t)
  const fileId = await addFile(t)

  await expect(t.query(list, { workspaceId, view: 'workspace' })).rejects.toThrow('UNAUTHENTICATED')
  await expect(asUser(t, 'restricted').query(list, { workspaceId, view: 'workspace' }))
    .rejects.toThrow('CAPABILITY_ACCESS_DENIED')
  await expect(asUser(t, 'member').query(list, { workspaceId: otherWorkspaceId, view: 'workspace' }))
    .rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  await expect(asUser(t, 'member').query(list, { workspaceId, view: 'workspace', userId: 'owner' } as never))
    .rejects.toThrow()
  await expect(asUser(t, 'member').mutation(rename, {
    workspaceId,
    fileId,
    expectedUpdatedAt: now,
    name: 'Spoofed.txt',
    userId: 'owner',
  } as never)).rejects.toThrow()
  await t.run(async (ctx) => {
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', 'member')).unique()
    if (!principal) throw new Error('fixture principal missing')
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId)).unique()
    if (membership) await ctx.db.patch(membership._id, { status: 'suspended' })
  })
  await expect(asUser(t, 'member').query(list, { workspaceId, view: 'workspace' }))
    .rejects.toThrow('WORKSPACE_ACCESS_DENIED')
})

test('deployment policy must be enabled and leased before file metadata is available', async () => {
  const t = await fixture()
  const fileId = await addFile(t)
  await expect(asUser(t, 'owner').query(list, { workspaceId, view: 'workspace' }))
    .rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
  await enableFiles(t, false)
  await expect(asUser(t, 'owner').query(detail, { workspaceId, fileId }))
    .rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
  await enableFiles(t)
  expect(await asUser(t, 'owner').query(detail, { workspaceId, fileId })).not.toBeNull()
  vi.setSystemTime(Date.now() + NATIVE_POLICY_LEASE_MS + 1)
  await expect(asUser(t, 'owner').query(detail, { workspaceId, fileId }))
    .rejects.toThrow('DEPLOYMENT_FEATURE_ACCESS_DENIED')
})

test('non-owner access requires workspace visibility and an active direct, group, or role grant', async () => {
  const t = await fixture()
  await enableFiles(t)
  const fileId = await addFile(t)
  const archivedFileId = await addFile(t, { name: 'Archived.txt' })
  const archived = await asUser(t, 'owner').mutation(changeScope, {
    workspaceId, fileId: archivedFileId, expectedUpdatedAt: now, action: 'archive',
  })
  const parentId = await addFile(t, { name: 'Workspace folder', type: 'folder', kind: 'folder' })
  expect(await asUser(t, 'member').query(detail, { workspaceId, fileId })).toBeNull()
  expect(await asUser(t, 'member').query(list, { workspaceId, view: 'workspace' }))
    .toMatchObject({ nodes: [] })

  await t.run(async (ctx) => {
    await ctx.db.insert('authorizationResourceGrants', {
      grantId: 'direct-file-editor',
      resourceType: 'file',
      resourceId: fileId,
      principalType: 'user',
      principalId: 'member',
      accessRole: 'editor',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('authorizationResourceGrants', {
      grantId: 'direct-archived-file-editor',
      resourceType: 'file',
      resourceId: archivedFileId,
      principalType: 'user',
      principalId: 'member',
      accessRole: 'editor',
      createdAt: now,
      updatedAt: now,
    })
  })
  expect(await asUser(t, 'member').query(detail, { workspaceId, fileId })).toMatchObject({ _id: fileId })
  expect(await asUser(t, 'member').query(list, { workspaceId, view: 'workspace' }))
    .toMatchObject({ nodes: [expect.objectContaining({ _id: fileId })] })
  await expect(asUser(t, 'member').mutation(rename, {
    workspaceId, fileId, expectedUpdatedAt: now, name: 'Member rename.txt',
  })).rejects.toThrow('FILE_ACCESS_DENIED')
  await expect(asUser(t, 'member').mutation(move, {
    workspaceId, fileId, expectedUpdatedAt: now, parentId: null,
  })).rejects.toThrow('FILE_ACCESS_DENIED')
  await expect(asUser(t, 'member').mutation(changeScope, {
    workspaceId, fileId, expectedUpdatedAt: now, action: 'archive',
  })).rejects.toThrow('FILE_ACCESS_DENIED')
  await expect(asUser(t, 'member').mutation(changeScope, {
    workspaceId, fileId: archivedFileId, expectedUpdatedAt: archived!.updatedAt, action: 'restore',
  })).rejects.toThrow('FILE_ACCESS_DENIED')

  await t.run(async (ctx) => {
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', 'member')).unique()
    if (!principal) throw new Error('fixture member principal missing')
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId)).unique()
    if (!membership) throw new Error('fixture member membership missing')
    await ctx.db.patch(membership._id, { role: 'admin' })
  })
  const renamed = await asUser(t, 'member').mutation(rename, {
    workspaceId, fileId, expectedUpdatedAt: now, name: 'Admin grant edit.txt',
  })
  expect(renamed).toMatchObject({ name: 'Admin grant edit.txt' })
  await expect(asUser(t, 'member').mutation(rename, {
    workspaceId, fileId, expectedUpdatedAt: now, name: 'Stale.txt',
  })).rejects.toThrow('FILE_REVISION_CONFLICT')
  const moved = await asUser(t, 'member').mutation(move, {
    workspaceId, fileId, expectedUpdatedAt: renamed.updatedAt, parentId,
  })
  expect(moved).toMatchObject({ parentId })
  const adminArchived = await asUser(t, 'member').mutation(changeScope, {
    workspaceId, fileId, expectedUpdatedAt: moved.updatedAt, action: 'archive',
  })
  expect(adminArchived?.archivedAt).toBeDefined()
  const adminRestored = await asUser(t, 'member').mutation(changeScope, {
    workspaceId, fileId, expectedUpdatedAt: adminArchived!.updatedAt, action: 'restore',
  })
  expect(adminRestored?.archivedAt).toBeUndefined()

  await t.run(async (ctx) => {
    await ctx.db.insert('authorizationGroups', {
      groupId: 'writers',
      name: 'Writers',
      source: 'local',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('authorizationGroupMemberships', {
      groupId: 'writers', userId: 'member', source: 'local', createdAt: now,
    })
    await ctx.db.insert('authorizationResourceGrants', {
      grantId: 'group-file-viewer',
      resourceType: 'file',
      resourceId: fileId,
      principalType: 'group',
      principalId: 'writers',
      accessRole: 'viewer',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('authorizationRoles', {
      roleId: 'resource-reader',
      name: 'Resource reader',
      capabilities: [],
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('authorizationUserRoles', {
      userId: 'member', roleId: 'resource-reader', createdAt: now,
    })
    await ctx.db.insert('authorizationResourceGrants', {
      grantId: 'role-file-viewer',
      resourceType: 'file',
      resourceId: fileId,
      principalType: 'role',
      principalId: 'resource-reader',
      accessRole: 'viewer',
      createdAt: now,
      updatedAt: now,
    })
  })
  expect(await asUser(t, 'member').query(detail, { workspaceId, fileId })).not.toBeNull()
  await t.run(async (ctx) => {
    const group = await ctx.db.query('authorizationGroups')
      .withIndex('by_groupId', (q) => q.eq('groupId', 'writers')).unique()
    if (group) await ctx.db.patch(group._id, { archivedAt: now })
    const role = await ctx.db.query('authorizationRoles')
      .withIndex('by_roleId', (q) => q.eq('roleId', 'resource-reader')).unique()
    if (role) await ctx.db.patch(role._id, { archivedAt: now })
    const directGrant = await ctx.db.query('authorizationResourceGrants')
      .withIndex('by_resource', (q) => q.eq('resourceType', 'file').eq('resourceId', fileId))
      .filter((q) => q.eq(q.field('principalType'), 'user')).first()
    if (directGrant) await ctx.db.delete(directGrant._id)
  })
  expect(await asUser(t, 'member').query(detail, { workspaceId, fileId })).toBeNull()
  expect(await asUser(t, 'member').query(list, { workspaceId, view: 'workspace' }))
    .toMatchObject({ nodes: [] })
})

test('move validates parent workspace, scope, type, and cycles; folder scope and archive operations include descendants', async () => {
  const t = await fixture()
  await enableFiles(t)
  await t.run((ctx) => ctx.db.insert('workspaceSharingPolicies', {
    workspaceId,
    publicLinksEnabled: true,
    memberCanMoveScope: true,
    createdAt: now,
    updatedAt: now,
  }))
  const root = await addFile(t, { name: 'Root', type: 'folder', kind: 'folder', scope: 'personal' })
  const nested = await addFile(t, { name: 'Nested', type: 'folder', kind: 'folder', scope: 'personal', parentId: root })
  const child = await addFile(t, { name: 'Child.txt', scope: 'personal', parentId: nested })
  const workspaceFolder = await addFile(t, { name: 'Workspace folder', type: 'folder', kind: 'folder', scope: 'workspace' })
  const wrongType = await addFile(t, { name: 'Not a folder.txt', scope: 'personal' })
  const foreignParent = await addFile(t, { workspaceId: otherWorkspaceId, name: 'Foreign', type: 'folder', kind: 'folder', scope: 'personal' })

  await expect(asUser(t, 'owner').mutation(move, {
    workspaceId, fileId: child, expectedUpdatedAt: now, parentId: workspaceFolder,
  })).rejects.toThrow('FILE_PARENT_DENIED')
  await expect(asUser(t, 'owner').mutation(move, {
    workspaceId, fileId: child, expectedUpdatedAt: now, parentId: wrongType,
  })).rejects.toThrow('FILE_PARENT_DENIED')
  await expect(asUser(t, 'owner').mutation(move, {
    workspaceId, fileId: child, expectedUpdatedAt: now, parentId: foreignParent,
  })).rejects.toThrow('FILE_PARENT_DENIED')
  await expect(asUser(t, 'owner').mutation(move, {
    workspaceId, fileId: root, expectedUpdatedAt: now, parentId: nested,
  })).rejects.toThrow('FILE_PARENT_CYCLE')

  const moved = await asUser(t, 'owner').mutation(changeScope, {
    workspaceId, fileId: root, expectedUpdatedAt: now, action: 'move', to: 'workspace',
  })
  expect(moved).toMatchObject({ _id: root, scope: 'workspace', parentId: null })
  const movedRows = await t.run(async (ctx) => Promise.all([root, nested, child].map((id) => ctx.db.get(id))))
  expect(movedRows.map((row) => row?.scope)).toEqual(['workspace', 'workspace', 'workspace'])
  const archived = await asUser(t, 'owner').mutation(changeScope, {
    workspaceId, fileId: root, expectedUpdatedAt: moved.updatedAt, action: 'archive',
  })
  expect(archived?.archivedAt).toBeDefined()
  const archivedRows = await t.run(async (ctx) => Promise.all([root, nested, child].map((id) => ctx.db.get(id))))
  expect(archivedRows.every((row) => row?.archivedAt === archived?.archivedAt)).toBe(true)
  const restored = await asUser(t, 'owner').mutation(changeScope, {
    workspaceId, fileId: root, expectedUpdatedAt: archived!.updatedAt, action: 'restore',
  })
  expect(restored?.scope).toBe('workspace')
  expect(restored?.archivedAt).toBeUndefined()
  const restoredRows = await t.run(async (ctx) => Promise.all([root, nested, child].map((id) => ctx.db.get(id))))
  expect(restoredRows.every((row) => row?.archivedAt === undefined && row.scope === 'workspace')).toBe(true)
})

test('corrupt and oversized subtrees abort without partial archive writes', async () => {
  const t = await fixture()
  await enableFiles(t)
  const corruptRoot = await addFile(t, { name: 'Corrupt root', type: 'folder', kind: 'folder', scope: 'personal' })
  const corruptChild = await addFile(t, {
    name: 'Wrong scope', scope: 'workspace', parentId: corruptRoot,
  })
  const largeRoot = await addFile(t, { name: 'Large root', type: 'folder', kind: 'folder', scope: 'personal' })
  const oversized = await t.run(async (ctx) => {
    const ids: Id<'files'>[] = []
    for (let index = 0; index < 501; index++) {
      ids.push(await ctx.db.insert('files', {
        workspaceId, userId: 'owner', name: `Child ${index}`, type: 'file', kind: 'upload',
        scope: 'personal', parentId: largeRoot, createdAt: now, updatedAt: now,
      }))
    }
    return ids
  })

  await expect(asUser(t, 'owner').mutation(changeScope, {
    workspaceId, fileId: corruptRoot, expectedUpdatedAt: now, action: 'archive',
  })).rejects.toThrow('FILE_SUBTREE_DENIED')
  await expect(asUser(t, 'owner').mutation(changeScope, {
    workspaceId, fileId: largeRoot, expectedUpdatedAt: now, action: 'archive',
  })).rejects.toThrow('FILE_SUBTREE_TOO_LARGE')
  const rows = await t.run(async (ctx) => Promise.all([corruptRoot, corruptChild, largeRoot, oversized[0]!].map((id) => ctx.db.get(id))))
  expect(rows.every((row) => row?.archivedAt === undefined)).toBe(true)
})

test('native file metadata redacts content and storage fields', async () => {
  const t = await fixture()
  await enableFiles(t)
  const fileId = await addFile(t, { userId: 'owner' })
  const initial = await asUser(t, 'owner').query(detail, { workspaceId, fileId })
  expect(initial).toMatchObject({
    _id: fileId,
    name: 'Document.txt',
    workspaceId,
    userId: 'owner',
    isStorageBacked: true,
  })
  for (const key of ['content', 'textContent', 'storageId', 'r2Key', 'outputUrl', 'outputMetadata', 'prompt', 'shareToken']) {
    expect(Object.keys(initial)).not.toContain(key)
  }
  expect(JSON.stringify(initial)).not.toContain('private content')
  expect(JSON.stringify(initial)).not.toContain('private text')
  expect(JSON.stringify(initial)).not.toContain('private-storage-key')
  expect(JSON.stringify(initial)).not.toContain('private-share-token')
  expect(JSON.stringify(initial)).not.toContain('provider.example')
  expect(JSON.stringify(initial)).not.toContain('private prompt')
})
