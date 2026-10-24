import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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

function messageElement(message: RoomMessageRecord, authorName = 'Maya Chen', grouped = false, streaming = false, canResolve = false, remoteStatus?: React.ReactNode) {
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
      onResolveRemoteRequest={canResolve ? () => undefined : undefined}
      grouped={grouped}
      remoteStatus={remoteStatus}
    />
  )
}

function render(message: RoomMessageRecord, authorName = 'Maya Chen', grouped = false, streaming = false, canResolve = false, remoteStatus?: React.ReactNode) {
  return renderToStaticMarkup(messageElement(message, authorName, grouped, streaming, canResolve, remoteStatus))
}

function remoteMessage(state: string, retryable = false): RoomMessageRecord {
  return record({ authorKind: 'agent', authorPrincipalId: 'agent-1', content: 'Waiting for Computer',
    parts: [
      { type: 'text', text: 'Waiting for Computer' },
      { type: 'data-remote-agent-status', data: { runId: 'run-1', environmentName: 'Computer',
        queueExpiresAt: Date.now() + 120_000, state, retryable } },
    ],
  })
}

test('connecting uses only the hover-toolbar Stop control, which cancels the remote run', () => {
  const element = messageElement(remoteMessage('waiting'))
  const controls: unknown[] = []
  const row = RoomMessageItem({ ...element.props, personalChatStyle: true,
    onControlRemoteQueue: (runId, action) => controls.push([runId, action]) })
  const html = renderToStaticMarkup(row)
  assert.match(html, /Connecting to computer/)
  assert.match(html, /chat-exchange-actions--hover/)
  assert.match(html, /aria-label="Stop response"/)
  assert.doesNotMatch(html, /Waiting up to|waiting window|>Cancel<|Retry connection/)
  row.props.toolbar.props.onStop()
  assert.deepEqual(controls, [['run-1', 'cancel']])
})

test('a failed connection exposes only the hover-toolbar Retry control and retries its run', () => {
  const element = messageElement(remoteMessage('recoverable', true))
  const controls: unknown[] = []
  const row = RoomMessageItem({ ...element.props, personalChatStyle: true,
    onControlRemoteQueue: (runId, action) => controls.push([runId, action]) })
  const html = renderToStaticMarkup(row)
  assert.match(html, /Computer connection failed/)
  assert.match(html, /aria-label="Retry connection"/)
  assert.match(html, /chat-exchange-actions--hover/)
  assert.doesNotMatch(html, /Stop response|Waiting for Computer|>Resume<|>Start fresh<|>Retry</)
  row.props.toolbar.props.onRetry()
  assert.deepEqual(controls, [['run-1', 'retry']])
})

test('Retry is absent during recovery and for terminal or non-retryable runs', () => {
  for (const state of ['waiting', 'running', 'recovering', 'cancelling', 'completed', 'cancelled', 'failed', 'needs_attention']) {
    assert.doesNotMatch(render(remoteMessage(state, true)), /aria-label="Retry connection"/, state)
  }
  assert.doesNotMatch(render(remoteMessage('recoverable')), /aria-label="Retry connection"/)
  const recovering = render(remoteMessage('recovering', true))
  assert.match(recovering, /aria-label="Stop response"/)
  assert.match(recovering, /Connecting to computer/)
  assert.doesNotMatch(recovering, /Resuming…/)
})

test('provider Markdown paths use saved Files ids while source text and external links stay intact', () => {
  const text = '[the briefing](briefing/INDEX.md) and [NASA](https://science.nasa.gov/earth/)'
  const message = record({ authorKind: 'agent', authorPrincipalId: 'agent', content: text, parts: [
    { type: 'text', text },
    { type: 'data-remote-agent-drive', data: { state: 'saved', fileCount: 1, folderCount: 0,
      entries: [{ fileId: 'report', path: 'briefing/INDEX.md', kind: 'file' }] } },
  ] })
  const html = render(message)
  assert.match(html, /href="\/app\/files\?file=report">the briefing<\/a>/)
  assert.doesNotMatch(html, /href="briefing\/INDEX.md"/)
  assert.match(html, /href="https:\/\/science.nasa.gov\/earth\/"/)
  assert.equal(toRoomMessageView({ message, currentPrincipalId: ME, authorName: 'Agent' }).text, text)
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

test('remote supervised state survives transcript reload as actionable view data', () => {
  const view = toRoomMessageView({
    message: record({ authorKind: 'agent', authorPrincipalId: 'principal_agent', status: 'generating',
      parts: [
        { type: 'text', text: 'I need a branch name.' },
        { type: 'data-remote-agent-request', data: { runId: 'run-1', requestKey: 'input-1', kind: 'elicitation',
          prompt: 'Choose branch', state: 'pending', options: [],
          requestedSchema: { type: 'object', properties: { branch: { title: 'Branch' } }, required: ['branch'] } } },
        { type: 'data-remote-agent-status', data: { runId: 'run-1', environmentName: 'MacBook',
          queueExpiresAt: 0, state: 'waiting_for_input' } },
        { type: 'data-remote-agent-plan', data: { key: 'plan', entries: [{ id: 'one', title: 'Inspect', status: 'completed' }] } },
      ] }),
    currentPrincipalId: ME, authorName: 'Agent', streaming: true,
  })
  assert.deepEqual(view.remoteRequest, { runId: 'run-1', requestKey: 'input-1', kind: 'elicitation',
    prompt: 'Choose branch', options: [], requestedSchema: { type: 'object', properties: { branch: { title: 'Branch' } }, required: ['branch'] } })
  assert.deepEqual(view.remoteRun, { runId: 'run-1', state: 'waiting_for_input', retryable: false, retryClass: undefined })
  // The plan came after the card, so it waits for the answer; what came before shows.
  assert.ok(!view.blocks.some((block) => block.kind === 'tool' && block.name === 'remote_plan'))
  assert.deepEqual(view.blocks, [{ kind: 'text', text: 'I need a branch name.' }])
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


test('a lifecycle run needing attention exposes a deliberate fresh-start control', () => {
  const html = render(record({ authorKind: 'agent', authorPrincipalId: 'agent-1', content: 'Execution interrupted',
    parts: [{ type: 'data-remote-agent-status', data: { runId: 'run-1', environmentName: 'Host',
      queueExpiresAt: 0, state: 'needs_attention' } }],
  }))
  assert.match(html, /Start fresh/)
  assert.match(html, /Stop or isolate the original process/)
  assert.doesNotMatch(html, />Resume</)
})

test('a cancelled empty remote reply remains visibly cancelled without control permission', () => {
  const html = render(record({authorKind: 'agent', authorPrincipalId: 'agent-1', content: '', status: 'completed', parts: [
    {type: 'data-remote-agent-status', data: {runId: 'run-1', environmentName: 'Host', queueExpiresAt: 0, state: 'cancelled'}},
  ]}))
  assert.match(html, /role="status">Cancelled<\/p>/)
  assert.doesNotMatch(html, /Stop response|Start fresh|Task deadline|is responding/)
})

test('active lifecycle messages expose their canonical task deadline and terminal messages do not', () => {
  const deadline = Date.parse('2026-10-17T13:05:00Z')
  for (const state of ['waiting', 'starting', 'running', 'waiting_for_approval', 'recovering', 'needs_attention', 'cancelling', 'completed', 'failed', 'cancelled']) {
    const message = record({authorKind: 'agent', authorPrincipalId: 'agent-1', content: 'Answer', parts: [
      {type: 'data-remote-agent-status', data: {runId: 'run-1', environmentName: 'Host', queueExpiresAt: 0, state, hardDeadlineAt: deadline}},
    ]})
    const html = render(message)
    if (['completed', 'failed', 'cancelled'].includes(state)) assert.doesNotMatch(html, /Task deadline/)
    else {
      assert.match(html, /Task deadline/)
      assert.match(html, /dateTime="2026-10-17T13:05:00.000Z"/i)
      assert.match(html, /1:05 PM UTC/)
    }
  }
})

test('a reloaded MCP approval shows its recorded expiry and discloses billing only for a cloud machine', () => {
  const expiresAt = Date.parse('2026-10-17T13:05:00Z')
  for (const machineCostContinues of [true, false]) {
    const message = record({ authorKind: 'agent', authorPrincipalId: 'agent-1', content: '', status: 'generating', parts: [
      { type: 'data-remote-agent-request', data: { runId: 'run-1', requestKey: 'mcp_call:one', kind: 'permission',
        prompt: 'Allow public read?', state: 'pending', expiresAt, machineCostContinues,
        options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }] } },
    ] })
    const html = render(message, 'Agent', false, false, true)
    assert.match(html, /Expires /)
    assert.ok(html.includes(new Date(expiresAt).toLocaleString()))
    assert.equal(html.includes('Machine time continues to be billed while waiting.'), machineCostContinues)
    assert.equal((html.match(/>Allow<\/button>/g) ?? []).length, 1)
    assert.equal((html.match(/>Deny<\/button>/g) ?? []).length, 1)
  }
})

test('only confirmed native restoration remains visibly recovered after history reload, without control permission', () => {
  for (const recoveryOutcome of [undefined, 'attached_live', 'restored', 'requires_new_attempt', 'unavailable']) {
    const message = record({authorKind: 'agent', authorPrincipalId: 'agent-1', status: 'completed', content: 'Retained answer', parts: [
      {type: 'data-remote-agent-status', data: {runId: 'run-1', environmentName: 'Host', queueExpiresAt: 0, state: 'completed', recoveryOutcome}},
    ]})
    const html = render(message)
    if (recoveryOutcome === 'restored') assert.match(html, /role="status">Recovered<\/p>/)
    else assert.doesNotMatch(html, />Recovered</)
    assert.match(html, /Retained answer/)
  }
})


test('a live agent reply renders formatted chunks and one bottom dots row without character spans', () => {
  const html = render(record({ authorKind: 'agent', authorPrincipalId: 'principal_agent', status: 'generating',
    content: '# Result\n\n**Live formatted tail**',
    parts: [{ type: 'text', text: '# Result\n\n**Live formatted tail**' }],
  }), 'Agent', false, true)
  assert.match(html, /<strong>Live formatted tail<\/strong>/)
  assert.ok(!html.includes('md-char'))
  assert.ok(!html.includes('overlay-stream-marker'))
  assert.match(html, /aria-label="Agent is responding"/)
})


test('stopping an agent keeps its earlier narrative visible while tool details remain folded', () => {
  const intro = '**Retained introduction**\n\n'
  const tail = 'Retained buffered tail.'
  const message = record({ authorKind: 'agent', authorPrincipalId: 'principal_agent', status: 'completed', content: intro + tail,
    parts: [
      { type: 'text', text: intro },
      { type: 'tool-invocation', toolInvocation: { toolCallId: 't', toolName: 'remote_action', state: 'output-error', toolInput: { title: 'Research' }, toolOutput: { status: 'cancelled' } } },
      { type: 'text', text: tail },
      { type: 'data-remote-agent-status', data: { runId: 'r', state: 'cancelled', environmentName: 'QA', queueExpiresAt: 0 } },
    ],
  })
  const html = render(message, 'Agent')
  assert.match(html, /<strong>Retained introduction<\/strong>/)
  assert.ok(html.includes('Retained buffered tail.'))
  const view = toRoomMessageView({message, currentPrincipalId: ME, authorName: 'Agent'})
  assert.ok(view.blocks.some(block => block.kind === 'tool' && block.toolInput?.title === 'Research'))
  assert.match(html, />Cancelled<\/p>/)
})


test('final saving retains progress and deadline without stale native connection status', () => {
  for (const state of ['running', 'finalizing']) {
    const html = render(record({ authorKind: 'agent', authorPrincipalId: 'agent-1', status: 'generating', content: 'Retained answer', parts: [
      { type: 'text', text: 'Retained answer' },
      { type: 'data-remote-agent-status', data: { runId: 'run-1', environmentName: 'Host', queueExpiresAt: 0, state, hardDeadlineAt: Date.parse('2026-10-17T13:05:00Z') } },
      { type: 'data-remote-agent-drive', data: { state: 'saving' } },
    ] }), 'Agent', false, true, false, <span>Waiting for agent connection</span>)
    assert.match(html, /Saving files/)
    assert.match(html, /Task deadline/)
    assert.match(html, /aria-label="Agent is responding"/)
    assert.equal(html.includes('Waiting for agent connection'), state === 'running')
  }
})
