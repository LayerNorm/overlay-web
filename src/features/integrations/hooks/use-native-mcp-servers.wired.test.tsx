import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import WebSocket, { WebSocketServer } from 'ws'
import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { useNativeMcpServer, useNativeMcpServers } from './use-native-mcp-servers'

const testState = vi.hoisted(() => ({ client: null as unknown }))
const cleanups: Array<() => Promise<void>> = []
const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

vi.mock('convex/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/react')>()
  return {
    ...actual,
    useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
    usePaginatedQuery: () => ({ results: [], status: 'LoadingFirstPage', loadMore: () => false }),
    useMutation: (reference: unknown) => actual.useMutation(reference as never),
  }
})

import { ConvexProvider, ConvexReactClient, useMutation } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import {
  nativeGrantListRef,
  nativeGrantRevokeRef,
  removeNativeGrantOptimistically,
} from '@/shared/mcp/native-connected-apps-optimistic'

const require = createRequire(import.meta.url)
const { create } = require('react-test-renderer') as {
  create(element: React.ReactElement): { unmount(): void }
}
const mcpListRef = makeFunctionReference<'query'>('integrations/nativeMcpServers:list')
const mcpGetRef = makeFunctionReference<'query'>('integrations/nativeMcpServers:get')
type SocketMessage = {
  type?: string
  modifications?: Array<Record<string, unknown>>
  requestId?: number
  [key: string]: unknown
}

async function createSocketHarness() {
  const server = new WebSocketServer({ port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  let socket: WebSocket | undefined
  const queued: SocketMessage[] = []
  const waiters: Array<(message: SocketMessage) => void> = []
  server.on('connection', (connected) => {
    socket = connected as unknown as WebSocket
    connected.on('message', (data) => {
      const message = JSON.parse(data.toString()) as SocketMessage
      const waiter = waiters.shift()
      if (waiter) waiter(message)
      else queued.push(message)
    })
  })

  return {
    address: `http://127.0.0.1:${address.port}`,
    async receive() {
      if (queued.length) return queued.shift()!
      return new Promise<SocketMessage>((resolve) => waiters.push(resolve))
    },
    send(message: SocketMessage) {
      assert.ok(socket, 'Convex client must connect before sending test responses')
      socket.send(JSON.stringify(message))
    },
    async close() {
      socket?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function timestamp(value: number) {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes.toString('base64')
}

function queryUpdate(queryId: number, value: unknown) {
  return { type: 'QueryUpdated', queryId, value, logLines: [], journal: null }
}

async function receiveAddQuery(harness: Awaited<ReturnType<typeof createSocketHarness>>, expectedPath: string) {
  const message = await harness.receive()
  if (message.type === 'Connect') return receiveAddQuery(harness, expectedPath)
  expect(message.type).toBe('ModifyQuerySet')
  const addition = message.modifications.find((modification: SocketMessage) =>
    modification.type === 'Add' && modification.udfPath === expectedPath)
  assert.ok(addition, `Expected ${expectedPath} subscription`)
  return addition.queryId as number
}

async function waitForResult(read: () => unknown) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = read()
    if (result !== undefined) return result
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for Convex query result')
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  testState.client = null
})

afterAll(() => {
  if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

test('useNativeMcpServers optimistic mutation rebases remote rows and rolls back on rejection', async () => {
  const harness = await createSocketHarness()
  const client = new ConvexReactClient(harness.address, {
    webSocketConstructor: WebSocket as unknown as typeof globalThis.WebSocket,
    unsavedChangesWarning: false,
    logger: false,
  })
  testState.client = client
  let stopList = () => {}
  let stopGet = () => {}
  let renderer: ReturnType<typeof create> | undefined
  cleanups.push(async () => {
    if (renderer) await React.act(async () => renderer?.unmount())
    stopList()
    stopGet()
    await client.close()
    await harness.close()
  })
  const workspaceId = 'workspace-a'
  const listArgs = {
    workspaceId,
    view: 'personal',
    paginationOpts: { cursor: null, numItems: 30 },
  }
  const getArgs = { workspaceId, mcpServerId: 'server-a' }
  const listWatch = client.watchQuery(mcpListRef, listArgs)
  stopList = listWatch.onUpdate(() => {})
  const listQueryId = await receiveAddQuery(harness, 'integrations/nativeMcpServers:list')
  const getWatch = client.watchQuery(mcpGetRef, getArgs)
  stopGet = getWatch.onUpdate(() => {})
  const getQueryId = await receiveAddQuery(harness, 'integrations/nativeMcpServers:get')
  const initialServer = {
    _id: 'server-a',
    workspaceId,
    endpointRedacted: true,
    userId: 'user-a',
    name: 'Target',
    url: 'https://mcp.example.test',
    transport: 'streamable-http',
    authType: 'none',
    enabled: false,
    updatedAt: 5,
  }
  const initialOther = { ...initialServer, _id: 'server-b', name: 'Other', enabled: false }
  const initialPage = {
    page: [initialServer, initialOther],
    continueCursor: '',
    isDone: true,
    pageMetadata: 'initial metadata',
  }
  harness.send({
    type: 'Transition',
    startVersion: { querySet: 0, identity: 0, ts: timestamp(0) },
    endVersion: { querySet: 2, identity: 0, ts: timestamp(100) },
    modifications: [
      queryUpdate(listQueryId, initialPage),
      queryUpdate(getQueryId, initialServer),
    ],
  })
  await waitForResult(() => listWatch.localQueryResult())
  await waitForResult(() => getWatch.localQueryResult())

  let api!: ReturnType<typeof useNativeMcpServers>
  const captureApi = (value: ReturnType<typeof useNativeMcpServers>) => { api = value }
  function HookProbe() {
    const value = useNativeMcpServers({
      configured: true,
      hasConvexClient: true,
      workspaceId,
      workspaceReady: true,
      view: 'personal',
    })
    React.useEffect(() => captureApi(value), [value])
    return null
  }
  await React.act(async () => {
    renderer = create(React.createElement(
      ConvexProvider,
      { client },
      React.createElement(HookProbe),
    ))
  })

  const pending = api.updateMetadata({
    workspaceId,
    mcpServerId: 'server-a',
    expectedUpdatedAt: 5,
    enabled: true,
  })
  const mutation = await harness.receive()
  expect(mutation.type).toBe('Mutation')
  const requestId = mutation.requestId as number
  expect(listWatch.localQueryResult()).toMatchObject({
    page: [{ _id: 'server-a', enabled: true }, { _id: 'server-b', enabled: false }],
    pageMetadata: 'initial metadata',
  })
  expect(getWatch.localQueryResult()).toMatchObject({ _id: 'server-a', enabled: true, updatedAt: 5 })

  const remoteServer = { ...initialServer, name: 'Remote target', enabled: false, updatedAt: 7 }
  const remoteOther = { ...initialOther, name: 'Remote other', enabled: true, updatedAt: 8 }
  const remotePage = {
    page: [remoteServer, remoteOther],
    continueCursor: '',
    isDone: true,
    pageMetadata: 'remote metadata',
  }
  harness.send({
    type: 'Transition',
    startVersion: { querySet: 2, identity: 0, ts: timestamp(100) },
    endVersion: { querySet: 2, identity: 0, ts: timestamp(200) },
    modifications: [
      queryUpdate(listQueryId, remotePage),
      queryUpdate(getQueryId, remoteServer),
    ],
  })
  await waitForResult(() => {
    const current = listWatch.localQueryResult() as typeof remotePage | undefined
    return current?.pageMetadata === 'remote metadata' ? current : undefined
  })
  expect(listWatch.localQueryResult()).toMatchObject({
    page: [
      { _id: 'server-a', name: 'Remote target', enabled: true, updatedAt: 7 },
      { _id: 'server-b', name: 'Remote other', enabled: true, updatedAt: 8 },
    ],
    pageMetadata: 'remote metadata',
  })
  expect(getWatch.localQueryResult()).toMatchObject({ name: 'Remote target', enabled: true, updatedAt: 7 })

  harness.send({
    type: 'MutationResponse',
    requestId,
    success: false,
    result: 'MCP_REVISION_CONFLICT',
    logLines: [],
  })
  await expect(pending).rejects.toThrow()
  expect(listWatch.localQueryResult()).toEqual(remotePage)
  expect(getWatch.localQueryResult()).toEqual(remoteServer)

})

test('useNativeMcpServer subscribes directly to a record outside the loaded list page', async () => {
  const harness = await createSocketHarness()
  const client = new ConvexReactClient(harness.address, {
    webSocketConstructor: WebSocket as unknown as typeof globalThis.WebSocket,
    unsavedChangesWarning: false,
    logger: false,
  })
  let unsubscribe = () => {}
  let renderer: ReturnType<typeof create> | undefined
  cleanups.push(async () => {
    if (renderer) await React.act(async () => renderer?.unmount())
    unsubscribe()
    await client.close()
    await harness.close()
  })
  const workspaceId = 'workspace-a'
  const serverId = 'server-outside-first-page'
  const queryArgs = { workspaceId, mcpServerId: serverId }
  const watch = client.watchQuery(mcpGetRef, queryArgs)
  unsubscribe = watch.onUpdate(() => {})
  const queryId = await receiveAddQuery(harness, 'integrations/nativeMcpServers:get')
  const server = {
    _id: serverId,
    workspaceId,
    endpointRedacted: true,
    userId: 'user-a',
    name: 'Outside the first page',
    url: 'https://mcp.example.test',
    transport: 'streamable-http',
    authType: 'none',
    enabled: true,
    updatedAt: 5,
  }
  harness.send({
    type: 'Transition',
    startVersion: { querySet: 0, identity: 0, ts: timestamp(0) },
    endVersion: { querySet: 1, identity: 0, ts: timestamp(100) },
    modifications: [queryUpdate(queryId, server)],
  })
  await waitForResult(() => watch.localQueryResult())

  let selected: unknown
  const captureSelected = (value: unknown) => { selected = value }
  function SelectedProbe() {
    const value = useNativeMcpServer(workspaceId, serverId, true)
    React.useEffect(() => captureSelected(value), [value])
    return null
  }
  await React.act(async () => {
    renderer = create(React.createElement(
      ConvexProvider,
      { client },
      React.createElement(SelectedProbe),
    ))
  })
  expect(selected).toEqual(server)
})

test('native connected-app revoke rolls back to the latest server page on rejection', async () => {
  const harness = await createSocketHarness()
  const client = new ConvexReactClient(harness.address, {
    webSocketConstructor: WebSocket as unknown as typeof globalThis.WebSocket,
    unsavedChangesWarning: false,
    logger: false,
  })
  let unsubscribe = () => {}
  cleanups.push(async () => {
    unsubscribe()
    await client.close()
    await harness.close()
  })
  const args = { paginationOpts: { cursor: null, numItems: 30 } }
  const watch = client.watchQuery(nativeGrantListRef, args)
  unsubscribe = watch.onUpdate(() => {})
  const queryId = await receiveAddQuery(harness, 'mcp/grants:listNative')
  const first = { id: 'grant-a', name: 'App A' }
  const second = { id: 'grant-b', name: 'App B' }
  const initialPage = { page: [first, second], isDone: true, continueCursor: '', metadata: 'initial' }
  harness.send({
    type: 'Transition',
    startVersion: { querySet: 0, identity: 0, ts: timestamp(0) },
    endVersion: { querySet: 1, identity: 0, ts: timestamp(100) },
    modifications: [queryUpdate(queryId, initialPage)],
  })
  await waitForResult(() => watch.localQueryResult())

  let revoke!: ReturnType<typeof useMutation>
  const captureRevoke = (value: ReturnType<typeof useMutation>) => { revoke = value }
  let renderer: ReturnType<typeof create> | undefined
  function RevokeProbe() {
    const value = useMutation(nativeGrantRevokeRef).withOptimisticUpdate((store, mutationArgs) => {
      removeNativeGrantOptimistically(store, mutationArgs.grantId)
    })
    React.useEffect(() => captureRevoke(value), [value])
    return null
  }
  await React.act(async () => {
    renderer = create(React.createElement(
      ConvexProvider,
      { client },
      React.createElement(RevokeProbe),
    ))
  })
  const pending = revoke({ grantId: first.id })
  const mutation = await harness.receive()
  expect(mutation.type).toBe('Mutation')
  expect(watch.localQueryResult()).toMatchObject({ page: [second], metadata: 'initial' })

  const remoteFirst = { ...first, name: 'Remote App A' }
  const remoteSecond = { ...second, name: 'Remote App B' }
  const remotePage = { page: [remoteFirst, remoteSecond], isDone: true, continueCursor: '', metadata: 'remote' }
  harness.send({
    type: 'Transition',
    startVersion: { querySet: 1, identity: 0, ts: timestamp(100) },
    endVersion: { querySet: 1, identity: 0, ts: timestamp(200) },
    modifications: [queryUpdate(queryId, remotePage)],
  })
  await waitForResult(() => {
    const current = watch.localQueryResult() as typeof remotePage | undefined
    return current?.metadata === 'remote' ? current : undefined
  })
  expect(watch.localQueryResult()).toMatchObject({ page: [remoteSecond], metadata: 'remote' })

  harness.send({
    type: 'MutationResponse',
    requestId: mutation.requestId,
    success: false,
    result: 'revoke rejected',
    logLines: [],
  })
  await expect(pending).rejects.toThrow()
  expect(watch.localQueryResult()).toEqual(remotePage)
  if (renderer) await React.act(async () => renderer?.unmount())

})
