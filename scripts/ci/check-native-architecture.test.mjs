import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareWithBaseline,
  findBannedIdentifiers,
  findBrowserHttpCalls,
  isBrowserFile,
} from './check-native-architecture.mjs'

test('removed provider and browser-token names are reported with their line', () => {
  const findings = findBannedIdentifiers([
    "import { deriveAppDataCapabilities } from './capabilities'",
    'const ok = 1',
    "const iss = 'overlay-browser-convex'",
    'useConvexAuthToken()',
  ].join('\n'))
  assert.deepEqual(findings.map((f) => [f.line, f.name]).sort(), [
    [1, 'deriveAppDataCapabilities'],
    [3, 'overlay-browser-convex'],
    [4, 'useConvexAuthToken'],
  ])
  // Whole words only: a longer name that merely contains a banned one is fine.
  assert.deepEqual(findBannedIdentifiers('const myRepositoryProxyCount = 1'), [])
})

test('only browser source files are ratcheted', () => {
  assert.equal(isBrowserFile('src/features/chat/ChatInlinePanel.tsx'), true)
  assert.equal(isBrowserFile('src/components/providers/Thing.ts'), true)
  assert.equal(isBrowserFile('src/app/app/archived/page.tsx'), true)
  assert.equal(isBrowserFile('src/app/api/v1/notes/route.ts'), false)
  assert.equal(isBrowserFile('src/server/notes/NoteService.ts'), false)
  assert.equal(isBrowserFile('src/features/chat/ChatInlinePanel.test.tsx'), false)
})

test('client calls are collected as resource.method, including across line breaks', () => {
  const calls = findBrowserHttpCalls([
    'await overlayAppClient.notes.update(id, body)',
    'await overlayAppClient',
    '  .conversations',
    '  .stop(args)',
    'overlayAppClient.notes.update(other)',
  ].join('\n'))
  assert.deepEqual([...calls].sort(), ['conversations.stop', 'notes.update'])
})

test('new calls fail and calls that disappear must leave the baseline', () => {
  const baseline = { 'notes.update': ['src/a.tsx'], 'work.move': ['src/b.tsx'] }
  const current = { 'notes.update': ['src/a.tsx', 'src/c.tsx'], 'skills.create': ['src/d.tsx'] }
  assert.deepEqual(compareWithBaseline(current, baseline), {
    added: ['src/c.tsx: overlayAppClient.notes.update', 'src/d.tsx: overlayAppClient.skills.create'],
    stale: ['src/b.tsx: overlayAppClient.work.move'],
  })
  assert.deepEqual(compareWithBaseline(baseline, baseline), { added: [], stale: [] })
})
