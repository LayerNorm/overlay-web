import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatExchange } from '@overlay/chat-react/transcript'
import { RoomMessageItem } from './RoomMessageItem'
import {
  compareRoomMessageRecords,
  isOwnRoomMessage,
  mergeRoomMessages,
  roomMessageRowKey,
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

function messageElement(message: RoomMessageRecord, authorName = 'Maya Chen', grouped = false, streaming = false, personalChatStyle = false, editing = false) {
  return (
    <RoomMessageItem
      message={toRoomMessageView({
        message,
        currentPrincipalId: ME,
        authorName,
        streaming,
        mentions: [{ type: 'person', id: 'principal_maya', name: 'Maya Chen' }],
      })}
      reactions={[{ emoji: '👍', count: 2, reactedByCurrentPrincipal: true }]}
      replyCount={1}
      pinned={false}
      saved={false}
      editing={editing}
      editingContent={editing ? 'Edited message' : ''}
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
      grouped={grouped}
      onStopResponse={streaming ? () => undefined : undefined}
      personalChatStyle={personalChatStyle}
    />
  )
}

function render(message: RoomMessageRecord, authorName = 'Maya Chen', grouped = false, streaming = false, personalChatStyle = false, editing = false) {
  return renderToStaticMarkup(messageElement(message, authorName, grouped, streaming, personalChatStyle, editing))
}

test('streaming agent controls stay hidden until their own response is hovered or focused', () => {
  const html = render(record({ authorKind: 'agent', authorPrincipalId: 'agent', content: 'Working' }), 'Agent', false, true, true)
  assert.match(html, /aria-label="Stop response"/)
  assert.match(html, /chat-exchange-actions--hover[^\"]*transition-opacity opacity-0 group-hover\/exchange:opacity-100/)
  assert.match(html, /focus-within:opacity-100/)
  assert.match(html, /-ml-1\.5/)
})

test('a streaming agent reply shows one working line below its text until it settles', () => {
  const html = render(record({ authorKind: 'agent', authorPrincipalId: 'agent', content: 'Searching memory first.' }), 'Agent', false, true)
  assert.doesNotMatch(html, /animate-pulse rounded-full/)
  assert.doesNotMatch(html, /agent-response-pending/)
  assert.equal(html.match(/data-working-line/g)?.length, 1)
  assert.ok(html.indexOf('Searching memory first.') < html.indexOf('data-working-line'))
  const settled = render(record({ authorKind: 'agent', authorPrincipalId: 'agent', content: 'Done.' }), 'Agent')
  assert.doesNotMatch(settled, /data-working-line/)
})

test('an empty generating reply shows the working line immediately below its author, with no dots row', () => {
  const html = render(record({ authorKind: 'agent', authorPrincipalId: 'agent', content: '' }), 'Agent', false, true)
  assert.equal(html.match(/data-working-line/g)?.length, 1)
  assert.match(html, /data-loading-presentation="standalone"/)
  assert.doesNotMatch(html, /agent-response-pending/)
  assert.ok(html.indexOf('>Agent</span>') < html.indexOf('data-working-line'))
})

test('a member’s own message is just the personal gray bubble', () => {
  const html = render(record())
  assert.match(html, /Ship the onboarding fix/)
  assert.match(html, /justify-end/)
  assert.doesNotMatch(html, />You</)
  assert.doesNotMatch(html, /6:02 PM/)
  // Match personal chat: gray surface-subtle bubble, not room black tone.
  assert.match(html, /chat-user-bubble/)
  assert.doesNotMatch(html, /room-message-self-bubble/)
  assert.match(html, /aria-label="Edit message"/)
  assert.match(html, /aria-label="Delete message"/)
  assert.doesNotMatch(html, /aria-label="Report message"/)
  assert.doesNotMatch(html, /rounded-lg bg-\(--surface-muted\)/)
})

test('message edits use a full-width textarea with labeled text actions', () => {
  const html = render(record(), 'Maya Chen', false, false, false, true)
  assert.match(html, /data-slot="textarea"[^>]*rows="3"/)
  assert.match(html, /aria-label="Cancel edit"[^>]*>Cancel<\/button>/)
  assert.match(html, /aria-label="Save edit"[^>]*>Save<\/button>/)
})

test('another member’s message is flat Slack-style (no bubble) with avatar and hover row', () => {
  const html = render(record({
    id: 'message_2',
    authorPrincipalId: 'principal_maya',
    content: 'Onboarding is still the gap',
  }))
  assert.match(html, /Maya Chen/)
  assert.doesNotMatch(html, />You</)
  assert.doesNotMatch(html, /room-message-self-bubble/)
  assert.doesNotMatch(html, /chat-user-bubble/)
  assert.match(html, /hover:bg-\(--surface-subtle\)/)
  assert.match(html, /aria-label="Report message"/)
  assert.doesNotMatch(html, /aria-label="Edit message"/)
  assert.match(html, /data-testid="thread-teaser"/)
  assert.match(html, /1 reply/)
})

test('received grouped messages still identify their author', () => {
  const html = render(record({
    id: 'message_grouped',
    authorPrincipalId: 'principal_maya',
    content: 'Following up with the detail.',
  }), 'Maya Chen', true)
  assert.match(html, /Maya Chen/)
  assert.doesNotMatch(html, /6:02 PM/)
})

test('thread teaser surfaces the latest reply preview under received messages', () => {
  const html = renderToStaticMarkup(
    <RoomMessageItem
      message={toRoomMessageView({
        message: record({
          id: 'message_root',
          authorPrincipalId: 'principal_maya',
          content: 'Root',
        }),
        currentPrincipalId: ME,
        authorName: 'Maya Chen',
      })}
      reactions={[]}
      replyCount={3}
      threadTeaser={{ authorName: 'Rahul', text: 'I can take this today', createdAt: Date.now() }}
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
      onControlRemoteQueue={() => undefined}
    />,
  )
  assert.match(html, /3 replies/)
  assert.match(html, /Rahul/)
  assert.match(html, /I can take this today/)
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
  assert.match(html, /class="mx-0\.5 inline-flex items-center rounded-md[^"]*">[\s\S]*?Maya Chen<\/span>/)
  assert.doesNotMatch(html, /@Maya Chen<\/span>/)
})

test('human room messages render safe markdown like every other chat message', () => {
  const html = render(record({ id: 'message_7', content: '## this is awesome\n# this is great' }))
  assert.match(html, /<h2[^>]*>this is awesome<\/h2>/)
  assert.match(html, /<h1[^>]*>this is great<\/h1>/)
})

test('human room messages preserve authored paragraphs', () => {
  const html = render(record({ id: 'message_9', content: 'First line\nSecond line' }))
  assert.match(html, /First line/)
  assert.match(html, /Second line/)
})

test('human room messages do not execute HTML or javascript links', () => {
  const html = render(record({ id: 'message_8', content: '<img src=x onerror=alert(1)> [bad](javascript:alert(1))' }))
  assert.doesNotMatch(html, /onerror/)
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

test('deleted own messages keep the right-aligned user bubble', () => {
  const html = render(record({ id: 'message_5', deletedAt: Date.now(), content: '' }))
  assert.match(html, /Message deleted/)
  assert.match(html, /justify-end/)
  assert.match(html, /chat-user-bubble/)
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

test('optimistic and persisted copies of one send share one row key', () => {
  const pending = record({ id: 'optimistic_nonce_1', clientNonce: 'nonce_1' })
  const persisted = record({ id: 'message_real', clientNonce: 'nonce_1' })
  assert.equal(roomMessageRowKey(pending), roomMessageRowKey(persisted))
  // Messages without a nonce (server-generated, imported) stay keyed by id.
  assert.equal(roomMessageRowKey(record({ id: 'message_x' })), 'room-message-row-message_x')
})

test('a live agent reply renders formatted chunks and one bottom dots row without character spans', () => {
  const html = render(record({ authorKind: 'agent', authorPrincipalId: 'principal_agent', status: 'generating',
    content: '# Result\n\n**Live formatted tail**',
    parts: [{ type: 'text', text: '# Result\n\n**Live formatted tail**' }],
  }), 'Agent', false, true)
  assert.match(html, /<strong>Live formatted tail<\/strong>/)
  assert.ok(!html.includes('md-char'))
  assert.ok(!html.includes('overlay-stream-marker'))
  assert.doesNotMatch(html, /agent-response-pending/)
})

test('agent-thread replies use the chat response actions instead of reactions and thread replies', () => {
  const calls: string[] = []
  const chatActions = {
    onRegenerate: () => calls.push('retry'),
    retryDisabled: false,
    actionsLocked: false,
    onDeleteTurn: () => calls.push('delete'),
    onReply: () => calls.push('reply'),
    onBranch: () => calls.push('branch'),
  }
  const element = messageElement(record({ authorKind: 'agent', authorPrincipalId: 'agent', content: 'The fix is ready.' }), 'Atlas', false, false, false, undefined, true)
  const html = renderToStaticMarkup(<RoomMessageItem {...element.props} chatActions={chatActions} />)
  for (const label of ['Copy response', 'Regenerate response', 'Delete this turn from history', 'Reply', 'Branch chat from here']) {
    assert.match(html, new RegExp(`aria-label="${label}"`), label)
  }
  assert.doesNotMatch(html, /👍|Add reaction|Reply in thread|1 reply|Pin message|Save message|Report message/)
  // The action row stays hidden until the reply is hovered or focused, like a chat reply.
  assert.match(html, /chat-exchange-actions--hover[^"]*opacity-0 group-hover\/exchange:opacity-100/)

  const mine = renderToStaticMarkup(<RoomMessageItem {...messageElement(record(), 'Me', false, false, false, undefined, true).props} chatActions={chatActions} />)
  assert.match(mine, /aria-label="Copy message"/)
  assert.doesNotMatch(mine, /👍|Regenerate response|Add reaction|1 reply/)

  const streaming = renderToStaticMarkup(<RoomMessageItem {...messageElement(record({ authorKind: 'agent', authorPrincipalId: 'agent', content: 'Working' }), 'Atlas', false, true, false, undefined, true).props} chatActions={chatActions} />)
  assert.doesNotMatch(streaming, /Regenerate response|Branch chat from here/)
})

test('channel messages keep reactions and thread replies', () => {
  const html = render(record({ authorKind: 'agent', authorPrincipalId: 'agent', content: 'Done.' }), 'Atlas')
  assert.match(html, /👍/)
  assert.doesNotMatch(html, /Regenerate response|Branch chat from here/)
})



function renderChatReply(responseText: string) {
  return renderToStaticMarkup(
    <ChatExchange
      userMsgId="user-1"
      userBodyText="Question"
      userDocumentNames={[]}
      userImages={[]}
      exchIdx={0}
      responseModelId="model"
      assistantVisualBlocks={responseText ? [{ kind: 'text', text: responseText }] : []}
      isStreaming
      isTextStreaming={Boolean(responseText)}
      errorMessage={null}
      responseInProgress
      status={responseText ? 'streaming' : 'submitted'}
      interrupted={false}
      turnIdForActions={null}
      modelLabel="Model"
      onDeleteTurn={() => {}}
      onReply={() => {}}
      actionsLocked={false}
      replyThreadMeta={null}
      onJumpToReply={() => {}}
      onOpenDraft={() => {}}
      onCreateAutomationDraft={() => {}}
      isSourcesOpenForThis={false}
    />,
  )
}

const loadingTag = (markup: string) => markup.match(/<[^>]*data-loading-presentation="[^"]*"[^>]*>/g) ?? []

test('chat and agent-thread replies render the same loading indicator for the same live state', () => {
  for (const content of ['', 'Partial answer']) {
    const chat = renderChatReply(content)
    const room = render(record({ authorKind: 'agent', authorPrincipalId: 'agent', content }), 'Agent', false, true)
    assert.equal(loadingTag(chat).length, 1)
    assert.deepEqual(loadingTag(room), loadingTag(chat))
    if (content) {
      assert.ok(chat.indexOf(content) < chat.indexOf('data-loading-presentation'))
      assert.ok(room.indexOf(content) < room.indexOf('data-loading-presentation'))
    }
  }
})

