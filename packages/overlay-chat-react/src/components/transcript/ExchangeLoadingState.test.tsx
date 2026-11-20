import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantVisualBlock, ChatExchangeStatus } from '@overlay/chat-core'
import { ChatExchange } from './ChatExchange'
import { ExchangeLoadingState, exchangeLoadingPresentation } from './ExchangeLoadingState'
import { currentWorkingStep } from '../exchange/working-orb'

const text = [{ kind: 'text', text: 'Partial' }] satisfies AssistantVisualBlock[]
const file = [{ kind: 'file', url: 'data:image/png;base64,AA==', mediaType: 'image/png' }] satisfies AssistantVisualBlock[]
const tool = [{
  kind: 'tool',
  key: 'tool-1',
  name: 'search',
  state: 'input-available',
}] satisfies AssistantVisualBlock[]
const chatSurfaceCss = readFileSync(
  new URL('../../styles/chat-surface.css', import.meta.url),
  'utf8',
)

const lookMarks = (markup: string) => markup.match(/data-working-line/g)?.length ?? 0

function renderChatExchange(responseText: string, responseInProgress: boolean, status?: ChatExchangeStatus) {
  const blocks = [{ kind: 'text', text: responseText }] satisfies AssistantVisualBlock[]
  return renderToStaticMarkup(
    <ChatExchange
      userMsgId="user-1"
      userBodyText="Question"
      userDocumentNames={[]}
      userImages={[]}
      exchIdx={0}
      responseModelId="model"
      assistantVisualBlocks={blocks}
      isStreaming={responseInProgress}
      isTextStreaming={responseInProgress}
      errorMessage={null}
      responseInProgress={responseInProgress}
      status={status}
      interrupted={status === 'interrupted'}
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

test('active exchange statuses show one working line between tools and none while a tool runs', () => {
  const activeCases = [
    ['submitted', [], 'Thinking'],
    ['streaming', text, 'Writing the reply'],
    ['streaming', file, 'Thinking'],
    ['executing-tool', tool, null],
    ['awaiting-approval', tool, null],
  ] as const

  for (const [status, blocks, line] of activeCases) {
    const presentation = exchangeLoadingPresentation(status, blocks)
    assert.deepEqual(presentation, {
      active: true,
      inlineTextMarker: false,
      marker: 'standalone',
    })

    const markup = renderToStaticMarkup(<ExchangeLoadingState presentation={presentation} blocks={blocks} />)
    if (line === null) {
      assert.equal(markup, '', `${status}: the running tool row carries the orb`)
      continue
    }
    assert.equal(lookMarks(markup), 1, status)
    assert.match(markup, /data-working-orb="thinking"/, status)
    assert.match(markup, new RegExp(line), status)
    assert.match(markup, /data-loading-presentation="standalone"/, status)
    assert.doesNotMatch(markup, /overlay-mark/, status)
  }
})

test('the working line names the running step in the transcript wording', () => {
  const asking = [{ kind: 'tool', key: 'a', name: 'ask_agent', state: 'input-available', toolInput: { agent: 'Quill', message: 'What did you do?' } }] satisfies AssistantVisualBlock[]
  assert.deepEqual(currentWorkingStep(asking), { orb: 'asking', lead: 'Asking Quill', rest: 'What did you do?' })
  assert.equal(currentWorkingStep([]).lead, 'Thinking')
  assert.equal(currentWorkingStep(text).lead, 'Writing the reply')
})

test('settled exchange statuses render no loading mark', () => {
  for (const status of ['completed', 'interrupted', 'error'] as const) {
    const presentation = exchangeLoadingPresentation(status, text)
    assert.deepEqual(presentation, {
      active: false,
      inlineTextMarker: false,
      marker: 'none',
    })
    assert.equal(renderToStaticMarkup(<ExchangeLoadingState presentation={presentation} />), '')
  }
})

test('legacy compact presentation remains accepted as the same working line', () => {
  const markup = renderToStaticMarkup(
    <ExchangeLoadingState
      presentation={{ active: true, inlineTextMarker: false, marker: 'compact' }}
    />,
  )

  assert.equal(lookMarks(markup), 1)
  assert.match(markup, /data-loading-presentation="standalone"/)
  assert.equal(
    renderToStaticMarkup(
      <ExchangeLoadingState
        presentation={{ active: false, inlineTextMarker: false, marker: 'none' }}
      />,
    ),
    '',
  )
})

test('ChatExchange places its only working line after finished tool and text output', () => {
  const blocks = [
    { ...tool[0], state: 'output-available' },
    { kind: 'text', text: 'Assistant output sentinel' },
  ] satisfies AssistantVisualBlock[]
  const markup = renderToStaticMarkup(
    <ChatExchange
      userMsgId="user-1"
      userBodyText="Question"
      userDocumentNames={[]}
      userImages={[]}
      exchIdx={0}
      responseModelId="model"
      assistantVisualBlocks={blocks}
      isStreaming
      isTextStreaming
      errorMessage={null}
      responseInProgress
      status="executing-tool"
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
  const outputIndex = markup.indexOf('Assistant output sentinel')
  const loadingIndex = markup.indexOf('data-loading-presentation="standalone"')

  assert.ok(outputIndex >= 0)
  assert.ok(loadingIndex > outputIndex)
  assert.equal(lookMarks(markup), 1)
  assert.match(markup.slice(loadingIndex), /data-working-orb=/)
  assert.doesNotMatch(markup, /overlay-stream-marker/)
})

test('a live response overrides completed status until the final text settles', () => {
  const initial = renderChatExchange('A river is a natural', true, 'completed')
  const initialMarkIndex = initial.indexOf('data-loading-presentation="standalone"')
  assert.ok(initial.indexOf('A river is a natural') < initialMarkIndex)
  assert.equal(lookMarks(initial), 1)
  assert.match(initial.slice(initialMarkIndex), /data-working-orb=/)
  assert.match(initial, /data-text-streaming="true"/)

  const updated = renderChatExchange('A river is a natural flowing river.', true, 'completed')
  const updatedMarkIndex = updated.indexOf('data-loading-presentation="standalone"')
  assert.ok(updated.indexOf('A river is a natural flowing river.') < updatedMarkIndex)
  assert.equal(lookMarks(updated), 1)

  const finalText = 'A river is a natural flowing river. Final answer sentinel.'
  const settled = renderChatExchange(finalText, false, 'completed')
  assert.ok(settled.includes(finalText))
  assert.equal(lookMarks(settled), 0)
  assert.doesNotMatch(settled, /data-text-streaming="true"/)
})

test('stale live flags do not override explicit error or interrupted statuses', () => {
  for (const status of ['error', 'interrupted'] as const) {
    const markup = renderChatExchange('Partial response', true, status)
    assert.match(markup, /data-text-streaming="true"/, status)
    assert.equal(lookMarks(markup), 0, status)
    assert.doesNotMatch(markup, /data-loading-presentation="standalone"/, status)
  }
})

test('obsolete loading reel styles are gone while generic inline marker styles remain', () => {
  assert.doesNotMatch(chatSurfaceCss, /overlayChatLoadingWordReel|overlay-loading-word|overlay-loading-tool-logo/)
  assert.match(chatSurfaceCss, /\.overlay-stream-marker \{/)
  assert.match(chatSurfaceCss, /\.overlay-stream-marker--standalone \{/)
})
