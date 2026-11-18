import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantVisualBlock, ChatExchangeStatus } from '@overlay/chat-core'
import { ChatExchange } from './ChatExchange'
import { ExchangeLoadingState, exchangeLoadingPresentation } from './ExchangeLoadingState'

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

const lookMarks = (markup: string) => markup.match(/overlay-mark--look/g)?.length ?? 0

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

test('active exchange statuses show one 24px footer mark and suppress inline markers', () => {
  const activeCases = [
    ['submitted', []],
    ['streaming', text],
    ['streaming', file],
    ['executing-tool', tool],
    ['awaiting-approval', tool],
  ] as const

  for (const [status, blocks] of activeCases) {
    const presentation = exchangeLoadingPresentation(status, blocks)
    assert.deepEqual(presentation, {
      active: true,
      inlineTextMarker: false,
      marker: 'standalone',
    })

    const markup = renderToStaticMarkup(<ExchangeLoadingState presentation={presentation} />)
    assert.equal(lookMarks(markup), 1, status)
    assert.match(markup, /width="24"/, status)
    assert.match(markup, /height="24"/, status)
    assert.match(markup, /data-loading-presentation="standalone"/, status)
    assert.doesNotMatch(markup, /Thinking|Contemplating|Comprehending|Reasoning|Pondering|Considering/, status)
  }
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

test('legacy compact presentation remains accepted as the same footer mark', () => {
  const markup = renderToStaticMarkup(
    <ExchangeLoadingState
      presentation={{ active: true, inlineTextMarker: false, marker: 'compact' }}
    />,
  )

  assert.equal(lookMarks(markup), 1)
  assert.match(markup, /width="24"/)
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

test('ChatExchange places its only loading mark after active tool and text output', () => {
  const blocks = [
    ...tool,
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
  assert.match(markup.slice(loadingIndex), /width="24"/)
  assert.doesNotMatch(markup, /overlay-stream-marker/)
})

test('a live response overrides completed status until the final text settles', () => {
  const initial = renderChatExchange('A river is a natural', true, 'completed')
  const initialMarkIndex = initial.indexOf('data-loading-presentation="standalone"')
  assert.ok(initial.indexOf('A river is a natural') < initialMarkIndex)
  assert.equal(lookMarks(initial), 1)
  assert.match(initial.slice(initialMarkIndex), /width="24"/)
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
