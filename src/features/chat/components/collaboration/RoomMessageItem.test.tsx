import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoomMessageItem } from './RoomMessageItem'
import {
  compareRoomMessageRecords,
  isOwnRoomMessage,
  mergeRoomMessages,
  toRoomMessageView,
  type RoomMessageRecord,
} from './room-message-view'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const ME = 'principal_me'

function record(overrides: Partial<RoomMessageRecord> = {}): RoomMessageRecord {
  return {
    id: 'message_1',
    turnId: 'turn_1',
    authorKind: 'human',
    authorPrincipalId: ME,
    content: 'Ship the onboarding fix',
    createdAt: Date.parse('2026-07-29T18:02:00.000Z'),
    ...overrides,
  }
}

function render(message: RoomMessageRecord, authorName = 'Maya Chen') {
  return renderToStaticMarkup(
    <RoomMessageItem
      message={toRoomMessageView({
        message,
        currentPrincipalId: ME,
        authorName,
        mentions: [{ type: 'person', id: 'principal_maya', name: 'Maya Chen' }],
      })}
      reactions={[{ emoji: '👍', count: 2, reactedByCurrentPrincipal: true }]}
      replyCount={1}
      pinned={false}
      saved={false}
      editing={false}
      editingContent=""
      onEditingContentChange={() => undefined}
      onSaveEdit={() => undefined}
      onCancelEdit={() => undefined}
      onStartEdit={() => undefined}
      onDelete={() => undefined}
      onReport={() => undefined}
      onToggleReaction={() => undefined}
      onTogglePinned={() => undefined}
      onToggleSaved={() => undefined}
      onOpenThread={() => undefined}
      onQuoteReply={() => undefined}
      onRetrySend={() => undefined}
      onOpenAttachmentPreview={() => undefined}
      onCopyPermalink={() => undefined}
    />,
  )
}

test('a member’s own message reuses the personal chat user bubble, attributed to You', () => {
  const html = render(record())
  assert.match(html, /Ship the onboarding fix/)
  // Right-aligned bubble column, same as the chat transcript's user side.
  assert.match(html, /justify-end/)
  // Even your own message says who wrote it: an anonymous bubble in a shared
  // room reads as first person no matter who sent it.
  assert.match(html, />You</)
  // Own messages can be edited and deleted, never reported.
  assert.match(html, /aria-label="Edit message"/)
  assert.match(html, /aria-label="Delete message"/)
  assert.doesNotMatch(html, /aria-label="Report message"/)
})

test('another member’s message is attributed to them and never rendered as yours', () => {
  const html = render(record({
    id: 'message_2',
    authorPrincipalId: 'principal_maya',
    content: 'Onboarding is still the gap',
  }))
  assert.match(html, /Maya Chen/)
  assert.doesNotMatch(html, />You</)
  assert.match(html, /justify-start/)
  assert.match(html, /aria-label="Report message"/)
  assert.doesNotMatch(html, /aria-label="Edit message"/)
})

test('an unattributed message is never claimed as yours', () => {
  assert.equal(isOwnRoomMessage({ authorKind: 'human' }, ME), false)
  assert.equal(isOwnRoomMessage({ authorKind: 'human', authorPrincipalId: '' }, ME), false)
  assert.equal(isOwnRoomMessage({ authorKind: 'human', authorPrincipalId: ME }, ''), false)
  assert.equal(isOwnRoomMessage({ authorKind: 'agent', authorPrincipalId: ME }, ME), false)
  assert.equal(isOwnRoomMessage({ authorKind: 'human', authorPrincipalId: ME }, ME), true)
})

test('agent replies render markdown and tool output through the shared block renderer', () => {
  const html = render(record({
    id: 'message_3',
    authorKind: 'agent',
    authorPrincipalId: 'principal_agent',
    content: '**Bold** finding',
    parts: [
      { type: 'text', text: '**Bold** finding' },
    ],
  }), 'Bagel - GTM')
  assert.match(html, /<strong>Bold<\/strong>/)
  assert.match(html, /Bagel - GTM/)
})

test('room members named in a message render as mention chips', () => {
  const html = render(record({ id: 'message_6', content: '@Maya Chen can you take this?' }))
  assert.match(html, /class="mx-0\.5 inline-flex[^"]*"[^>]*>@Maya Chen</)
})

test('human room messages render safe markdown even when room member metadata is present', () => {
  const html = render(record({ id: 'message_7', content: '**Launch**\n\n- first\n- second\n\n[Overlay](https://getoverlay.io)' }))
  assert.match(html, /<strong>Launch<\/strong>/)
  assert.match(html, /<ul[^>]*>[\s\S]*<li[^>]*>first<\/li>[\s\S]*<li[^>]*>second<\/li>[\s\S]*<\/ul>/)
  assert.match(html, /href="https:\/\/getoverlay\.io"/)
  assert.doesNotMatch(html, /\*\*Launch\*\*/)
})

test('human room messages preserve authored line breaks', () => {
  const html = render(record({ id: 'message_9', content: 'First line\nSecond line' }))
  assert.match(html, /whitespace-pre-wrap[^>]*>First line\nSecond line<\/p>/)
})

test('human room markdown never renders raw HTML or executable links', () => {
  const html = render(record({ id: 'message_8', content: '<img src=x onerror=alert(1)> [bad](javascript:alert(1))' }))
  assert.doesNotMatch(html, /<img/)
  assert.doesNotMatch(html, /javascript:/)
})

test('collaboration operations sit in the hover action row', () => {
  const html = render(record({ id: 'message_4', authorPrincipalId: 'principal_maya' }))
  for (const label of ['Add reaction', 'Reply in thread', 'Pin message', 'Save message']) {
    assert.match(html, new RegExp(`aria-label="${label}"`))
  }
  assert.match(html, /group-hover\/exchange:opacity-100/)
  assert.match(html, /1 reply/)
})

test('deleted messages leave a tombstone instead of content', () => {
  const html = render(record({ id: 'message_5', deletedAt: Date.now(), content: '' }))
  assert.match(html, /Message deleted/)
})

test('attachment summaries become chips, not body text', () => {
  const view = toRoomMessageView({
    message: record({
      content: 'Latest numbers\n\n[Indexed documents: q3.csv]\n\n[Attached 1 image: chart.png]',
      parts: [
        { type: 'text', text: 'Latest numbers' },
        { type: 'file', url: 'https://example.test/chart.png', mediaType: 'image/png', fileName: 'chart.png' },
      ],
    }),
    currentPrincipalId: ME,
    authorName: 'Me',
  })
  assert.equal(view.text, 'Latest numbers')
  assert.deepEqual(view.documentNames, ['q3.csv'])
  assert.equal(view.images.length, 1)
})

test('room reconciliation uses deterministic ordering and replaces optimistic duplicates', () => {
  const persisted = record({ id: 'message_real', createdAt: 20, clientNonce: 'nonce_1', content: 'saved' })
  const pending = record({ id: 'optimistic_nonce_1', createdAt: 19, clientNonce: 'nonce_1', content: 'pending', delivery: 'sending' })
  const later = record({ id: 'message_z', createdAt: 20, authorPrincipalId: 'principal_maya' })
  const merged = mergeRoomMessages([persisted, later], [pending])
  assert.deepEqual(merged.map((message) => message.id), ['message_real', 'message_z'])
  assert.ok(compareRoomMessageRecords(merged[0]!, merged[1]!) < 0)
})
