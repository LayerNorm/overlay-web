import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import React, { act, type ReactElement, useEffect, useState } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { savePendingCollaborationMessage } from '@/shared/chat/pending-collaboration-message'
import { readDraft } from '@/shared/chat/conversation-drafts'
import { useNativeThreadSafety } from './useNativeThreadSafety'
import { useChatTurnActions } from './useChatTurnActions'
import { useRoomComposer, useSendMessage, useThreadPanel, type RoomSendResult, type SendMessage } from '../DirectMessageExperience.hooks'

type Renderer = { update(element: ReactElement): void; unmount(): void }
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: ReactElement): Renderer
}
const noop = () => undefined
const cleanups = new WeakMap<TestContext, Array<() => Promise<void>>>()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function browser(t: TestContext) {
  const callbacks: Array<() => Promise<void>> = []
  cleanups.set(t, callbacks)
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  let timerId = 0
  const timers = new Map<number, { callback: () => void; delay: number }>()
  const window = Object.assign(new EventTarget(), {
    localStorage: storage,
    sessionStorage: storage,
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++timerId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id: number) => { timers.delete(id) },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(async () => {
    for (const callback of callbacks.reverse()) await callback()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  return {
    values,
    window,
    runTimers(delay: number) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue
        timers.delete(id)
        timer.callback()
      }
    },
  }
}

async function mount<P, V>(t: TestContext, useValue: (props: P) => V, props: P) {
  let value!: V
  let renderer!: Renderer
  let mounted = true
  function Probe({ input }: { input: P }) {
    const current = useValue(input)
    useEffect(() => { value = current }, [current])
    return null
  }
  await act(() => { renderer = create(<Probe input={props} />) })
  const unmount = async () => {
    if (!mounted) return
    await act(() => { renderer.unmount() })
    mounted = false
  }
  const callbacks = cleanups.get(t)
  if (callbacks) callbacks.push(unmount)
  else t.after(unmount)
  return {
    get value() { return value },
    update: (input: P) => act(() => { renderer.update(<Probe input={input} />) }),
    unmount,
  }
}

test('a native route mismatch reads as checking and stays read-only', async (t) => {
  browser(t)
  const hook = await mount(t, useNativeThreadSafety, {
    conversationId: 'chat', workspaceId: 'workspace', nativeMode: true, scopeSynchronized: false,
  })
  assert.equal(hook.value.status, 'checking')
  assert.equal(hook.value.readOnly, true)
})

test('mounted safety rejects stale root admissions and invalidates unmounted callbacks', async (t) => {
  browser(t)
  const a = deferred<unknown>()
  const b = deferred<unknown>()
  t.mock.method(overlayAppClient.conversations, 'get', ({ threadRootMessageId }: { threadRootMessageId?: string }) => (
    threadRootMessageId === 'a' ? a.promise : b.promise
  ))
  const hook = await mount(t, useNativeThreadSafety, {
    conversationId: 'room', workspaceId: 'workspace', threadRootMessageId: 'a',
  })
  const old = hook.value
  let admission!: Promise<boolean>
  await act(() => { admission = old.ensureWritable() })
  await hook.update({ conversationId: 'room', workspaceId: 'workspace', threadRootMessageId: 'b' })
  await act(async () => {
    a.resolve({ nativeThreadCompatibility: { readOnly: false } })
    await admission
  })
  assert.equal(await admission, false)
  assert.equal(old.isCurrentScope(), false)
  assert.equal(hook.value.status, 'checking')
  let pending!: Promise<boolean>
  const current = hook.value
  await act(() => { pending = current.ensureWritable() })
  await hook.unmount()
  await act(async () => {
    b.resolve({ nativeThreadCompatibility: { readOnly: false } })
    await pending
  })
  assert.equal(await pending, false)
  assert.equal(current.isCurrentScope(), false)
})

test('mounted room and nested safety remain independent and unavailable retries stay bounded', async (t) => {
  const env = browser(t)
  let unavailable = true
  const get = t.mock.method(overlayAppClient.conversations, 'get', async ({ threadRootMessageId }: { threadRootMessageId?: string }) => {
    if (!threadRootMessageId) return { nativeThreadCompatibility: { readOnly: false } }
    if (unavailable) throw Object.assign(new Error('Unavailable'), { code: 'native_thread_compatibility_unavailable' })
    return { nativeThreadCompatibility: { readOnly: true, code: 'native_runner_retired' } }
  })
  const hook = await mount(t, () => ({
    main: useNativeThreadSafety({ conversationId: 'room' }),
    nested: useNativeThreadSafety({ conversationId: 'room', threadRootMessageId: 'root' }),
  }), undefined)
  await act(async () => {
    env.runTimers(0)
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
  assert.equal(hook.value.main.readOnly, false)
  assert.equal(hook.value.nested.status, 'unavailable')
  assert.equal(get.mock.callCount(), 2)
  await act(async () => {
    env.runTimers(0)
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
  assert.equal(get.mock.callCount(), 2)
  unavailable = false
  await act(async () => {
    env.runTimers(10_000)
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
  assert.equal(get.mock.callCount(), 3)
  assert.equal(hook.value.nested.status, 'retired')
  assert.equal(hook.value.main.readOnly, false)
})

function roomArgs(): Parameters<typeof useSendMessage>[0] {
  const messagesRef: Parameters<typeof useSendMessage>[0]['messagesRef'] = { current: [] }
  return {
    canSendToThread: () => true,
    ensureCanSendToThread: async () => ({ accepted: true, status: 'writable' }),
    nativeThreadSafetyStatusValue: 'writable', selectedThreadSafetyStatus: 'writable',
    currentThreadRootId: null, currentPrincipalId: 'human', conversationId: 'room',
    participants: [], conversationType: 'channel', loading: false,
    conversationTitle: 'Room', soloAgentParticipant: null, messagesRef,
    memoryEnabled: false, convexRoomSubscriptionEnabled: true,
    loadMessages: async () => undefined, commitDraftConversation: noop,
    setAgentResponding: noop, setConversationTitle: noop,
    messages: [], mentions: [],
    setMessages: (update) => {
      messagesRef.current = typeof update === 'function' ? update(messagesRef.current) : update
    },
  }
}

test('mounted room admission preserves draft, prevents duplicate saves and retains newer attachments', async (t) => {
  browser(t)
  const saved = deferred<unknown>()
  const post = t.mock.method(overlayAppClient.conversations, 'addMessage', () => saved.promise)
  const args = roomArgs()
  const sessionIdRef = { current: crypto.randomUUID() }
  let allowed = false
  args.ensureCanSendToThread = async () => ({ accepted: allowed, status: allowed ? 'writable' : 'unavailable' })
  const hook = await mount(t, (input: typeof args) => {
    const sendMessage = useSendMessage(input)
    return useRoomComposer({
      activeWorkspaceId: 'workspace', conversationId: input.conversationId, sessionIdRef,
      sendMessage, mentions: input.mentions, setMentions: noop,
    })
  }, args)
  await act(() => { hook.value.setInput('Keep this draft') })
  await act(async () => { await hook.value.handleSend() })
  assert.equal(hook.value.inputRef.current, 'Keep this draft')
  assert.equal(args.messagesRef.current.length, 0)
  assert.equal(post.mock.callCount(), 0)
  allowed = true
  let send!: Promise<void>
  await act(() => { send = hook.value.handleSend() })
  await act(async () => { await hook.value.handleSend() })
  assert.equal(post.mock.callCount(), 1)
  assert.equal(args.messagesRef.current.length, 1)
  await act(() => { hook.value.setAttachedImages([{ name: 'new.png', dataUrl: 'data:image/png;base64,AA==' }]) })
  await act(async () => { saved.resolve({}); await send })
  assert.equal(hook.value.inputRef.current, '')
  assert.equal(hook.value.attachedImages[0]?.name, 'new.png')
})

test('room sends clear typed text, attachments and stored draft before the acknowledgement', async (t) => {
  browser(t)
  t.mock.method(overlayAppClient.conversations, 'updatePresence', async () => ({}))
  const saved = deferred<unknown>()
  const post = t.mock.method(overlayAppClient.conversations, 'addMessage', () => saved.promise)
  const args = roomArgs()
  const hook = await mount(t, (input: typeof args) => {
    const sendMessage = useSendMessage(input)
    return useRoomComposer({
      activeWorkspaceId: 'workspace', conversationId: input.conversationId,
      sessionIdRef: { current: 'presence-session-not-the-conversation' },
      sendMessage, mentions: input.mentions, setMentions: noop,
    })
  }, args)
  await act(() => {
    hook.value.onComposerInput('Read these attachments')
    hook.value.setAttachedImages([{ name: 'image.png', dataUrl: 'data:image/png;base64,AA==' }])
    hook.value.setPendingChatDocuments([{ clientId: 'document', name: 'brief.txt', fileIds: ['file'], status: 'ready' }])
    hook.value.setReplyContext({ snippet: 'Earlier message', bodyForModel: 'Earlier message', replyToTurnId: 'earlier' })
  })
  let send!: Promise<void>
  await act(() => { send = hook.value.handleSend() })
  assert.equal(post.mock.callCount(), 1)
  assert.equal(args.messagesRef.current.length, 1)
  assert.equal(hook.value.inputRef.current, '')
  assert.equal(hook.value.attachedImages.length, 0)
  assert.equal(readDraft({ workspaceId: 'workspace', conversationId: 'room' }), '')
  await act(async () => { saved.resolve({}); await send })
  assert.equal(hook.value.inputRef.current, '')
  assert.equal(hook.value.hasComposerText, false)
  assert.deepEqual(hook.value.attachedImages, [])
  assert.deepEqual(hook.value.pendingChatDocuments, [])
  assert.equal(hook.value.replyContext, null)
  assert.equal(readDraft({ workspaceId: 'workspace', conversationId: 'room' }), '')
})

test('a room send acknowledgement cannot clear a newer draft or a reopened scope', async (t) => {
  browser(t)
  const saved = deferred<{ accepted: boolean }>()
  const args: Parameters<typeof useRoomComposer>[0] = {
    activeWorkspaceId: 'workspace', conversationId: 'room', sessionIdRef: { current: 'presence' },
    sendMessage: () => saved.promise, mentions: [], setMentions: noop,
  }
  const hook = await mount(t, useRoomComposer, args)
  await act(() => { hook.value.setInput('Sent text') })
  let send!: Promise<void>
  await act(() => { send = hook.value.handleSend() })
  await act(() => { hook.value.setInput('Newer draft') })
  await act(async () => { saved.resolve({ accepted: true }); await send })
  assert.equal(hook.value.inputRef.current, 'Newer draft')

  const reopened = deferred<{ accepted: boolean }>()
  await hook.update({ ...args, sendMessage: () => reopened.promise })
  await act(() => { hook.value.setInput('Same text') })
  await act(() => { send = hook.value.handleSend() })
  await hook.update({ ...args, conversationId: 'other-room' })
  await hook.update(args)
  await act(() => { hook.value.setInput('Same text') })
  await act(async () => { reopened.resolve({ accepted: true }); await send })
  assert.equal(hook.value.inputRef.current, 'Same text')
})

test('nested replies clear immediately and restore only an unchanged failed draft', async (t) => {
  browser(t)
  t.mock.method(overlayAppClient.conversations, 'threadFollow', async () => ({ following: false }))
  const hook = await mount(t, useThreadPanel, { conversationId: 'room', setRoomPanel: noop })
  await act(async () => { hook.value.setThreadRootId('a'); hook.value.setThreadInput('original') })
  const saved = deferred<RoomSendResult>()
  const sendMessage: SendMessage = async (_text, options) => {
    options?.onSubmitted?.()
    return await saved.promise
  }
  let send!: Promise<void>
  await act(() => { send = hook.value.submitThreadMessage({ sendMessage, threadRootMessageId: 'a' }) })
  assert.equal(hook.value.threadInput, '')
  await act(async () => { saved.resolve({ accepted: false }); await send })
  assert.equal(hook.value.threadInput, 'original')

  const later = deferred<RoomSendResult>()
  const laterSend: SendMessage = async (_text, options) => { options?.onSubmitted?.(); return await later.promise }
  await act(() => { send = hook.value.submitThreadMessage({ sendMessage: laterSend, threadRootMessageId: 'a' }) })
  await act(() => { hook.value.setThreadInput('newer'); hook.value.setThreadInput('') })
  await act(async () => { later.resolve({ accepted: false }); await send })
  assert.equal(hook.value.threadInput, '')
})

test('late nested acknowledgements and failures preserve newer or reopened thread drafts', async (t) => {
  browser(t)
  t.mock.method(overlayAppClient.conversations, 'threadFollow', async () => ({ following: false }))
  const hook = await mount(t, useThreadPanel, { conversationId: 'room', setRoomPanel: noop })
  await act(async () => { hook.value.setThreadRootId('a'); hook.value.setThreadInput('original') })
  for (const accepted of [true, false]) {
    const saved = deferred<RoomSendResult>()
    const sendMessage: SendMessage = async (_text, options) => { options?.onSubmitted?.(); return await saved.promise }
    let send!: Promise<void>
    await act(() => { send = hook.value.submitThreadMessage({ sendMessage, threadRootMessageId: 'a' }) })
    await act(async () => { hook.value.setThreadRootId('b'); hook.value.setThreadInput('newer') })
    await act(async () => { hook.value.setThreadRootId('a'); hook.value.setThreadInput('newer') })
    await act(async () => { saved.resolve({ accepted }); await send })
    assert.equal(hook.value.threadInput, 'newer')
  }
})

test('mounted room restores normally typed text after safety unmounts the composer', async (t) => {
  browser(t)
  t.mock.method(overlayAppClient.conversations, 'updatePresence', async () => ({}))
  let sends = 0
  const args: Parameters<typeof useRoomComposer>[0] = {
    activeWorkspaceId: 'workspace', conversationId: 'room', sessionIdRef: { current: 'session' },
    sendMessage: async () => { sends++; return { accepted: true } },
    mentions: [], setMentions: noop, readOnly: false,
  }
  const hook = await mount(t, useRoomComposer, args)
  await act(() => hook.value.onComposerInput('QA root draft - do not send'))
  assert.equal(hook.value.input, '', 'normal typing intentionally avoids updating React input state')
  assert.equal(hook.value.inputRef.current, 'QA root draft - do not send')
  await hook.update({ ...args, readOnly: true })
  await act(async () => { await hook.value.handleSend() })
  await hook.update(args)
  assert.equal(hook.value.input, 'QA root draft - do not send', 'remounted editor must receive the latest text')
  assert.equal(hook.value.inputRef.current, hook.value.input)
  assert.equal(sends, 0)
})

test('mounted pending conversion restores a rejected admission and resumes only once writable', async (t) => {
  const env = browser(t)
  const key = 'overlay:pending-collaboration-message'
  savePendingCollaborationMessage({ conversationId: 'room', content: 'Queued instruction' })
  const original = env.values.get(key)
  const post = t.mock.method(overlayAppClient.conversations, 'addMessage', async () => ({}))
  const args = roomArgs()
  args.participants = [{ principalId: 'human', principalType: 'human', displayName: 'Human' }] as typeof args.participants
  let checks = 0
  args.ensureCanSendToThread = async () => ++checks === 1
    ? { accepted: true, status: 'writable' }
    : { accepted: false, status: 'unavailable' }
  const hook = await mount(t, useSendMessage, args)
  assert.equal(checks, 2)
  assert.equal(post.mock.callCount(), 0)
  assert.equal(env.values.get(key), original)
  await hook.update({ ...args, canSendToThread: () => false, nativeThreadSafetyStatusValue: 'unavailable' })
  assert.equal(checks, 2)
  assert.equal(env.values.get(key), original)
  await hook.update({ ...args, ensureCanSendToThread: async () => ({ accepted: true, status: 'writable' }) })
  assert.equal(post.mock.callCount(), 1)
  assert.equal(env.values.has(key), false)
})

test('mounted delete waits for authority and leaves history and animation unchanged on rejection', async (t) => {
  browser(t)
  const response = deferred<Response>()
  t.mock.method(overlayAppClient.conversations, 'deleteMessageResponse', () => response.promise)
  let exiting: string[] = []
  let runtimeWrites = 0
  const hook = await mount(t, useChatTurnActions, {
    activeChatIdRef: { current: 'room' }, activeChatId: 'room',
    setExitingTurnIds: (update: React.SetStateAction<string[]>) => { exiting = typeof update === 'function' ? update(exiting) : update },
    ensureConversationRuntime: () => { runtimeWrites++; throw new Error('Must not mutate history') },
  } as unknown as Parameters<typeof useChatTurnActions>[0])
  let deleting!: Promise<void>
  await act(() => { deleting = hook.value.handleDeleteTurnById('turn') })
  assert.deepEqual(exiting, [])
  assert.equal(runtimeWrites, 0)
  await act(async () => {
    response.resolve(Response.json({ code: 'native_runner_retired', error: 'Retired' }, { status: 410 }))
    await deleting
  })
  assert.deepEqual(exiting, [])
  assert.equal(runtimeWrites, 0)
})

async function roomComposerWithPendingSave(t: TestContext) {
  browser(t)
  t.mock.method(overlayAppClient.conversations, 'updatePresence', async () => ({}))
  const saved = deferred<unknown>()
  t.mock.method(overlayAppClient.conversations, 'addMessage', () => saved.promise)
  const args = roomArgs()
  const hook = await mount(t, (input: typeof args) => {
    const [mentions, setMentions] = useState(input.mentions)
    const composer = useRoomComposer({ activeWorkspaceId: 'workspace', conversationId: input.conversationId,
      sessionIdRef: { current: 'presence' }, sendMessage: useSendMessage(input), mentions, setMentions })
    return { ...composer, syncEmptyEditorMentions: () => setMentions([]) }
  }, args)
  return { hook, saved, args }
}

test('a failed optimistic room send restores its text, attachments, reply and stored draft', async t => {
  const { hook, saved } = await roomComposerWithPendingSave(t)
  const images = [{ name: 'image.png', dataUrl: 'data:image/png;base64,AA==' }]
  const documents: typeof hook.value.pendingChatDocuments = [{ clientId: 'doc', name: 'brief.txt', fileIds: ['file'], status: 'ready' }]
  const reply = { snippet: 'Earlier', bodyForModel: 'Earlier', replyToTurnId: 'earlier' }
  await act(() => {
    hook.value.onComposerInput('Recover this draft')
    hook.value.setAttachedImages(images)
    hook.value.setPendingChatDocuments(documents)
    hook.value.setReplyContext(reply)
  })
  let send!: Promise<void>
  await act(() => { send = hook.value.handleSend() })
  assert.equal(hook.value.inputRef.current, '')
  // MentionInput's value-sync effect emits a fresh empty list after clearing.
  await act(() => { hook.value.syncEmptyEditorMentions() })
  await act(async () => { saved.reject(new Error('Network failed')); await send })
  assert.equal(hook.value.inputRef.current, 'Recover this draft')
  assert.deepEqual(hook.value.attachedImages, images)
  assert.deepEqual(hook.value.pendingChatDocuments, documents)
  assert.equal(hook.value.replyContext, reply)
  assert.equal(readDraft({ workspaceId: 'workspace', conversationId: 'room' }), 'Recover this draft')
})

test('late room send failure cannot overwrite newer text or a newer empty draft', async t => {
  const { hook, saved } = await roomComposerWithPendingSave(t)
  await act(() => { hook.value.onComposerInput('Sent draft') })
  let send!: Promise<void>
  await act(() => { send = hook.value.handleSend() })
  await act(() => { hook.value.onComposerInput('New draft'); hook.value.onComposerInput('') })
  await act(async () => { saved.reject(new Error('Network failed')); await send })
  assert.equal(hook.value.inputRef.current, '')
  assert.equal(readDraft({ workspaceId: 'workspace', conversationId: 'room' }), '')
})

test('late room send failure cannot restore into a reopened conversation', async t => {
  const { hook, saved, args } = await roomComposerWithPendingSave(t)
  await act(() => { hook.value.onComposerInput('Sent draft') })
  let send!: Promise<void>
  await act(() => { send = hook.value.handleSend() })
  await hook.update({ ...args, conversationId: 'other-room' })
  await hook.update(args)
  await act(() => { hook.value.onComposerInput('New draft') })
  await act(async () => { saved.reject(new Error('Network failed')); await send })
  assert.equal(hook.value.inputRef.current, 'New draft')
})

test('late room send failure preserves newly added attachments without restoring the submitted draft', async t => {
  const { hook, saved } = await roomComposerWithPendingSave(t)
  await act(() => { hook.value.onComposerInput('Sent draft') })
  let send!: Promise<void>
  await act(() => { send = hook.value.handleSend() })
  const newer = [{ name: 'new.png', dataUrl: 'data:image/png;base64,BB==' }]
  await act(() => { hook.value.setAttachedImages(newer) })
  await act(async () => { saved.reject(new Error('Network failed')); await send })
  assert.equal(hook.value.inputRef.current, '')
  assert.deepEqual(hook.value.attachedImages, newer)
})

test('a draft changed during admission is not cleared when the older message appears', async t => {
  const { hook, saved, args } = await roomComposerWithPendingSave(t)
  const admission = deferred<{ accepted: boolean; status: 'writable' }>()
  await hook.update({ ...args, ensureCanSendToThread: () => admission.promise })
  await act(() => { hook.value.onComposerInput('Original') })
  let send!: Promise<void>
  await act(() => { send = hook.value.handleSend() })
  await act(() => { hook.value.onComposerInput('Changed'); hook.value.onComposerInput('Original') })
  await act(async () => { admission.resolve({ accepted: true, status: 'writable' }); await Promise.resolve() })
  assert.equal(hook.value.inputRef.current, 'Original')
  await act(async () => { saved.resolve({}); await send })
  assert.equal(hook.value.inputRef.current, 'Original')
})
