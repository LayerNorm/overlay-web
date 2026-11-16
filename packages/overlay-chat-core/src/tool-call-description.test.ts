import assert from 'node:assert/strict'
import test from 'node:test'
import { describeToolCall, diffStats, redactCommand, toolCallDescriptionText } from './tool-call-description'

const done = (name: string, input: Record<string, unknown>, output: unknown = { success: true }) =>
  describeToolCall(name, input, output, 'complete')

test('simple read, search and list commands say what they did', () => {
  assert.deepEqual(done('computer_exec', { command: "sed -n 1,50p src/auth.ts" }),
    { verb: 'Read', target: 'auth.ts', range: ':1-50', title: 'sed -n 1,50p src/auth.ts' })
  assert.deepEqual(done('computer_exec', { command: 'rg "listAgentThreads" src' }),
    { verb: 'Searched', target: 'src', detail: 'for “listAgentThreads”', title: 'rg "listAgentThreads" src' })
  assert.equal(done('computer_exec', { command: 'cat README.md' })?.target, 'README.md')
  assert.equal(done('computer_exec', { command: 'head -20 notes/plan.md' })?.range, ':1-20')
  assert.equal(done('computer_exec', { command: 'ls assets/music' })?.verb, 'Listed')
})

test('piped, chained and unfamiliar commands stay a plain Ran row', () => {
  for (const command of ['grep foo src | wc -l', 'cd app && npm test', 'npm test', 'rg -e foo src', 'cat a > b']) {
    const row = done('computer_exec', { command })
    assert.equal(row?.verb, 'Ran', command)
    assert.equal(row?.code, command)
  }
  const long = `npx hyperframes render ${'x'.repeat(200)}`
  assert.equal(done('computer_exec', { command: long })?.code?.length, 90)
  assert.equal(done('computer_exec', { command: long })?.title, long)
})

test('tense follows the call phase', () => {
  assert.equal(describeToolCall('computer_exec', { command: 'npm test' })?.verb, 'Running')
  assert.equal(describeToolCall('computer_exec', { command: 'npm test' }, undefined, 'error')?.verb, 'Running failed')
  assert.equal(describeToolCall('computer_read_file', { path: '/a/b.ts' }, undefined, 'running')?.verb, 'Reading')
})

test('secrets typed into a command are hidden before display', () => {
  assert.equal(redactCommand('OPENAI_API_KEY=sk-123 npm run x'), 'OPENAI_API_KEY=••• npm run x')
  assert.equal(redactCommand('curl -H "Authorization: Bearer abc.def" https://x'), 'curl -H "Authorization: Bearer •••" https://x')
  assert.equal(redactCommand('mysql --password=hunter2 db'), 'mysql --password=••• db')
  const row = done('computer_exec', { command: 'GITHUB_TOKEN=ghp_1 gh pr list' })
  assert.equal(row?.code, 'GITHUB_TOKEN=••• gh pr list')
  assert.ok(!row?.title?.includes('ghp_1'))
})

test('file writes show created or edited with line counts', () => {
  assert.deepEqual(done('computer_write_file', { path: '/w/AgentResponsePending.tsx', contents: 'a\nb\n' },
    { path: '/w/AgentResponsePending.tsx', created: true, linesAdded: 2, linesRemoved: 0 }),
  { verb: 'Created', target: 'AgentResponsePending.tsx', title: '/w/AgentResponsePending.tsx', added: 2, removed: 0 })
  assert.deepEqual(done('computer_write_file', { path: 'x/WorkTaskComposer.tsx', contents: '' },
    { created: false, linesAdded: 20, linesRemoved: 6 }),
  { verb: 'Edited', target: 'WorkTaskComposer.tsx', title: 'x/WorkTaskComposer.tsx', added: 20, removed: 6 })
  assert.equal(describeToolCall('computer_write_file', { path: 'a.ts', contents: 'x' })?.verb, 'Writing')
})

test('created Overlay files carry their id so the row can open them', () => {
  assert.equal(done('computer_publish_file', { name: 'day-01.mp4' }, { success: true, artifact: { fileId: 'f1' } })?.fileId, 'f1')
  assert.equal(done('write_file', { name: 'docs/report.md', content: '' }, { success: true, fileId: 'f2' })?.target, 'report.md')
  assert.equal(done('write_file', { fileId: 'f3', content: '' }, { success: true, fileId: 'f3' })?.verb, 'Edited')
  assert.deepEqual(done('create_note', { title: 'Day 01 notes', content: '' }, { success: true, noteId: 'n1' }),
    { verb: 'Saved note', target: 'Day 01 notes', fileId: 'n1' })
  assert.equal(done('generate_video', { prompt: 'x' }, { success: true, status: 'pending', outputId: 'o1' })?.fileId, undefined)
  assert.equal(done('generate_image', { prompt: 'x' }, { success: true, outputId: 'o2' })?.fileId, 'o2')
  assert.equal(done('create_note', { title: 'x' }, { success: false })?.fileId, undefined)
})

test('connected agent edits and terminals read like native ones', () => {
  const patch = '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n same'
  assert.deepEqual(diffStats(patch), { added: 2, removed: 1 })
  assert.deepEqual(done('remote_diff', { title: 'src/app.ts', patch }),
    { verb: 'Edited', target: 'app.ts', title: 'src/app.ts', added: 2, removed: 1 })
  assert.equal(done('remote_terminal', { title: 'npm test', status: 'completed' })?.code, 'npm test')
})

test('tools without a richer description fall back to the generic label', () => {
  assert.equal(done('web_search', { query: 'x' }), null)
  assert.equal(done('computer_exec', {}), null)
})

test('plain text joins the parts for screen readers', () => {
  assert.equal(toolCallDescriptionText({ verb: 'Edited', target: 'a.ts', added: 20, removed: 6 }), 'Edited a.ts +20 −6')
  assert.equal(toolCallDescriptionText({ verb: 'Read', target: 'a.ts', range: ':1-5' }), 'Read a.ts:1-5')
})
