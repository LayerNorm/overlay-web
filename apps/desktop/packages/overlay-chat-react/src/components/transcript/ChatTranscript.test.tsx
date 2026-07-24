import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatTranscriptView } from '@overlay/chat-core'
import { ChatTranscript } from './ChatTranscript'
import { ExchangeActions } from './ExchangeActions'
import { MediaExchange } from './MediaExchange'

test('ChatTranscript renders normalized exchanges in contract order without wrapper markup', () => {
  const view: ChatTranscriptView = {
    version: 1,
    exchanges: [
      {
        id: 'turn-1',
        turnId: 'turn-1',
        index: 0,
        mode: 'ask',
        generationMode: 'text',
        user: {
          id: 'user-1',
          text: 'One',
          documentNames: [],
          indexedAttachments: [],
          images: [],
          mentions: [],
          replyThread: null,
        },
        responses: [],
        selectedResponseIndex: -1,
        selectedModelId: null,
        status: 'idle',
        media: null,
      },
      {
        id: 'turn-2',
        turnId: 'turn-2',
        index: 1,
        mode: 'ask',
        generationMode: 'image',
        user: {
          id: 'user-2',
          text: 'Two',
          documentNames: [],
          indexedAttachments: [],
          images: [],
          mentions: [],
          replyThread: null,
        },
        responses: [],
        selectedResponseIndex: -1,
        selectedModelId: null,
        status: 'idle',
        media: { kind: 'image', results: [] },
      },
    ],
  }
  const markup = renderToStaticMarkup(
    <ChatTranscript
      view={view}
      actions={{
        renderExchange: (exchange) => <span data-turn={exchange.turnId}>{exchange.user.text}</span>,
      }}
    />,
  )

  assert.equal(markup, '<span data-turn="turn-1">One</span><span data-turn="turn-2">Two</span>')
})

test('MediaExchange keeps platform-neutral image/video loading behavior', () => {
  const markup = renderToStaticMarkup(
    <MediaExchange
      exchangeIndex={0}
      turnId="turn-video"
      kind="video"
      promptText="Animate this"
      userImages={[]}
      replyThread={null}
      results={[{
        type: 'video',
        status: 'completed',
        url: 'data:video/mp4;base64,AA==',
      }]}
      modelIds={['video-model']}
      modelLabel="Video model"
      getModelDisplayName={() => 'Video model'}
      onJumpToReply={() => undefined}
      onDeleteTurn={() => undefined}
      onReply={() => undefined}
      onOpenAttachmentPreview={() => undefined}
    />,
  )

  assert.match(markup, /preload="metadata"/)
  assert.match(markup, /plays[Ii]nline=""/)
  assert.doesNotMatch(markup, /autoplay/)
})

test('MediaExchange exposes retry only for failed generations', () => {
  const failedMarkup = renderToStaticMarkup(
    <MediaExchange
      exchangeIndex={0}
      turnId="turn-image"
      kind="image"
      promptText="Draw this"
      userImages={[]}
      replyThread={null}
      results={[{ type: 'image', status: 'failed', error: 'Provider failed' }]}
      modelIds={['image-model']}
      modelLabel="Image model"
      getModelDisplayName={() => 'Image model'}
      onJumpToReply={() => undefined}
      onDeleteTurn={() => undefined}
      onReply={() => undefined}
      onRetry={() => undefined}
      onOpenAttachmentPreview={() => undefined}
    />,
  )

  const webCompatibleMarkup = renderToStaticMarkup(
    <MediaExchange
      exchangeIndex={0}
      turnId="turn-image"
      kind="image"
      promptText="Draw this"
      userImages={[]}
      replyThread={null}
      results={[{ type: 'image', status: 'failed', error: 'Provider failed' }]}
      modelIds={['image-model']}
      modelLabel="Image model"
      getModelDisplayName={() => 'Image model'}
      onJumpToReply={() => undefined}
      onDeleteTurn={() => undefined}
      onReply={() => undefined}
      onOpenAttachmentPreview={() => undefined}
    />,
  )

  assert.match(failedMarkup, /aria-label="Retry generation"/)
  assert.doesNotMatch(webCompatibleMarkup, /aria-label="Retry generation"/)
})

test('exchange actions keep branch and sources immediately after reply', () => {
  const markup = renderToStaticMarkup(
    <ExchangeActions
      copyPlainText="Answer"
      isExiting={false}
      retryDisabled={false}
      onDeleteTurn={() => undefined}
      onReply={() => undefined}
      onBranch={() => undefined}
      turnIdForActions="turn-1"
      actionsLocked={false}
      webSources={[
        {
          url: 'https://example.com/source',
          title: 'Source',
          origin: 'web-search',
        },
      ]}
      onOpenSources={() => undefined}
      userMsgId="user-1"
      isSourcesOpenForThis={false}
      modelLabel="Model"
    />,
  )

  const replyIndex = markup.indexOf('aria-label="Reply"')
  const branchIndex = markup.indexOf('aria-label="Branch chat from here"')
  const sourcesIndex = markup.indexOf('aria-label="Open sources"')
  assert.ok(replyIndex >= 0)
  assert.ok(replyIndex < branchIndex)
  assert.ok(branchIndex < sourcesIndex)
})
