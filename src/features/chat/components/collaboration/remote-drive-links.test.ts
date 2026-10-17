import assert from 'node:assert/strict'
import test from 'node:test'
import type { DriveSyncStatus } from '@layernorm/overlay-agent-bridge-protocol'
import { savedDriveHref, savedDriveLinkTargets } from './remote-drive-links'

const status = {
  state: 'saved', fileCount: 2, folderCount: 1,
  entries: [
    { fileId: 'index', path: 'briefing/INDEX.md', kind: 'file' },
    { fileId: 'unicode', path: 'briefing/报告 A.md', kind: 'file' },
    { fileId: 'folder', path: 'briefing', kind: 'folder' },
  ],
} satisfies DriveSyncStatus
const filesHref = '/app/w/workspace/files'
const targets = new URLSearchParams(savedDriveLinkTargets({ status, filesHref }))

test('relative and Cloud Drive links open only their exact saved file or folder', () => {
  for (const href of ['briefing/INDEX.md', './briefing/INDEX.md', '/home/user/drive/briefing/INDEX.md', '~/drive/briefing/INDEX.md']) {
    assert.equal(savedDriveHref({ href, targets }), `${filesHref}?file=index`)
  }
  assert.equal(savedDriveHref({ href: 'briefing/%E6%8A%A5%E5%91%8A%20A.md#summary', targets }), `${filesHref}?file=unicode#summary`)
  assert.equal(savedDriveHref({ href: 'briefing', targets }), `${filesHref}?folder=folder`)
})

test('unknown, ambiguous, external and traversing links cannot resolve to a saved file', () => {
  for (const href of ['INDEX.md', 'briefing/index.md', '../briefing/INDEX.md', 'briefing/%2e%2e/INDEX.md',
    'briefing//INDEX.md', 'briefing/INDEX.md?download=1', 'briefing/%00INDEX.md', 'briefing\\INDEX.md',
    '/etc/INDEX.md', '//example.com/briefing/INDEX.md', 'https://example.com/briefing/INDEX.md',
    'javascript:alert(1)', 'file:///home/user/drive/briefing/INDEX.md', 'briefing/%ZZ']) {
    assert.equal(savedDriveHref({ href, targets }), undefined, href)
  }
  const ambiguous = new URLSearchParams(targets)
  ambiguous.append('briefing/INDEX.md', `${filesHref}?file=other`)
  assert.equal(savedDriveHref({ href: 'briefing/INDEX.md', targets: ambiguous }), undefined)
})

test('resolver identity depends on saved paths and ids rather than entry order or streaming updates', () => {
  const reordered = { ...status, entries: [...status.entries].reverse() }
  assert.equal(savedDriveLinkTargets({ status: reordered, filesHref }), targets.toString())
  assert.equal(savedDriveLinkTargets({ status: undefined, filesHref }), '')
  assert.equal(savedDriveLinkTargets({ status: { state: 'saving' }, filesHref }), '')
})
