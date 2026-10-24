import assert from 'node:assert/strict'
import test from 'node:test'
import type { AccountAppApiRouteContext, AppApiRouteContext } from '@/server/app-api/bff-context'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'
import { handleWorkspaceHandleGet } from './workspace-handles/[handle]/route'
import { handleWorkspaceHandlePatch } from './workspaces/[workspaceId]/handle/route'

test('resolver awaits BFF params and returns the resolved immutable workspace', async () => {
  let receivedHandle = ''
  const response = await handleWorkspaceHandleGet({
    params: Promise.resolve({ handle: 'acme' }),
    auth: { userId: 'user-1' },
  } as AccountAppApiRouteContext, {
    async resolveWorkspaceHandle(input) {
      receivedHandle = input.handle
      return { workspaceId: 'workspace-1', canonicalHandle: 'acme', canonical: true }
    },
  })
  assert.equal(receivedHandle, 'acme')
  assert.deepEqual(await response.json(), {
    workspaceId: 'workspace-1', canonicalHandle: 'acme', canonical: true,
  })
})

test('handle updates await params and map validation, access, and conflict errors', async () => {
  let received: { workspaceId: string; slug: string } | undefined
  let failure: unknown
  const service = {
    async updateWorkspaceHandle(input: { workspaceId: string; slug: string }) {
      received = input
      if (failure) throw failure
      return { id: input.workspaceId, slug: input.slug }
    },
  }
  const context = {
    params: Promise.resolve({ workspaceId: 'workspace-1' }),
    auth: { userId: 'user-1' },
    parsedJson: { slug: 'acme-new' },
  } as AppApiRouteContext
  let response = await handleWorkspaceHandlePatch(context, service as never)
  assert.equal(response.status, 200)
  assert.deepEqual(received, {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    slug: 'acme-new',
  })

  failure = new WorkspaceServiceError('invalid handle', 400, 'validation')
  response = await handleWorkspaceHandlePatch(context, service as never)
  assert.equal(response.status, 400)
  failure = new WorkspaceServiceError('owner required', 403, 'forbidden')
  response = await handleWorkspaceHandlePatch(context, service as never)
  assert.equal(response.status, 403)
  failure = new WorkspaceServiceError('handle taken', 409, 'handle_conflict')
  response = await handleWorkspaceHandlePatch(context, service as never)
  assert.equal(response.status, 409)
})
