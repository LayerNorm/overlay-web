import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import type { Id } from './_generated/dataModel'

/** Where an agent thread works (internal/develop/thread-folders.md): who may choose a Mac and folders, and copy records. */

const modules = import.meta.glob('./**/*.ts')
const secret = 'thread-work-secret'
const now = 1_900_000_000_000
const workspaceId = 'workspace-work'
const fn = (path: string, type: 'mutation' | 'query') => makeFunctionReference<typeof type>(path)

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function seed() {
  const convex = convexTest(schema, modules)
  const ids = await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Work', slug: 'work', status: 'active', createdAt: now, updatedAt: now })
    for (const [userId, principalId] of [['alice', 'p-alice'], ['bob', 'p-bob']]) {
      await ctx.db.insert('workspacePrincipals', { principalId, workspaceId, type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${principalId}`, workspaceId, principalId, role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    }
    await ctx.db.insert('workspacePrincipals', { principalId: 'p-agent', workspaceId, type: 'agent', agentId: 'atlas', displayName: 'Atlas', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId: 'atlas', workspaceId, principalId: 'p-agent', name: 'Atlas', instructions: 'x', harness: 'overlay', visibility: 'workspace',
      modelId: 'm', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'p-alice', createdAt: now, updatedAt: now,
    } as never)
    for (const [environmentId, owner] of [['mac-alice', 'alice'], ['mac-bob', 'bob']]) {
      await ctx.db.insert('agentEnvironments', {
        environmentId, workspaceId, kind: 'local', name: `${owner}'s Mac`, status: 'online', approvedAt: now, approvedByUserId: owner,
        lastSeenAt: now, capabilities: {}, filesystemGrant: { mode: 'selected_roots', roots: [`/Users/${owner}/code`] }, createdAt: now, updatedAt: now,
      } as never)
    }
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'alice', workspaceId, conversationType: 'dm', title: 'Thread', agentId: 'atlas', lastModified: now, createdAt: now,
      lastMode: 'act', askModelIds: [], actModelId: 'm',
    } as never)
    for (const [principalId, principalType] of [['p-alice', 'human'], ['p-bob', 'human'], ['p-agent', 'agent']]) {
      await ctx.db.insert('conversationParticipants', {
        conversationId, workspaceId, principalId, principalType, role: 'member', status: 'active', notificationLevel: 'all', joinedAt: now, updatedAt: now,
      } as never)
    }
    const folderId = await ctx.db.insert('files', {
      userId: 'alice', workspaceId, scope: 'workspace', name: 'Launch', type: 'folder', kind: 'folder', createdAt: now, updatedAt: now,
    })
    const privateFolder = await ctx.db.insert('files', {
      userId: 'bob', workspaceId, scope: 'personal', name: 'Bob only', type: 'folder', kind: 'folder', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('files', { userId: 'alice', workspaceId, scope: 'workspace', name: 'Plan', type: 'file', kind: 'note', parentId: folderId, content: '# Plan', createdAt: now, updatedAt: now })
    return { conversationId, folderId, privateFolder }
  })
  const as = (subject: string) => convex.withIdentity({ subject })
  const args = { workspaceId, agentId: 'atlas', conversationId: ids.conversationId as Id<'conversations'> }
  return { convex, as, args, ...ids }
}

describe('thread work', () => {
  test('a member can pick their own Mac but never a teammate’s', async () => {
    const { as, args } = await seed()
    const set = fn('agents/threadWork:set', 'mutation')
    const own = { computer: { kind: 'mac', environmentId: 'mac-alice' }, folders: [{ source: 'mac', environmentId: 'mac-alice', path: '/Users/alice/code' }] }
    await expect(as('alice').mutation(set, { ...args, work: own })).resolves.toEqual(own)
    await expect(as('alice').mutation(set, { ...args, work: { computer: { kind: 'mac', environmentId: 'mac-bob' }, folders: [] } }))
      .rejects.toThrow(/THREAD_WORK_MAC_UNAVAILABLE/)
    // Bob can still change the thread's folders while Alice's Mac stays chosen, but can't add a folder on her Mac.
    await expect(as('bob').mutation(set, { ...args, work: { computer: { kind: 'mac', environmentId: 'mac-alice' }, folders: [] } })).resolves.toBeTruthy()
    await expect(as('bob').mutation(set, { ...args, work: own })).rejects.toThrow(/THREAD_WORK_MAC_UNAVAILABLE/)
  })

  test('the computer and folder are fixed after the first message', async () => {
    const { convex, as, args, folderId, conversationId } = await seed()
    const set = fn('agents/threadWork:set', 'mutation')
    const chosen = { computer: { kind: 'cloud' }, folders: [{ source: 'overlay', fileId: folderId, name: 'Launch' }] }
    await expect(as('alice').mutation(set, { ...args, work: chosen })).resolves.toEqual(chosen)
    await convex.run(async (ctx) => {
      await ctx.db.insert('conversationMessages', {
        conversationId, userId: 'alice', turnId: 'turn-1', role: 'user', mode: 'act', content: 'Go', contentType: 'text',
        parts: [{ type: 'text', text: 'Go' }], createdAt: now,
      } as never)
    })
    // Saving the same choice again is harmless; any change is refused.
    await expect(as('alice').mutation(set, { ...args, work: chosen })).resolves.toEqual(chosen)
    await expect(as('alice').mutation(set, { ...args, work: { computer: { kind: 'cloud' }, folders: [] } })).rejects.toThrow(/can’t be changed after its first message/)
    await expect(as('alice').mutation(set, { ...args, work: { computer: { kind: 'mac', environmentId: 'mac-alice' }, folders: [] } })).rejects.toThrow(/can’t be changed after its first message/)
  })

  test('folders must be readable and the combination must make sense', async () => {
    const { as, args, folderId, privateFolder } = await seed()
    const set = fn('agents/threadWork:set', 'mutation')
    await expect(as('alice').mutation(set, { ...args, work: { folders: [{ source: 'overlay', fileId: folderId, name: 'Launch' }] } })).resolves.toBeTruthy()
    await expect(as('alice').mutation(set, { ...args, work: { folders: [{ source: 'overlay', fileId: privateFolder, name: 'Bob only' }] } }))
      .rejects.toThrow(/THREAD_WORK_FOLDER_UNAVAILABLE/)
    await expect(as('alice').mutation(set, { ...args, work: { computer: { kind: 'cloud' }, folders: [{ source: 'mac', environmentId: 'mac-alice', path: '/Users/alice/code' }] } }))
      .rejects.toThrow(/only be used by a thread that runs on that computer/)
    await expect(as('alice').mutation(set, { ...args, work: { folders: [{ source: 'github', repository: 'acme/web', installationId: 5 }] } }))
      .rejects.toThrow(/THREAD_WORK_REPOSITORY_UNAVAILABLE/)
  })

  test('options list only the viewer’s own Macs', async () => {
    const { as } = await seed()
    const options = await as('bob').query(fn('agents/threadWork:options', 'query'), { workspaceId, agentId: 'atlas' }) as { macs: Array<{ environmentId: string; roots: string[] }> }
    expect(options.macs.map(mac => mac.environmentId)).toEqual(['mac-bob'])
    expect(options.macs[0]!.roots).toEqual(['/Users/bob/code'])
  })

  test('options say whether the agent has the Local computer tool group', async () => {
    const { convex, as } = await seed()
    const read = async () => (await as('alice').query(fn('agents/threadWork:options', 'query'), { workspaceId, agentId: 'atlas' }) as { localComputer: boolean }).localComputer
    const grant = async (allowedToolIds: string[], isDefault = false) => convex.run(async (ctx) => {
      const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', 'atlas')).unique()
      await ctx.db.patch(agent!._id, { allowedToolIds, isDefault } as never)
    })
    expect(await read()).toBe(false)
    await grant(['capability:local_computer'])
    expect(await read()).toBe(true)
    // The cloud computer group alone does not include the person's own computer.
    await grant(['computer_exec', 'computer_read_file', 'computer_write_file', 'computer_list_files', 'computer_open_url'])
    expect(await read()).toBe(false)
    // The default agent holds every group without listing them.
    await grant([], true)
    expect(await read()).toBe(true)
  })

  test('the one-time update turns Local computer on for existing agents that can edit files, once', async () => {
    const { convex } = await seed()
    const ids = await convex.run(async (ctx) => {
      const make = (agentId: string, allowedToolIds: string[]) => ctx.db.insert('workspaceAgentDefinitions', {
        agentId, workspaceId, principalId: `p-${agentId}`, name: agentId, instructions: 'x', harness: 'overlay', visibility: 'workspace',
        modelId: 'm', allowedToolIds, invocationPolicy: 'mention', createdByPrincipalId: 'p-alice', createdAt: now, updatedAt: now,
      } as never)
      return {
        editor: await make('editor', ['write_file', 'create_folder', 'capability:web_search']),
        reader: await make('reader', ['search_knowledge', 'capability:web_search']),
        already: await make('already', ['write_file', 'capability:local_computer']),
      }
    })
    const migrate = makeFunctionReference<'mutation'>('migrations/grantLocalComputer:run')
    const grants = () => convex.run(async (ctx) => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([name, id]) =>
      [name, ((await ctx.db.get(id)) as { allowedToolIds: string[] }).allowedToolIds.filter((entry) => entry === 'capability:local_computer').length]))))
    expect(await convex.mutation(migrate, { dryRun: true })).toEqual({ granted: 1, isDone: true })
    expect(await grants()).toEqual({ editor: 0, reader: 0, already: 1 })
    expect(await convex.mutation(migrate, {})).toEqual({ granted: 1, isDone: true })
    expect(await grants()).toEqual({ editor: 1, reader: 0, already: 1 })
    expect(await convex.mutation(migrate, {})).toEqual({ granted: 0, isDone: true })
  })

  test('a folder copy lists readable files, and saving back is claimed once', async () => {
    const { convex, folderId, privateFolder } = await seed()
    const subtree = await convex.query(fn('files/folderCopies:subtreeByServer', 'query'), { serverSecret: secret, userId: 'bob', workspaceId, folderId }) as { rows: Array<{ name: string }> }
    expect(subtree.rows.map(row => row.name)).toEqual(['Plan'])
    await expect(convex.query(fn('files/folderCopies:subtreeByServer', 'query'), { serverSecret: secret, userId: 'alice', workspaceId, folderId: privateFolder }))
      .rejects.toThrow(/FOLDER_COPY_FOLDER_UNAVAILABLE/)
    const copy = { serverSecret: secret, copyId: 'run-1:f', agentRunId: 'run-1', conversationId: 'c', workspaceId, userId: 'alice', agentId: 'atlas', target: 'cloud', folderId, folderName: 'Launch', root: '/workspace/Launch' }
    expect(await convex.mutation(fn('files/folderCopies:startByServer', 'mutation'), copy)).toEqual({ created: true, status: 'copying' })
    expect(await convex.mutation(fn('files/folderCopies:startByServer', 'mutation'), copy)).toEqual({ created: false, status: 'copying' })
    const update = fn('files/folderCopies:updateByServer', 'mutation')
    await convex.mutation(update, { serverSecret: secret, copyId: 'run-1:f', status: 'copied', entries: [], folders: [] })
    expect(await convex.mutation(update, { serverSecret: secret, copyId: 'run-1:f', expectedStatus: 'copied', status: 'saving' })).toEqual({ updated: true, status: 'saving' })
    expect(await convex.mutation(update, { serverSecret: secret, copyId: 'run-1:f', expectedStatus: 'copied', status: 'saving' })).toEqual({ updated: false, status: 'saving' })
    await expect(convex.query(fn('files/folderCopies:listForRunByServer', 'query'), { serverSecret: 'wrong', agentRunId: 'run-1' })).rejects.toThrow()
  })
})
