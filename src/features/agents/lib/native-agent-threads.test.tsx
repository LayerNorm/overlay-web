import React, { useLayoutEffect } from 'react'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { NativeCollaborationContext, emptyNativeCollaboration, type NativeCollaborationValue } from '@/components/providers/native-collaboration-context'
import { NativeThreadOverlayProvider, useNativeThreadClient, useNativeThreadList } from '@/components/providers/native-agent-threads'
import { useAgentThreadScope } from '@/features/agents/lib/use-agent-thread-scope'
import { useAgentActionsSource } from '@/components/layout/sidebar/nativeAgentActions'
import type { useAgentActions } from '@/components/layout/AppSidebarAgentsPanel'
import { useAgentAutoOpen } from '../components/use-agent-auto-open'

const require = createRequire(import.meta.url)
const { act, create } = require('react-test-renderer') as typeof import('react-test-renderer')
const mocks = vi.hoisted(() => ({ listThreads: vi.fn(), paginated: vi.fn(), mutation: vi.fn(), watch: vi.fn(), push: vi.fn(), replace: vi.fn(),
  announce: vi.fn<(_args: { name: string; undo: () => Promise<unknown> }) => void>() }))
vi.mock('convex/react', () => ({ usePaginatedQuery: mocks.paginated }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }), useSearchParams: () => new URLSearchParams(window.location.search) }))
vi.mock('@/shared/app/overlay-app-client', () => ({ overlayAppClient: { agents: { listThreads: mocks.listThreads } } }))
vi.mock('@/shared/app/archive-toast', () => ({ announceArchived: mocks.announce }))

const row = { conversationId: 'thread', workspaceId: 'workspace', agentId: 'agent', viewerUserId: 'alice', title: 'Thread', createdAt: 1, lastModified: 1, isMain: true, archivedAt: undefined as number | undefined }
let queryRow: typeof row | null | undefined
let pageRows: typeof row[]
const listeners = new Set<() => void>()
const fakeClient = { mutation: mocks.mutation, watchQuery: mocks.watch } as unknown as ConvexReactClient
const ready = { ...emptyNativeCollaboration, status: 'ready' as const, workspaceId: 'workspace', viewerUserId: 'alice', scopeKey: 'alice:workspace', client: fakeClient, isCurrentScope: () => true }
let scope!: ReturnType<typeof useAgentThreadScope>
let client!: ReturnType<typeof useNativeThreadClient>
let list!: ReturnType<typeof useNativeThreadList>
let actions!: ReturnType<typeof useAgentActionsSource>
const legacy = { openThread: vi.fn() } as unknown as ReturnType<typeof useAgentActions>
const agent = { id: 'agent', principalId: 'agent-p', createdByPrincipalId: 'alice' } as WorkspaceAgentDirectoryItem
let renderer: ReturnType<typeof create> | undefined

function ListProbe() {
  const value = useNativeThreadList('agent')
  useLayoutEffect(() => { list = value })
  return null
}
type ProbeProps = { conversationId?: string; agentId?: string; directory?: WorkspaceAgentDirectoryItem[] }
function Probe({ conversationId = 'thread', agentId = 'agent', directory = [] }: ProbeProps) {
  const scopeValue = useAgentThreadScope({ workspaceId: 'workspace', agentId, conversationId, directory, retryCount: 0 })
  const clientValue = useNativeThreadClient()
  const actionsValue = useAgentActionsSource({ workspaceId: 'workspace', baseHref: '/app/agents', buildWorkspaceHref: (_w, href) => href, view: 'personal',
    bundles: {}, setBundles: () => {}, loadBundle: async () => {}, activeAgentId: 'agent', activeConversationId: 'thread', sortedAgents: [agent] }, legacy)
  useLayoutEffect(() => { scope = scopeValue; client = clientValue; actions = actionsValue })
  return clientValue.status === 'ready' ? <ListProbe /> : null
}
function tree(value: NativeCollaborationValue = ready, props: ProbeProps = {}) {
  return <NativeCollaborationContext.Provider value={value}><NativeThreadOverlayProvider key={value.scopeKey}><Probe {...props} /></NativeThreadOverlayProvider></NativeCollaborationContext.Provider>
}
function move(href: string) {
  const url = new URL(href, 'https://workspace.test')
  Object.assign(window.location, { pathname: url.pathname, search: url.search })
}

function AutoOpenProbe({ track }: { track?: boolean }) {
  const native = useNativeThreadClient()
  useLayoutEffect(() => { if (track) return native.track('create:original-request') }, [native, track])
  useAgentAutoOpen({ activeWorkspaceId: 'workspace', agentId: 'agent', conversationId: null,
    directory: [agent], viewerPrincipalId: 'alice', scope: 'personal', buildHref: (_w, href) => href, retryCount: 0,
    router: { replace: mocks.replace }, onError: () => {}, onResolvingChange: () => {} })
  return null
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('window', { location: { pathname: '/app/agents', search: '?agent=agent&id=thread' }, dispatchEvent: () => true })
  queryRow = row
  pageRows = [row]
  mocks.watch.mockImplementation(() => ({ localQueryResult: () => queryRow, onUpdate: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback) } } }))
  mocks.paginated.mockImplementation(() => ({ results: pageRows, status: 'Exhausted', loadMore: vi.fn() }))
  mocks.mutation.mockResolvedValue(null)
  mocks.listThreads.mockResolvedValue({ threads: [] })
  mocks.push.mockImplementation(move)
  mocks.replace.mockImplementation(move)
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; listeners.clear(); vi.unstubAllGlobals() })

describe('native agent thread ownership', () => {
  it('hard-loaded pending destinations resume creation idempotently', async () => {
    move('/app/agents?agent=agent&nativePending=create%3Aoriginal-request')
    mocks.mutation.mockResolvedValue({ conversationId: 'recovered', title: 'Recovered' })
    await act(async () => { renderer = create(<NativeCollaborationContext.Provider value={ready}><NativeThreadOverlayProvider><AutoOpenProbe /></NativeThreadOverlayProvider></NativeCollaborationContext.Provider>) })
    expect(getFunctionName(mocks.mutation.mock.calls[0][0])).toBe('agents/nativeThreads:createThread')
    expect(mocks.mutation.mock.calls[0][1]).toMatchObject({ agentId: 'agent', clientRequestId: 'original-request' })
    expect(window.location.search).toContain('id=recovered')
    expect(window.location.search).not.toContain('nativePending')
  })

  it('an owned pending operation is not started again by the destination shell', async () => {
    move('/app/agents?agent=agent&nativePending=create%3Aoriginal-request')
    await act(async () => { renderer = create(<NativeCollaborationContext.Provider value={ready}><NativeThreadOverlayProvider><AutoOpenProbe track /></NativeThreadOverlayProvider></NativeCollaborationContext.Provider>) })
    expect(mocks.mutation).not.toHaveBeenCalled()
    expect(window.location.search).toContain('nativePending')
  })

  it('uses exact getThread without a directory membership check or downloading HTTP threads; null revokes immediately', async () => {
    await act(async () => { renderer = create(tree()) })
    expect(scope).toMatchObject({ allowed: true, pending: false })
    expect(getFunctionName(mocks.watch.mock.calls[0][0])).toBe('agents/nativeThreads:getThread')
    expect(mocks.listThreads).not.toHaveBeenCalled()
    await act(async () => { queryRow = null; listeners.forEach(callback => callback()) })
    expect(scope).toMatchObject({ allowed: false, pending: false, error: 'This thread is not available for this agent.' })
  })

  it('never admits a cached prior room, agent, workspace or account row', async () => {
    await act(async () => { renderer = create(tree()) })
    expect(scope.allowed).toBe(true)
    for (const props of [{ conversationId: 'other-thread' }, { agentId: 'other-agent' }]) {
      await act(async () => renderer!.update(tree(ready, props)))
      expect(scope.allowed).toBe(false)
    }
    await act(async () => renderer!.update(tree({ ...ready, viewerUserId: 'bob', scopeKey: 'bob:workspace' })))
    expect(scope.allowed).toBe(false)
    expect(list.rows).toEqual([])
    await act(async () => renderer!.update(tree({ ...ready, workspaceId: 'other-workspace', scopeKey: 'alice:other' })))
    expect(scope.allowed).toBe(false)
    expect(list.rows).toEqual([])
  })

  it('disabled keeps legacy actions and does not issue any native query', async () => {
    await act(async () => { renderer = create(tree({ ...ready, status: 'disabled' }, { directory: [agent] })) })
    expect(actions).toBe(legacy)
    expect(mocks.watch).not.toHaveBeenCalled()
    expect(mocks.paginated).not.toHaveBeenCalled()
    expect(mocks.mutation).not.toHaveBeenCalled()
    expect(mocks.listThreads).toHaveBeenCalledWith('workspace', 'agent')
  })

  it('empty canonical queries stay empty, and unavailable never falls back to legacy', async () => {
    queryRow = undefined
    pageRows = []
    await act(async () => { renderer = create(tree()) })
    expect(scope).toMatchObject({ allowed: false, pending: true })
    expect(list.rows).toEqual([])
    await act(async () => renderer!.update(tree({ ...ready, status: 'unavailable' })))
    expect(scope).toMatchObject({ allowed: false, pending: false })
    await expect(client.resolve('agent')).rejects.toThrow('unavailable')
    expect(mocks.listThreads).not.toHaveBeenCalled()
    expect(mocks.mutation).not.toHaveBeenCalled()
  })

  it('archive hides immediately and moves selection; Undo after navigation does not resurrect the old selection', async () => {
    let release!: (value: null) => void
    mocks.mutation.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await act(async () => { renderer = create(tree()) })
    let archived!: Promise<void>
    await act(async () => { archived = actions.archiveThread(agent, 'thread', true) })
    expect(list.rows).toEqual([])
    expect(window.location.search).toContain('nativePending=')
    expect(new URLSearchParams(window.location.search).has('id')).toBe(false)
    await act(async () => { pageRows = [{ ...row, archivedAt: 10 }]; release(null); await archived })
    expect(new URLSearchParams(window.location.search).has('id')).toBe(false)
    move('/app/agents?agent=other&id=elsewhere')
    mocks.push.mockClear(); mocks.replace.mockClear()
    await act(async () => { pageRows = [row]; await mocks.announce.mock.calls[0][0].undo() })
    expect(window.location.search).toBe('?agent=other&id=elsewhere')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(list.rows).toHaveLength(1)
  })

  it('failed archive removes only its own entry, not the later restore overlay', async () => {
    let fail!: (error: Error) => void, finish!: (value: null) => void
    mocks.mutation.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => { renderer = create(tree()) })
    let first!: Promise<unknown>, second!: Promise<unknown>
    await act(async () => { first = client.archive('agent', 'thread', true).catch(error => error) })
    expect(list.rows).toHaveLength(0)
    await act(async () => { second = client.archive('agent', 'thread', false) })
    expect(list.rows).toHaveLength(1)
    await act(async () => { fail(new Error('denied')); await first })
    expect(list.rows).toHaveLength(1)
    await act(async () => { finish(null); await second })
    expect(list.rows).toHaveLength(1)
  })

  it('publishes Undo before archive resolves and a faster restore does not reveal the stale archive intent', async () => {
    let finishArchive!: (value: null) => void
    mocks.mutation.mockImplementationOnce(() => new Promise(resolve => { finishArchive = resolve })).mockResolvedValueOnce(null)
    await act(async () => { renderer = create(tree()) })
    let archive!: Promise<void>
    await act(async () => { archive = actions.archiveThread(agent, 'thread', true) })
    expect(list.rows).toHaveLength(0)
    expect(mocks.announce).toHaveBeenCalledTimes(1)
    await act(async () => { await mocks.announce.mock.calls[0][0].undo() })
    expect(list.rows).toHaveLength(1)
    const location = window.location.search
    await act(async () => { finishArchive(null); await archive })
    expect(list.rows).toHaveLength(1)
    expect(window.location.search).toBe(location)
  })
})
