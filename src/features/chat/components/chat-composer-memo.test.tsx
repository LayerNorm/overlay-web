import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act, createRef } from 'react'
import { createRequire } from 'node:module'
import type { ChatComposerProps, ComposerViewProps } from './ChatComposerTypes'
import { sameChatComposerProps, useComposerViewProps } from './chat-composer-memo'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}

const fileInputRef = createRef<HTMLInputElement>()
const docInputRef = createRef<HTMLInputElement>()
const textareaRef = createRef<never>()
const attachMenuRef = createRef<HTMLDivElement>()
const modeMenuRef = createRef<HTMLDivElement>()
const attachedImages: never[] = []
const pendingChatDocuments: never[] = []
const capabilities = { memory: true, vectorSearch: true } as unknown as ChatComposerProps['toolState']['capabilities']
const Intro = () => null
const intro = <Intro />

/** Props the chat surface rebuilds on every streamed update: fresh objects and handlers, the same data. */
function props(overrides: { send?: () => void; input?: Partial<ChatComposerProps['inputState']>; runtime?: Partial<ChatComposerProps['runtime']>;
  contextUsage?: { usedTokens: number; contextWindow: number } | null; attachMenuExtra?: () => null; queueItems?: never[] } = {}): ChatComposerProps {
  return {
    mode: 'chat',
    emptyState: { showCenteredEmptyChat: false, greetingLine: 'Hi', belowEmptyComposer: <>{null}{intro}</> },
    attachments: { attachedImages, setAttachedImages: () => {}, pendingChatDocuments, removePendingDocument: () => {},
      attachmentError: null, fileInputRef, docInputRef, onAddImages: () => {}, onAddDocumentsFromPicker: () => {},
      onOpenAttachmentPreview: () => {}, onOpenFilePreview: () => {} },
    runtime: { composerNotice: null, isSendBlocked: false, isActiveLoading: true, isTemporaryChat: false,
      blockedComposerContent: null, ...overrides.runtime },
    inputState: { replyContext: null, setReplyContext: () => {}, textareaRef, input: '', inputRevision: 0,
      onInputChange: () => {}, onMentionsChange: () => {}, onPaste: () => {}, hasComposerText: false, ...overrides.input },
    toolState: { showAttachMenu: false, setShowAttachMenu: () => {}, attachMenuRef, selectedToolIds: [], memoryEnabled: false,
      capabilities, onToggleTool: () => {}, onToggleMemory: () => {}, onRemoveTool: () => {},
      ...(overrides.attachMenuExtra ? { attachMenuExtra: overrides.attachMenuExtra } : {}) },
    modeState: { onModeChange: () => {}, generationChip: null, setGenerationChip: () => {}, showModeMenu: false,
      setShowModeMenu: () => {}, modeMenuRef, onNavigateMode: () => {} },
    actions: { onStop: () => {}, onSend: overrides.send ?? (() => {}) },
    surface: { mentionCategories: [], contextUsage: overrides.contextUsage === undefined ? { usedTokens: 10, contextWindow: 100 } : overrides.contextUsage },
    queue: { running: true, items: overrides.queueItems ?? [], paused: false, onQueueDraft: () => {}, onSteerDraft: () => {},
      onSteerItem: () => {}, onEditItem: () => {}, onRemoveItem: () => {} } as unknown as ChatComposerProps['queue'],
  }
}

test('a streamed update that rebuilds composer props with the same data does not re-render the composer', () => {
  assert.equal(sameChatComposerProps(props(), props()), true)
})

test('composer data, rendered content and render functions still re-render the composer', () => {
  const base = props()
  assert.equal(sameChatComposerProps(base, props({ input: { hasComposerText: true } })), false)
  assert.equal(sameChatComposerProps(base, props({ runtime: { isActiveLoading: false } })), false)
  assert.equal(sameChatComposerProps(base, props({ runtime: { isSendBlocked: true } })), false)
  assert.equal(sameChatComposerProps(base, props({ contextUsage: { usedTokens: 20, contextWindow: 100 } })), false)
  assert.equal(sameChatComposerProps(base, props({ contextUsage: null })), false)
  assert.equal(sameChatComposerProps(base, props({ queueItems: [{ id: 'q1' }] as never[] })), false)
  assert.equal(sameChatComposerProps(base, props({ runtime: { beforeComposerContent: <Intro /> } })), false)
  assert.equal(sameChatComposerProps(props({ attachMenuExtra: () => null }), props({ attachMenuExtra: () => null })), false)
  const withSuggestion = { ...base, actions: { ...base.actions, onEmptySuggestion: () => {} } }
  assert.equal(sameChatComposerProps(base, withSuggestion), false)
})

test('composer handlers keep their identity and call the latest committed handler', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  const seen: ComposerViewProps[] = []
  const calls: string[] = []
  function Probe({ value }: { value: ChatComposerProps }) {
    seen.push(useComposerViewProps(value))
    return null
  }
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => { renderer = create(<Probe value={props({ send: () => { calls.push('first') } })} />) })
  await act(async () => renderer!.update(<Probe value={props({ send: () => { calls.push('second') } })} />))
  const [before, after] = [seen.at(-2)!, seen.at(-1)!]
  assert.equal(before.onSend, after.onSend)
  assert.equal(before.queue?.onSteerDraft, after.queue?.onSteerDraft)
  assert.equal(before.textareaRef, textareaRef)
  await before.onSend()
  assert.deepEqual(calls, ['second'])
  await act(async () => renderer!.unmount())
})
