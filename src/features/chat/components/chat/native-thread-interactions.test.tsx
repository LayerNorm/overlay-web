import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import React, { act, type ReactElement, useEffect } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { savePendingCollaborationMessage } from '@/shared/chat/pending-collaboration-message'
import { useNativeThreadSafety } from './useNativeThreadSafety'
import { useChatTurnActions } from './useChatTurnActions'
import { useRoomComposer, useSendMessage, useThreadPanel } from '../DirectMessageExperience.hooks'

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
  const sessionIdRef = { current: 'room' }
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
  assert.equal(hook.value.inputRef.current, 'Keep this draft')
  assert.equal(hook.value.attachedImages[0]?.name, 'new.png')
})

test('mounted nested draft completion never clears new text or another root', async (t) => {
  browser(t)
  t.mock.method(overlayAppClient.conversations, 'threadFollow', async () => ({ following: false }))
  const hook = await mount(t, useThreadPanel, { conversationId: 'room', setRoomPanel: noop })
  await act(async () => {
    hook.value.setThreadRootId('a')
    hook.value.setThreadInput('original')
    await Promise.resolve()
  })
  const scope = { conversationId: 'room', threadRootMessageId: 'a', text: 'original' }
  await act(() => { hook.value.setThreadInput('newer') })
  await act(() => { hook.value.clearSubmittedThreadInput(scope) })
  assert.equal(hook.value.threadInput, 'newer')
  await act(async () => {
    hook.value.setThreadRootId('b')
    hook.value.setThreadInput('original')
    await Promise.resolve()
  })
  await act(() => { hook.value.clearSubmittedThreadInput(scope) })
  assert.equal(hook.value.threadInput, 'original')
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
