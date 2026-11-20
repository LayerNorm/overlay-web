import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NotebookAgentPanel } from '@overlay/modules-react/notes'
import type { PersonalTranscriptRow } from './chat/personal-transcript'
import { createWebChatTranscriptAdapter } from './chat/toChatTranscriptView'
import { embeddedPersonalExchanges, type EmbeddedTurnEnd } from './chat/embedded-personal-transcript'
import { EmbeddedPersonalTranscriptView } from './EmbeddedPersonalTranscript'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

type Message = PersonalTranscriptRow['message']

function row(overrides: Partial<Message> & Pick<Message, '_id' | 'role'>): PersonalTranscriptRow {
  return {
    message: {
      _creationTime: 1, conversationId: 'conversation', userId: 'user', turnId: 'turn-1', mode: 'act',
      content: '', contentType: 'text', createdAt: overrides.role === 'user' ? 1 : 2, ...overrides,
    } as Message,
    contextUser: null,
    outputs: [],
  }
}

const question = row({ _id: 'user-1', role: 'user', content: 'Tighten the intro', parts: [{ type: 'text', text: 'Tighten the intro' }] })

function panel(reply: PersonalTranscriptRow, endedTurn: EmbeddedTurnEnd | null = null) {
  const exchanges = embeddedPersonalExchanges({
    rows: [question, reply], pendingSend: null, endedTurn, toTranscriptView: createWebChatTranscriptAdapter(),
  })
  return renderToStaticMarkup(
    <NotebookAgentPanel
      items={[{ type: 'user', text: 'Tighten the intro' }]}
      transcript={<EmbeddedPersonalTranscriptView exchanges={exchanges} />}
      running={endedTurn === null}
      composer={null}
      renderMarkdownMessage={() => null}
    />,
  )
}

test('the note panel streams a reply with the chat body and the one chat loading mark', () => {
  const html = panel(row({
    _id: 'reply-1', role: 'assistant', status: 'generating', content: 'Rewriting the opening',
    parts: [{ type: 'text', text: 'Rewriting the opening' }],
  }))
  assert.equal(html.match(/data-loading-presentation="standalone"/g)?.length, 1)
  assert.match(html, /aria-label="Overlay is responding"/)
  assert.match(html, /Rewriting the opening/)
  assert.equal(html.match(/Tighten the intro/g)?.length, 1)
  assert.doesNotMatch(html, /overlay-stream-marker/)
})

test('a stopped note reply shows the interrupted notice and no mark; a failed one shows the failure', () => {
  const stopped = panel(row({
    _id: 'reply-1', role: 'assistant', status: 'generating', content: 'Half', parts: [{ type: 'text', text: 'Half' }],
  }), { turnId: 'turn-1', outcome: 'cancelled' })
  assert.doesNotMatch(stopped, /data-loading-presentation/)
  assert.match(stopped, /interrupted/i)

  const failed = panel(row({ _id: 'reply-1', role: 'assistant', status: 'generating', content: '', parts: [] }),
    { turnId: 'turn-1', outcome: 'failed' })
  assert.doesNotMatch(failed, /data-loading-presentation/)
  assert.match(failed, /The response could not be completed\./)
})
