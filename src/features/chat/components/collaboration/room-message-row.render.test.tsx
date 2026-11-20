import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { createRequire } from 'node:module'
import { getPerfDebugSnapshot, resetPerfDebugSnapshot } from '@overlay/chat-react/lib/perf-debug'
import { RoomMessage } from '../DirectMessageExperience.parts'
import type { RoomMessageContext } from '../DirectMessageExperience.hooks'
import { useStableRoomMessageContext } from './room-message-row'
import { mergeRoomMessages, type RoomMessageRecord } from './room-message-view'
import type { AgentThreadTurnActions } from './useAgentThreadTurnActions'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void; toJSON(): unknown }
}
const noop = () => {}
const asyncNoop = async () => {}

function record(id: string, overrides: Partial<RoomMessageRecord> = {}): RoomMessageRecord {
  return { id, turnId: `turn-${id}`, authorKind: 'agent', authorPrincipalId: 'agent', content: `Answer ${id}`,
    status: 'completed', createdAt: Number(id.replace(/\D/g, '')) * 1_000, ...overrides }
}

function turns(running: boolean, calls: string[]): AgentThreadTurnActions {
  return { actionsFor: (message, onReply) => ({
    retryDisabled: running, actionsLocked: false, onReply,
    onDeleteTurn: () => calls.push(`delete:${message.id}:${running}`),
  }) }
}

const participants: RoomMessageContext['participants'] = []
const directory: RoomMessageContext['directoryAgentsByPrincipal'] = new Map()
const mentions: RoomMessageContext['participantMentions'] = []
const reactions: RoomMessageContext['reactions'] = []
const pins: RoomMessageContext['pins'] = []
const savedMessages: RoomMessageContext['savedMessages'] = []

function context(overrides: Partial<RoomMessageContext> = {}): RoomMessageContext {
  return {
    conversationId: 'room', conversationType: 'dm', agentThreadTurns: null, currentPrincipalId: 'me',
    participants, directoryAgentsByPrincipal: directory, participantMentions: mentions, reactions, pins,
    savedMessages, threadRootId: null, threadTeasers: new Map(), replyCounts: new Map(), editingId: null,
    editingContent: '', setEditingContent: noop, setEditingId: noop, saveEdit: asyncNoop, deleteMessage: asyncNoop,
    reportMessage: asyncNoop, toggleReaction: asyncNoop, togglePinned: asyncNoop, toggleSaved: asyncNoop,
    openThread: noop, beginQuoteReply: noop, sendMessage: async () => ({ accepted: true }) as never,
    onOpenAttachmentPreview: noop, copyMessagePermalink: asyncNoop, stopAgentResponse: asyncNoop,
    highlightedMessageId: null, ...overrides,
  }
}

function Transcript({ messages, ctx }: { messages: RoomMessageRecord[]; ctx: RoomMessageContext }) {
  const stable = useStableRoomMessageContext(ctx)
  return <>{messages.map((message) => <RoomMessage key={message.id} message={message} ctx={stable} />)}</>
}

test('room stream updates re-render only the streaming row while real changes still reach their rows', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  t.mock.method(globalThis, 'setInterval', () => 0 as unknown as ReturnType<typeof setInterval>)
  const window = Object.assign(new EventTarget(), {
    location: { search: '?perf=1', href: 'https://example.test/', origin: 'https://example.test' },
    localStorage: { getItem: () => null }, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  let renderer: ReturnType<typeof create> | undefined
  t.after(async () => {
    if (renderer) await act(() => renderer!.unmount())
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  const fresh = (rows: RoomMessageRecord[]) => JSON.parse(JSON.stringify(rows)) as RoomMessageRecord[]
  const calls: string[] = []
  const base = [record('m1'), record('m2'), record('m3', { status: 'generating', content: 'Partial', updatedAt: 3_000 })]
  let messages = mergeRoomMessages(base, [])
  const render = async (ctx: RoomMessageContext) => {
    resetPerfDebugSnapshot()
    await act(async () => {
      if (renderer) renderer.update(<Transcript messages={messages} ctx={ctx} />)
      else renderer = create(<Transcript messages={messages} ctx={ctx} />)
    })
    return getPerfDebugSnapshot().renders.RoomMessageItem ?? 0
  }
  await render(context({ agentThreadTurns: turns(true, calls) }))

  const streamed = fresh(messages)
  streamed[2] = { ...streamed[2]!, content: 'Partial and more streamed text', updatedAt: 3_100 }
  messages = mergeRoomMessages(streamed, messages)
  assert.equal(await render(context({ agentThreadTurns: turns(true, calls), replyCounts: new Map(), threadTeasers: new Map() })), 1, 'step 1')
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('Partial and more streamed text'))

  const edited = fresh(messages)
  edited[0] = { ...edited[0]!, content: 'Edited first answer', editedAt: 4_000 }
  messages = mergeRoomMessages(edited, messages)
  assert.equal(await render(context({ agentThreadTurns: turns(true, calls) })), 1, 'step 2')
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('Edited first answer'))

  const replies = new Map([['m2', 3]])
  assert.equal(await render(context({ agentThreadTurns: turns(true, calls), replyCounts: replies })), 1, 'step 3')
  assert.equal(await render(context({ agentThreadTurns: turns(true, calls), replyCounts: replies, editingId: 'm1', editingContent: 'Draft' })), 1, 'step 4')
  assert.equal(await render(context({ agentThreadTurns: turns(true, calls), replyCounts: replies, editingId: 'm1', editingContent: 'Draft 2' })), 1, 'step 5')
  assert.equal(await render(context({ agentThreadTurns: turns(true, calls), reactions: [{ messageId: 'm2', emoji: '👍', count: 1, reactedByCurrentPrincipal: true }] as RoomMessageContext['reactions'] })), 3, 'step 6')

  const settled = fresh(messages)
  settled[2] = { ...settled[2]!, status: 'completed', updatedAt: 3_200 }
  messages = mergeRoomMessages(settled, messages)
  assert.equal(await render(context({ agentThreadTurns: turns(false, calls) })), 3, 'step 7')
  assert.equal(await render(context({ agentThreadTurns: turns(false, calls), reactions })), 0, 'step 8')
})

test('stable room handlers keep their identity and call the latest committed actions', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  const seen: RoomMessageContext[] = []
  const calls: string[] = []
  const flagsDuringRender: boolean[] = []
  function Probe({ ctx }: { ctx: RoomMessageContext }) {
    const stable = useStableRoomMessageContext(ctx)
    seen.push(stable)
    // Rows read retry/delete flags while rendering; they must come from this render, not the previous commit.
    const flags = stable.agentThreadTurns?.actionsFor(record('m1'), noop)
    if (flags) flagsDuringRender.push(flags.retryDisabled)
    return null
  }
  const first = context({ deleteMessage: async (id) => { calls.push(`first:${id}`) }, agentThreadTurns: turns(true, calls) })
  const second = context({ deleteMessage: async (id) => { calls.push(`second:${id}`) }, agentThreadTurns: turns(false, calls) })
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(<Probe ctx={first} />) })
  await act(async () => renderer!.update(<Probe ctx={second} />))
  const [before, after] = [seen.at(-2)!, seen.at(-1)!]
  assert.equal(before.deleteMessage, after.deleteMessage)
  // New turn actions give a new object, so a memoized row compares their flags instead of skipping them.
  assert.notEqual(before.agentThreadTurns, after.agentThreadTurns)
  assert.deepEqual(flagsDuringRender, [true, false])
  await before.deleteMessage('m1')
  before.agentThreadTurns!.actionsFor(record('m1'), noop).onDeleteTurn()
  assert.deepEqual(calls, ['second:m1', 'delete:m1:false'])
  assert.equal(after.agentThreadTurns!.actionsFor(record('m1'), noop).retryDisabled, false)
  await act(async () => renderer!.update(<Probe ctx={second} />))
  assert.equal(seen.at(-1)!.agentThreadTurns, after.agentThreadTurns, 'unchanged turn actions keep their identity')
  await act(async () => renderer!.update(<Probe ctx={context()} />))
  assert.equal(seen.at(-1)!.agentThreadTurns, null)
  await act(async () => renderer!.unmount())
})
