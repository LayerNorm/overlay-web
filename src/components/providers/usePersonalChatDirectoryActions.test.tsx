import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, memo, useMemo } from 'react'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import type { OptimisticLocalStore } from 'convex/browser'
import type { Id } from '../../../convex/_generated/dataModel'
import type { PersonalChatSummary } from './PersonalChatProvider'
import {
  PersonalChatDirectoryProvider,
  usePersonalChatDirectory,
  type PersonalChatDirectoryValue,
} from './personal-chat-directory-context'
import { usePersonalChatDirectoryActions } from './usePersonalChatDirectoryActions'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}

type MutationCall = { args: unknown; options: unknown }

function captureMutations(client: ConvexReactClient): MutationCall[] {
  const calls: MutationCall[] = []
  Object.defineProperty(client, 'mutation', {
    configurable: true,
    value: (_reference: unknown, args: unknown, options: unknown) => {
      calls.push({ args, options })
      return Promise.resolve(undefined)
    },
  })
  return calls
}

function createOptimisticStore(summary: PersonalChatSummary) {
  let currentSummary = summary
  const listQuery = {
    args: { workspaceId: summary.workspaceId, archived: false },
    value: { page: [summary] },
  }
  const store = {
    getAllQueries: () => [listQuery],
    getQuery: () => currentSummary,
    setQuery: (_query: unknown, _args: unknown, value: unknown) => {
      if (value && typeof value === 'object' && 'page' in value) {
        listQuery.value = value as typeof listQuery.value
      } else {
        currentSummary = value as PersonalChatSummary
      }
    },
  } as unknown as OptimisticLocalStore
  return {
    store,
    summary: () => currentSummary,
    listRows: () => listQuery.value.page,
  }
}

function applyOptimisticUpdate(call: MutationCall, store: OptimisticLocalStore) {
  const update = (call.options as { optimisticUpdate?: unknown } | undefined)?.optimisticUpdate
  assert.equal(typeof update, 'function')
  ;(update as (store: OptimisticLocalStore, args: unknown) => void)(store, call.args)
}

test('directory actions stay stable for transcript updates and keep workspace/client mutations fresh', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', original)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })

  const clientA = new ConvexReactClient('https://personal-chat-a.convex.cloud')
  const clientB = new ConvexReactClient('https://personal-chat-b.convex.cloud')
  const callsA = captureMutations(clientA)
  const callsB = captureMutations(clientB)
  const conversationId = 'conversation-a' as Id<'conversations'>
  const messageId = 'message-a' as Id<'conversationMessages'>
  const list: PersonalChatDirectoryValue['active'] = {
    rows: [], status: 'ready', hasMore: false, loadingMore: false, loadMore() {},
  }
  const setArchived = async () => {}
  let observed: PersonalChatDirectoryValue | undefined
  let directoryRenders = 0
  const Consumer = memo(function Consumer() {
    observed = usePersonalChatDirectory()
    directoryRenders++
    return null
  })
  function Actions({ workspaceId, transcriptVersion }: { workspaceId: string | null; transcriptVersion: number }) {
    const { rename, setRead } = usePersonalChatDirectoryActions(workspaceId)
    const selectedSummary = useMemo(() => {
      if (!workspaceId) return null
      return {
        _id: conversationId,
        workspaceId,
        createdAt: 1,
        scope: 'personal',
        conversationType: 'personal',
        kind: 'personal',
        title: 'Original',
        askModelIds: [],
        actModelId: 'openrouter/free',
        lastMode: 'chat',
        lastModified: 1,
        lastMessageId: messageId,
        lastMessageAt: 1,
        unread: true,
      } as unknown as PersonalChatSummary
    }, [workspaceId])
    void transcriptVersion
    return (
      <PersonalChatDirectoryProvider value={{
        available: true,
        workspaceId,
        viewerUserId: 'viewer',
        selectedConversationId: workspaceId ? conversationId : null,
        selectedSummary,
        active: list,
        archived: list,
        rename,
        setArchived,
        setRead,
      }}>
        <Consumer />
      </PersonalChatDirectoryProvider>
    )
  }
  const render = (client: ConvexReactClient, workspaceId: string | null, transcriptVersion: number) => (
    <ConvexProvider client={client}>
      <Actions workspaceId={workspaceId} transcriptVersion={transcriptVersion} />
    </ConvexProvider>
  )

  let tree!: ReturnType<typeof create>
  await act(async () => { tree = create(render(clientA, 'workspace-a', 0)) })
  try {
    const initialRename = observed!.rename
    const initialSetRead = observed!.setRead
    await act(async () => tree.update(render(clientA, 'workspace-a', 1)))
    assert.equal(directoryRenders, 1)
    assert.equal(observed?.rename, initialRename)
    assert.equal(observed?.setRead, initialSetRead)

    await act(async () => tree.update(render(clientA, null, 2)))
    await assert.rejects(observed!.rename(conversationId, 'Unavailable'), /Native personal chat is unavailable/)
    assert.equal(callsA.length, 0)

    await act(async () => tree.update(render(clientA, 'workspace-b', 3)))
    assert.equal(observed?.workspaceId, 'workspace-b')
    assert.notEqual(observed?.rename, initialRename)

    const summary = observed!.selectedSummary as PersonalChatSummary
    await act(async () => { await observed!.rename(conversationId, 'Renamed') })
    const renameCall = callsA[0]
    assert.deepEqual(renameCall.args, {
      workspaceId: 'workspace-b', conversationId, title: 'Renamed',
    })
    const renameStore = createOptimisticStore(summary)
    applyOptimisticUpdate(renameCall, renameStore.store)
    assert.equal(renameStore.summary().title, 'Renamed')
    assert.equal(renameStore.listRows()[0].title, 'Renamed')

    await act(async () => { await observed!.setRead(summary, false, messageId) })
    const readCall = callsA[1]
    assert.deepEqual(readCall.args, {
      workspaceId: 'workspace-b', conversationId, unread: false, throughMessageId: messageId,
    })
    const readStore = createOptimisticStore(summary)
    applyOptimisticUpdate(readCall, readStore.store)
    assert.equal(readStore.summary().unread, false)
    assert.equal(readStore.listRows()[0].unread, false)

    const workspaceRename = observed!.rename
    const workspaceSetRead = observed!.setRead
    await act(async () => tree.update(render(clientB, 'workspace-b', 4)))
    assert.notEqual(observed?.rename, workspaceRename)
    assert.notEqual(observed?.setRead, workspaceSetRead)
    await act(async () => { await observed!.rename(conversationId, 'Client B') })
    assert.deepEqual(callsB[0].args, {
      workspaceId: 'workspace-b', conversationId, title: 'Client B',
    })

    Object.defineProperty(clientB, 'mutation', {
      configurable: true,
      value: () => Promise.reject(new Error('fixture mutation failed')),
    })
    await assert.rejects(observed!.setRead(summary, false, messageId), /fixture mutation failed/)
  } finally {
    await act(async () => tree.unmount())
    await clientA.close()
    await clientB.close()
  }
})
