import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveWorkspaceSurface, buildWorkspaceHref } from './routing'

test('Work uses the same canonical workspace surface as its compatibility route', () => {
  assert.equal(resolveWorkspaceSurface('/app/work'), 'work')
  assert.equal(resolveWorkspaceSurface('/app/w/ws-1/work'), 'work')
  assert.equal(buildWorkspaceHref('ws-2', '/app/w/ws-1/work'), '/app/w/ws-2/work')
})
