import assert from 'node:assert/strict'
import test from 'node:test'
import { getComputerToolActivityDetails, getDescriptiveToolLabel, sanitizeToolActivityText } from './tool-labels'

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

test('computer labels use known paths and commands with truthful result phases', () => {
  assert.equal(getDescriptiveToolLabel('computer_read_file', { path: '/tmp/launch notes.md' }), 'Reading /tmp/launch notes.md')
  assert.equal(getDescriptiveToolLabel('computer_write_file', { path: '/tmp/end-card.svg' }, 'complete'), 'Wrote /tmp/end-card.svg')
  assert.equal(getDescriptiveToolLabel('computer_list_files', { directory: '/tmp/output' }, 'error'), 'Could not list /tmp/output')
  assert.equal(getDescriptiveToolLabel('computer_exec', { command: 'ffmpeg -i input.mp4 output.mp4' }, 'complete'), 'Ran command · ffmpeg -i input.mp4 output.mp4')
  assert.equal(getDescriptiveToolLabel('computer_exec', { command: 'ffmpeg -i input.mp4' }, 'complete', { success: false }), 'Command failed · ffmpeg -i input.mp4')
  assert.equal(getDescriptiveToolLabel('computer_exec', {}), 'Running a command on the computer')
})

test('computer labels and details redact credentials before clipping', () => {
  const command = `curl https://example.test?access_token=abc123 ${'x'.repeat(120)}`
  const label = getDescriptiveToolLabel('computer_exec', { command })
  assert.equal(label.includes('abc123'), false)
  assert.equal(label.length <= 120, true)
  const details = getComputerToolActivityDetails('computer_exec', { command: 'tool API_KEY=secret-value' }, { exitCode: 7, durationMs: 123 })
  assert.deepEqual(details, [
    { label: 'Command', value: 'tool API_KEY=[REDACTED]' },
    { label: 'Exit code', value: '7' },
    { label: 'Duration', value: '123 ms' },
  ])
  assert.equal(sanitizeToolActivityText('Authorization: Bearer supersecret').includes('supersecret'), false)
  const sensitive = sanitizeToolActivityText(
    "OPENAI_API_KEY=oa-secret GITHUB_TOKEN=gh-secret -H 'Authorization: Basic basic-secret' https://user:pass@example.test/?access_token=query-secret&refresh_token=refresh-secret",
  )
  for (const secret of ['oa-secret', 'gh-secret', 'basic-secret', 'user:pass', 'query-secret', 'refresh-secret']) {
    assert.equal(sensitive.includes(secret), false, `${secret} should be redacted`)
  }
  assert.deepEqual(getComputerToolActivityDetails('computer_exec', { command: 'run' }, {
    display: { exitCode: 2, durationMs: 25 },
  }).map((detail) => detail.label), ['Command', 'Exit code', 'Duration'])
  assert.equal(getComputerToolActivityDetails('computer_exec', { command: 'run' }, {
    exitCode: 2, duration: 25,
  }).some((detail) => detail.label === 'Duration'), false)
})
