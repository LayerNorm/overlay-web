import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildWorkspaceHref,
  readWorkspaceIdFromPath,
  resolveWorkspaceSurface,
} from './workspace-routing'

test('workspace routing preserves the current canonical surface', () => {
  assert.equal(resolveWorkspaceSurface('/app/projects'), 'projects')
  assert.equal(resolveWorkspaceSurface('/app/w/ws_old/files'), 'files')
  assert.equal(buildWorkspaceHref('ws next', '/app/w/ws_old/files'), '/app/w/ws%20next/files')
})

test('workspace routing falls back to chat for unknown and non-app routes', () => {
  assert.equal(resolveWorkspaceSurface('/pricing'), 'chat')
  assert.equal(resolveWorkspaceSurface('/app/unknown'), 'chat')
  assert.equal(buildWorkspaceHref('personal', '/'), '/app/w/personal/chat')
})

test('workspace routing reads and safely decodes canonical workspace ids', () => {
  assert.equal(readWorkspaceIdFromPath('/app/w/acme%20labs/chat'), 'acme labs')
  assert.equal(readWorkspaceIdFromPath('/app/chat'), null)
  assert.equal(readWorkspaceIdFromPath('/app/w/%E0%A4%A/chat'), null)
})
