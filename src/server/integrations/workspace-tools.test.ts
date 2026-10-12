import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolSet } from 'ai'
import { prefixWorkspaceTools, splitWorkspaceTools, withWorkspaceNamePrefix } from './workspace-tools'

const tools = {
  COMPOSIO_SEARCH_TOOLS: { description: 'Find tools', inputSchema: {} },
  COMPOSIO_MULTI_EXECUTE_TOOL: { description: 'Run tools', inputSchema: {} },
} as unknown as ToolSet

test("the workspace's tools sit beside the person's with a prefix and say whose accounts they use", () => {
  const prefixed = prefixWorkspaceTools(tools)
  assert.deepEqual(Object.keys(prefixed), ['workspace_COMPOSIO_SEARCH_TOOLS', 'workspace_COMPOSIO_MULTI_EXECUTE_TOOL'])
  assert.match((prefixed.workspace_COMPOSIO_SEARCH_TOOLS as { description: string }).description, /workspace's shared connector accounts/)
  assert.match((prefixed.workspace_COMPOSIO_SEARCH_TOOLS as { description: string }).description, /Find tools/)
})

test('a merged set splits back by prefix, and re-prefixing leaves descriptions alone', () => {
  const merged = { ...tools, ...prefixWorkspaceTools(tools) }
  const { own, workspace } = splitWorkspaceTools(merged)
  assert.deepEqual(Object.keys(own), ['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_MULTI_EXECUTE_TOOL'])
  assert.deepEqual(Object.keys(workspace), ['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_MULTI_EXECUTE_TOOL'])
  const again = withWorkspaceNamePrefix(workspace)
  assert.equal(
    (again.workspace_COMPOSIO_SEARCH_TOOLS as { description: string }).description,
    (merged.workspace_COMPOSIO_SEARCH_TOOLS as { description: string }).description,
  )
})
