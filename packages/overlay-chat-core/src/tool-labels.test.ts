import assert from 'node:assert/strict'
import test from 'node:test'
import { getDescriptiveToolLabel } from './tool-labels'

test('MCP tool labels reflect running and terminal lifecycle states', () => {
  const input = { toolName: 'read_tweet' }
  assert.equal(getDescriptiveToolLabel('call_mcp_tool', input), 'Calling MCP tool · read_tweet')
  assert.equal(getDescriptiveToolLabel('call_mcp_tool', input, 'complete'), 'Called MCP tool · read_tweet')
  assert.equal(getDescriptiveToolLabel('call_mcp_tool', input, 'error'), 'MCP tool failed · read_tweet')
  assert.equal(getDescriptiveToolLabel('call_mcp_tool', input, 'denied'), 'MCP tool denied · read_tweet')
})

test('MCP search labels settle after their result is available', () => {
  const input = { query: 'read an exact tweet' }
  assert.equal(
    getDescriptiveToolLabel('search_mcp_tools', input, 'complete'),
    'Searched MCP integrations for “read an exact tweet”',
  )
})

test('a connected agent action shows the title the agent gave it', () => {
  assert.equal(getDescriptiveToolLabel('remote_action', { title: 'Read notes/how-to-find-bugs.md' }), 'Read notes/how-to-find-bugs.md')
  assert.equal(getDescriptiveToolLabel('remote_action', {}), 'Remote Action')
})

test('task tool rows use clear action labels', () => {
  assert.equal(getDescriptiveToolLabel('list_tasks'), 'Listing tasks')
  assert.equal(getDescriptiveToolLabel('get_task'), 'Opening a task')
  assert.equal(getDescriptiveToolLabel('create_task'), 'Creating a task')
  assert.equal(getDescriptiveToolLabel('update_task'), 'Updating a task')
  assert.equal(getDescriptiveToolLabel('comment_on_task'), 'Commenting on a task')
  assert.equal(getDescriptiveToolLabel('archive_task'), 'Archiving a task')
  assert.equal(getDescriptiveToolLabel('restore_task'), 'Restoring a task')
})

test('an action with no real name is shown as Tool call', () => {
  assert.equal(getDescriptiveToolLabel('remote_action', { title: 'tool call' }), 'Tool call')
  assert.equal(getDescriptiveToolLabel('remote_action', { title: 'Tool' }), 'Tool call')
  assert.equal(getDescriptiveToolLabel('remote_action', { title: 'Read notes.md' }), 'Read notes.md')
})

test('a connected agent’s terminal, file edits, and plan are named for what they are', () => {
  assert.equal(getDescriptiveToolLabel('remote_terminal', { title: 'git clone x' }), 'Terminal output')
  assert.equal(getDescriptiveToolLabel('remote_diff', { title: 'src/app.ts' }), 'Edited src/app.ts')
  assert.equal(getDescriptiveToolLabel('remote_diff', {}), 'File changes')
  assert.equal(getDescriptiveToolLabel('remote_plan', {}), 'Plan')
})
