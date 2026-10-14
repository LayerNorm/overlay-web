import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkPerson } from '@overlay/app-core'
import { actorName, commentBody, describeEvent, formatAgo, indexPeople } from './activity'
import { hrefForContext, hrefForTask, labelForLink, safeLinkUrl } from './context-links'

const people: WorkPerson[] = [
  { principalId: 'p-me', type: 'human', userId: 'u-me', displayName: 'Mercedes' },
  { principalId: 'p-sam', type: 'human', userId: 'u-sam', displayName: 'Sam' },
  { principalId: 'p-bot', type: 'agent', userId: null, displayName: 'Research Agent' },
]
const ctx = { ...indexPeople(people), viewerPrincipalId: 'p-me' }

test('events read as sentences, with "You" for the viewer', () => {
  assert.equal(actorName({ actorPrincipalId: 'p-me' }, ctx), 'You')
  assert.equal(actorName({ actorPrincipalId: 'p-sam' }, ctx), 'Sam')
  assert.equal(actorName({ actorPrincipalId: 'gone' }, ctx), 'Someone')
  assert.equal(describeEvent({ kind: 'created', data: null }, ctx), 'created this task')
  assert.equal(describeEvent({ kind: 'status', data: { from: 'todo', to: 'review' } }, ctx), 'moved this to In review')
  assert.equal(describeEvent({ kind: 'assignee', data: { to: 'p-bot' } }, ctx), 'assigned this to Research Agent')
  assert.equal(describeEvent({ kind: 'assignee', data: { to: 'p-me' } }, ctx), 'assigned this to themselves')
  assert.equal(describeEvent({ kind: 'assignee', data: { to: null } }, ctx), 'unassigned this')
  assert.equal(describeEvent({ kind: 'reviewer', data: { to: 'u-sam' } }, ctx), 'asked Sam to review')
  assert.equal(describeEvent({ kind: 'reviewer', data: { to: null } }, ctx), 'removed the reviewer')
  assert.equal(describeEvent({ kind: 'priority', data: { to: 3 } }, ctx), 'set the priority to High')
  assert.equal(describeEvent({ kind: 'dates', data: { startDate: '2026-10-01', dueDate: '2026-10-14' } }, ctx), 'set the dates: Oct 1 to Oct 14')
  assert.equal(describeEvent({ kind: 'dates', data: { startDate: null, dueDate: null } }, ctx), 'cleared the dates')
  assert.equal(describeEvent({ kind: 'title', data: { from: 'A', to: 'B' } }, ctx), 'renamed this from “A” to “B”')
  assert.equal(describeEvent({ kind: 'blocked', data: { to: true } }, ctx), 'marked this as blocked')
  assert.equal(describeEvent({ kind: 'blocked', data: { to: false } }, ctx), 'cleared the blocked flag')
  assert.equal(describeEvent({ kind: 'scope', data: { to: 'workspace' } }, ctx), 'moved this to the Workspace')
  assert.equal(describeEvent({ kind: 'dependencies', data: { added: ['Spec', 'Design'], removed: [] } }, ctx), 'made this wait on “Spec”, “Design”')
  assert.equal(describeEvent({ kind: 'dependencies', data: { added: [], removed: ['Spec'] } }, ctx), 'no longer waits on “Spec”')
  assert.equal(describeEvent({ kind: 'dependencies', data: { added: ['A'], removed: ['B'] } }, ctx), 'changed what this waits on')
  assert.equal(describeEvent({ kind: 'archived', data: null }, ctx), 'archived this')
  assert.equal(describeEvent({ kind: 'restored', data: null }, ctx), 'restored this')
})

test('a comment is its own text, not a sentence; unknown data degrades to a plain phrase', () => {
  assert.equal(describeEvent({ kind: 'comment', data: { body: 'Looks good' } }, ctx), null)
  assert.equal(commentBody({ kind: 'comment', data: { body: 'Looks good' } }), 'Looks good')
  assert.equal(commentBody({ kind: 'status', data: { body: 'x' } }), null)
  assert.equal(describeEvent({ kind: 'status', data: { to: 'nonsense' } }, ctx), 'changed the status')
  assert.equal(describeEvent({ kind: 'assignee', data: { to: 'p-unknown' } }, ctx), 'changed the owner')
})

test('times read short, then as a date', () => {
  const now = Date.UTC(2026, 9, 14, 12, 0, 0)
  assert.equal(formatAgo(now - 5_000, now), 'just now')
  assert.equal(formatAgo(now - 12 * 60_000, now), '12m')
  assert.equal(formatAgo(now - 3 * 3_600_000, now), '3h')
  assert.equal(formatAgo(now - 2 * 86_400_000, now), '2d')
  assert.equal(formatAgo(now - 60 * 86_400_000, now), 'Aug 15')
  assert.equal(formatAgo(now + 5_000, now), 'just now')
})

test('context references open the right page, and links only open web addresses', () => {
  assert.equal(hrefForContext({ type: 'chat', id: 'c 1' }), '/app/chat?id=c%201')
  assert.equal(hrefForContext({ type: 'note', id: 'n1' }), '/app/notes?id=n1')
  assert.equal(hrefForContext({ type: 'file', id: 'f1' }), '/app/files?file=f1')
  assert.equal(hrefForContext({ type: 'link', id: 'https://example.com/spec' }), 'https://example.com/spec')
  assert.equal(hrefForContext({ type: 'link', id: 'javascript:alert(1)' }), null)
  assert.equal(safeLinkUrl('  http://a.test  '), 'http://a.test/')
  assert.equal(safeLinkUrl('ftp://a.test'), null)
  assert.equal(safeLinkUrl('not a url'), null)
  assert.equal(labelForLink('https://www.figma.com/file/1'), 'figma.com')
  assert.equal(labelForLink('plain text'), 'plain text')
})

test('a task opens on the Work page with its panel open', () => {
  assert.equal(hrefForTask('abc'), '/app/work?task=abc')
  assert.equal(hrefForTask('a b/c'), '/app/work?task=a%20b%2Fc')
})
