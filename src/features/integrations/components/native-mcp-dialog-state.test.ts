import { expect, test } from 'vitest'
import type { NativeMcpSummary } from '../hooks/use-native-mcp-servers'
import {
  captureNativeMcpSnapshot,
  MCP_DIALOG_MISSING_MESSAGE,
  MCP_DIALOG_STALE_MESSAGE,
  MCP_DIALOG_WAITING_MESSAGE,
  nativeMcpDialogProblem,
  nativeMcpDialogServerId,
  retainCreatedNativeMcpServer,
} from './native-mcp-dialog-state'

const server = {
  _id: 'mcp_saved',
  workspaceId: 'workspace_a',
  endpointRedacted: true,
  userId: 'user_a',
  name: 'Calendar',
  transport: 'streamable-http',
  url: 'https://mcp.example.test',
  enabled: true,
  authType: 'oauth',
  createdAt: 10,
  updatedAt: 20,
} as NativeMcpSummary

test('a created OAuth server remains selected while its direct settings query is pending', () => {
  const draft = { mode: 'create' as const }
  const retained = retainCreatedNativeMcpServer(draft, server._id, 'https://mcp.example.test/custom-path')

  expect(retained).toMatchObject({
    mode: 'create',
    createdId: server._id,
    createEndpoint: 'https://mcp.example.test/custom-path',
  })
  expect(nativeMcpDialogServerId(retained)).toBe(server._id)
  expect(nativeMcpDialogProblem(retained, undefined)).toBe(MCP_DIALOG_WAITING_MESSAGE)
  expect(retainCreatedNativeMcpServer(retained, 'duplicate_id', 'https://other.example.test')).toBe(retained)
})

test('the first direct get snapshot pins the revision and rejects later changes', () => {
  const retained = retainCreatedNativeMcpServer(
    { mode: 'create' },
    server._id,
    'https://mcp.example.test/custom-path',
  )!
  const captured = captureNativeMcpSnapshot(retained, server)
  expect(captured).toMatchObject({
    mode: 'edit',
    createdId: server._id,
    persistedId: server._id,
    createEndpoint: 'https://mcp.example.test/custom-path',
    snapshot: server,
  })
  expect(nativeMcpDialogServerId(captured)).toBe(server._id)
  expect(nativeMcpDialogProblem(captured, server)).toBeNull()

  const externalUpdate = { ...server, updatedAt: server.updatedAt + 1 }
  expect(captureNativeMcpSnapshot(captured, externalUpdate)).toBe(captured)
  expect(captured.snapshot?.updatedAt).toBe(server.updatedAt)
  expect(nativeMcpDialogProblem(captured, externalUpdate)).toBe(MCP_DIALOG_STALE_MESSAGE)
})

test('a missing direct get result fails closed instead of returning to create mode', () => {
  const retained = retainCreatedNativeMcpServer(
    { mode: 'create' },
    server._id,
    'https://mcp.example.test/custom-path',
  )!
  const missing = captureNativeMcpSnapshot(retained, null)
  expect(missing.mode).toBe('edit')
  expect(nativeMcpDialogServerId(missing)).toBe(server._id)
  expect(nativeMcpDialogProblem(missing, null)).toBe(MCP_DIALOG_MISSING_MESSAGE)
})
