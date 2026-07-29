import assert from 'node:assert/strict'
import test from 'node:test'
import { SHOWCASE_WORKSPACES } from './showcase-data'
import { createShowcaseWorkspaceClient } from './showcase-workspace-client'

test('showcase workspace client switches and creates without network writes', async () => {
  const client = createShowcaseWorkspaceClient(SHOWCASE_WORKSPACES)
  const initial = await client.list()
  assert.equal(initial.activeWorkspaceId, 'showcase-personal')

  const activated = await client.activate('showcase-acme')
  assert.equal(activated.activeWorkspaceId, 'showcase-acme')

  const created = await client.create({ name: 'Research Guild' })
  assert.equal(created.workspace.slug, 'research-guild')
  assert.equal((await client.list()).workspaces.length, SHOWCASE_WORKSPACES.length + 1)
})
