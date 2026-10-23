import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import type { AuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { ACTIVE_WORKSPACE_HEADER, ROUTE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { resolveWorkspaceRequestScope } from './workspace-route-scope'

function access(id: string): WorkspaceAccess {
  return { workspace: { id } } as WorkspaceAccess
}

function session(userId = 'user-1'): AuthenticatedAppUser {
  return { userId, authType: 'session', accessToken: 'fixture' }
}

function harness(denied: string[] = []) {
  const ids: Array<string | undefined> = []
  const handles: string[] = []
  return {
    ids,
    handles,
    service: {
      async resolveActiveWorkspace(_userId: string, workspaceId?: string) {
        ids.push(workspaceId)
        if (workspaceId && denied.includes(workspaceId)) throw new Error('denied')
        return access(workspaceId ?? 'persisted')
      },
      async resolveWorkspaceHandle({ handle }: { handle: string }) {
        handles.push(handle)
        return handle === 'missing' ? null : { workspaceId: `workspace-${handle}` }
      },
    },
  }
}

test('each browser tab route target overrides persisted header and conflicting query scope', async () => {
  const first = harness()
  const requestA = new NextRequest('https://app.example/api/v1/files?workspaceId=query-c', {
    headers: {
      [ACTIVE_WORKSPACE_HEADER]: 'workspace-b',
      [ROUTE_WORKSPACE_HEADER]: 'id:workspace-a',
    },
  })
  const requestB = new NextRequest('https://app.example/api/v1/files?workspaceId=query-a', {
    headers: {
      [ACTIVE_WORKSPACE_HEADER]: 'workspace-b',
      [ROUTE_WORKSPACE_HEADER]: 'id:workspace-b',
    },
  })
  assert.equal((await resolveWorkspaceRequestScope(requestA, session(), first.service as never)).workspace.id, 'workspace-a')
  assert.equal((await resolveWorkspaceRequestScope(requestB, session(), first.service as never)).workspace.id, 'workspace-b')
  assert.deepEqual(first.ids, ['workspace-a', 'workspace-b'])
})

test('handle targets are resolved and membership-checked before selecting scope', async () => {
  const state = harness()
  const request = new NextRequest('https://app.example/api/v1/files', {
    headers: {
      [ACTIVE_WORKSPACE_HEADER]: 'workspace-b',
      [ROUTE_WORKSPACE_HEADER]: 'handle:acme',
    },
  })
  assert.equal((await resolveWorkspaceRequestScope(request, session(), state.service as never)).workspace.id, 'workspace-acme')
  assert.deepEqual(state.handles, ['acme'])
  assert.deepEqual(state.ids, ['workspace-acme'])
})

test('inaccessible or malformed route targets fail closed without persisted fallback', async () => {
  const state = harness(['workspace-a'])
  const request = new NextRequest('https://app.example/api/v1/files', {
    headers: {
      [ACTIVE_WORKSPACE_HEADER]: 'workspace-b',
      [ROUTE_WORKSPACE_HEADER]: 'id:workspace-a',
    },
  })
  await assert.rejects(
    resolveWorkspaceRequestScope(request, session(), state.service as never),
    /Workspace not found or you no longer have access/,
  )
  assert.deepEqual(state.ids, ['workspace-a'])

  const malformed = new NextRequest('https://app.example/api/v1/files', {
    headers: { [ACTIVE_WORKSPACE_HEADER]: 'workspace-b', [ROUTE_WORKSPACE_HEADER]: 'handle:bad/handle' },
  })
  await assert.rejects(
    resolveWorkspaceRequestScope(malformed, session(), state.service as never),
    /Workspace not found or you no longer have access/,
  )
  assert.deepEqual(state.ids, ['workspace-a'])
})

test('explicit workspace management paths require membership to their path target', async () => {
  const state = harness()
  const request = new NextRequest('https://app.example/api/v1/workspaces/path-workspace/management?workspaceId=query-other', {
    headers: {
      [ACTIVE_WORKSPACE_HEADER]: 'header-other',
      [ROUTE_WORKSPACE_HEADER]: 'id:route-other',
    },
  })
  assert.equal((await resolveWorkspaceRequestScope(request, session(), state.service as never)).workspace.id, 'path-workspace')
  assert.deepEqual(state.ids, ['path-workspace'])
})

test('the legacy active-workspace action is not mistaken for an immutable ID', async () => {
  const state = harness()
  const request = new NextRequest('https://app.example/api/v1/workspaces/active', {
    method: 'POST',
    headers: { [ACTIVE_WORKSPACE_HEADER]: 'workspace-a' },
    body: JSON.stringify({ workspaceId: 'workspace-b' }),
  })
  await resolveWorkspaceRequestScope(request, session(), state.service)
  assert.deepEqual(state.ids, ['workspace-a'])
})

test('same-origin Referer is a browser-only fallback; native callers retain legacy scope', async () => {
  const state = harness()
  const browserRequest = new NextRequest('https://app.example/api/v1/files', {
    headers: {
      [ACTIVE_WORKSPACE_HEADER]: 'workspace-b',
      referer: 'https://app.example/w/acme/files',
    },
  })
  assert.equal((await resolveWorkspaceRequestScope(browserRequest, session(), state.service as never)).workspace.id, 'workspace-acme')
  const nativeRequest = new NextRequest('https://app.example/api/v1/files', {
    headers: {
      [ACTIVE_WORKSPACE_HEADER]: 'workspace-b',
      [ROUTE_WORKSPACE_HEADER]: 'id:workspace-a',
      referer: 'https://app.example/w/acme/files',
    },
  })
  assert.equal(
    (await resolveWorkspaceRequestScope(nativeRequest, { ...session(), authType: 'api-key' }, state.service as never)).workspace.id,
    'workspace-b',
  )
})
