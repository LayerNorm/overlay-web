import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test, { type TestContext } from 'node:test'
import React, { act, type ReactElement } from 'react'
import type { AssistantVisualBlock } from '@overlay/chat-core'
import type { GeneratedUiData, GeneratedUiPart } from '@overlay/chat-core/generated-ui'
import { GeneratedUiCard } from './GeneratedUiCard'
import { AssistantVisualBlocks } from './transcript/AssistantVisualBlocks'
import { ChatExchange, type ChatExchangeProps } from './transcript/ChatExchange'

type TestNode = {
  type: unknown
  props: Record<string, unknown>
  children: Array<TestNode | string>
  findAll(predicate: (node: TestNode) => boolean): TestNode[]
}

type TestRenderer = {
  root: TestNode
  update(element: ReactElement): void
  unmount(): void
  toJSON(): unknown
}

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: ReactElement): TestRenderer
}

const part: GeneratedUiPart = {
  type: 'data',
  id: 'draft-1',
  dataType: 'overlay.generated_ui',
  data: { version: 1, kind: 'draft.text', title: 'Original title', body: 'Original body' },
}
const blocks = [{ kind: 'generated-ui', part }] satisfies AssistantVisualBlock[]
const noop = () => undefined

function browser(t: TestContext) {
  const callbacks: Array<() => Promise<void>> = []
  const timers = new Map<number, { callback: () => void; delay: number }>()
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  let timerId = 0
  const window = Object.assign(new EventTarget(), {
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++timerId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id: number) => { timers.delete(id) },
    matchMedia: (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    }),
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
    registerCleanup(callback: () => Promise<void>) {
      callbacks.push(callback)
    },
    runTimers(delay: number) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue
        timers.delete(id)
        timer.callback()
      }
    },
    get timerCount() {
      return timers.size
    },
  }
}

async function mount(t: TestContext, env: ReturnType<typeof browser>, element: ReactElement) {
  let renderer!: TestRenderer
  await act(async () => { renderer = create(element) })
  env.registerCleanup(async () => { await act(() => renderer.unmount()) })
  return renderer
}

function findButton(renderer: TestRenderer, label: string): TestNode | undefined {
  return renderer.root.findAll((node) => (
    node.type === 'button' && node.props['aria-label'] === label
  ))[0]
}

function click(node: TestNode) {
  const onClick = node.props.onClick
  assert.equal(typeof onClick, 'function')
  ;(onClick as () => void)()
}

function findPrompt(renderer: TestRenderer): TestNode {
  const prompt = renderer.root.findAll((node) => node.props['aria-label'] === 'Prompt')[0]
  assert.ok(prompt, 'expected the generated UI prompt editor')
  return prompt
}

function changePrompt(node: TestNode, value: string) {
  const onChange = node.props.onChange
  assert.equal(typeof onChange, 'function')
  ;(onChange as (event: { target: { value: string } }) => void)({ target: { value } })
}

function exchangeProps(overrides: Partial<ChatExchangeProps> = {}): ChatExchangeProps {
  return {
    userMsgId: 'user-1',
    userBodyText: 'Question',
    userDocumentNames: [],
    userImages: [],
    exchIdx: 0,
    responseModelId: 'model',
    assistantVisualBlocks: blocks,
    isStreaming: false,
    isTextStreaming: false,
    errorMessage: null,
    responseInProgress: false,
    status: 'completed',
    turnIdForActions: null,
    modelLabel: 'Model',
    onDeleteTurn: noop,
    onReply: noop,
    actionsLocked: false,
    replyThreadMeta: null,
    onJumpToReply: noop,
    onOpenDraft: noop,
    onCreateAutomationDraft: noop,
    isSourcesOpenForThis: false,
    onGeneratedUiChange: noop,
    ...overrides,
  }
}

test('read-only generated cards keep copy/download but do not offer Edit', async (t) => {
  const env = browser(t)
  const renderer = await mount(t, env, (
    <GeneratedUiCard part={part} readOnly onDataChange={noop} />
  ))

  assert.equal(findButton(renderer, 'Edit'), undefined)
  assert.ok(findButton(renderer, 'Copy'))
  assert.ok(findButton(renderer, 'Download'))
})

test('generated cards without a persistence callback do not offer local-only Edit', async (t) => {
  const env = browser(t)
  const renderer = await mount(t, env, <GeneratedUiCard part={part} />)

  assert.equal(findButton(renderer, 'Edit'), undefined)
  assert.ok(findButton(renderer, 'Copy'))
})

test('writable generated cards allow callback-backed edits', async (t) => {
  const env = browser(t)
  const changes: Array<{ partId: string; data: GeneratedUiData }> = []
  const renderer = await mount(t, env, (
    <GeneratedUiCard
      part={part}
      onDataChange={(partId, data) => changes.push({ partId, data })}
    />
  ))

  const edit = findButton(renderer, 'Edit')
  assert.ok(edit)
  await act(() => click(edit))
  const prompt = findPrompt(renderer)
  await act(() => changePrompt(prompt, 'Saved body'))
  const save = findButton(renderer, 'Save edits')
  assert.ok(save)
  await act(() => click(save))

  assert.deepEqual(changes, [{
    partId: part.id,
    data: { ...part.data, body: 'Saved body' },
  }])
})

test('becoming read-only restores the part and cancels pending blur and debounce writes', async (t) => {
  const env = browser(t)
  const changes: Array<{ partId: string; data: GeneratedUiData }> = []
  const onDataChange = (partId: string, data: GeneratedUiData) => changes.push({ partId, data })
  const renderer = await mount(t, env, (
    <GeneratedUiCard part={part} onDataChange={onDataChange} />
  ))

  const edit = findButton(renderer, 'Edit')
  assert.ok(edit)
  await act(() => click(edit))
  const prompt = findPrompt(renderer)
  const onBlur = prompt.props.onBlur
  await act(() => changePrompt(prompt, 'Unsaved local body'))
  assert.equal(env.timerCount, 1)

  await act(async () => {
    renderer.update(<GeneratedUiCard part={part} readOnly onDataChange={onDataChange} />)
  })
  assert.equal(findButton(renderer, 'Edit'), undefined)
  assert.equal(renderer.root.findAll((node) => node.props['aria-label'] === 'Prompt').length, 0)
  assert.match(JSON.stringify(renderer.toJSON()), /Original body/)
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Unsaved local body/)
  assert.equal(env.timerCount, 0)

  assert.equal(typeof onBlur, 'function')
  await act(() => (onBlur as () => void)())
  env.runTimers(700)
  assert.deepEqual(changes, [])
})

test('ChatExchange and AssistantVisualBlocks forward read-only state to generated cards', async (t) => {
  const env = browser(t)
  const change = (partId: string, data: GeneratedUiData) => {
    assert.equal(partId, part.id)
    assert.equal(data.kind, 'draft.text')
  }
  const exchange = await mount(t, env, (
    <ChatExchange {...exchangeProps({ generatedUiReadOnly: true, onGeneratedUiChange: change })} />
  ))
  const visualBlocks = await mount(t, env, (
    <AssistantVisualBlocks
      blocks={blocks}
      blockKeyPrefix="agent-message"
      markdownKeyPrefix="agent-message"
      isStreaming={false}
      isTextStreaming={false}
      onOpenDraft={noop}
      onCreateAutomationDraft={noop}
      generatedUiReadOnly
      onGeneratedUiChange={change}
    />
  ))

  assert.equal(findButton(exchange, 'Edit'), undefined)
  assert.equal(findButton(visualBlocks, 'Edit'), undefined)
})
