import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import type { ChatMessageListActions } from '../ChatMessageList'
import { useChatRowCallbacks } from './useChatRowCallbacks'

test('stable row actions forward arguments and results to the latest committed handlers', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  let renderer: ReturnType<typeof create> | undefined
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(async () => {
    if (renderer) await act(() => renderer!.unmount())
    if (previous) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  const noop = () => {}
  const called: string[] = []
  const actions: ChatMessageListActions = {
    onJumpToReply: noop, onDeleteTurn: noop, onReplyToMediaPrompt: noop,
    onReplyToAssistantText: text => { called.push(`old:${text}`) }, onBranch: noop,
    onOpenDraft: noop, onCreateAutomationDraft: noop, onOpenSources: noop, onRetry: noop,
    onOpenFilePreview: noop, onOpenAttachmentPreview: noop, onContinue: noop, onGeneratedUiChange: noop,
  }
  let observed!: ChatMessageListActions
  function Probe({ value }: { value: ChatMessageListActions }) {
    const actions = useChatRowCallbacks(value)
    useEffect(() => { observed = actions }, [actions])
    return null
  }
  await act(() => { renderer = create(createElement(Probe, { value: actions })) })
  const first = observed
  const result = Promise.resolve()
  await act(() => renderer!.update(createElement(Probe, { value: {
    ...actions,
    onReplyToAssistantText: (text, turnId) => { called.push(`new:${text}:${turnId}`) },
    onDeleteTurn: turnId => { called.push(`delete:${turnId}`); return result },
  } })))
  assert.equal(observed, first)
  first.onReplyToAssistantText('reply', 'turn')
  assert.equal(first.onDeleteTurn('turn'), result)
  assert.deepEqual(called, ['new:reply:turn', 'delete:turn'])
})
