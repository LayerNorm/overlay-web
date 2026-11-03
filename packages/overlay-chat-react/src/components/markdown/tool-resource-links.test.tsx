import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssistantVisualBlock } from '@overlay/chat-core'
import { MarkdownMessage } from '../MarkdownMessage'
import { AssistantVisualBlocks } from '../transcript/AssistantVisualBlocks'
import { ChatExchange, type ChatExchangeProps } from '../transcript/ChatExchange'
import { collectToolResourceHrefs, resolveToolResourceHref } from './tool-resource-links'

const noteHref = '/app/w/workspace-1/notes?id=note%3Aone&scope=personal'
const fileHref = '/api/v1/files/file%3Aone/content'
const noop = () => undefined

function tool(name: string, toolOutput: unknown, state = 'output-available'): AssistantVisualBlock {
  return { kind: 'tool', key: name, name, state, toolOutput }
}

function exchangeProps(blocks: AssistantVisualBlock[], isStreaming: boolean): ChatExchangeProps {
  return {
    userMsgId: 'user-1', userBodyText: 'Create a result', userDocumentNames: [], userImages: [],
    exchIdx: 0, responseModelId: 'model', assistantVisualBlocks: blocks,
    isStreaming, isTextStreaming: isStreaming, errorMessage: null, responseInProgress: isStreaming,
    turnIdForActions: null, modelLabel: 'Model', onDeleteTurn: noop, onReply: noop,
    actionsLocked: false, replyThreadMeta: null, onJumpToReply: noop, onOpenDraft: noop,
    onCreateAutomationDraft: noop, isSourcesOpenForThis: false,
  }
}

test('resource links come only from successful supported tool outputs', () => {
  assert.deepEqual(collectToolResourceHrefs([
    tool('create_note', { success: true, url: noteHref }),
    tool('get_note', { success: true, note: { url: noteHref } }),
    tool('computer_publish_file', { success: true, downloadUrl: fileHref }),
    tool('create_note', { success: false, url: '/app/notes?id=failed&scope=personal' }),
    tool('create_note', { success: true, url: '/app/notes?id=pending&scope=personal' }, 'input-available'),
    tool('web_fetch', { success: true, url: '/app/notes?id=external&scope=personal' }),
    tool('create_note', { success: true, url: 'https://external.example/app/notes?id=external&scope=personal' }),
    tool('create_note', { success: true, url: '/app/settings', saved: { url: noteHref } }),
    tool('computer_publish_file', { success: true, downloadUrl: '/api/v1/files/one/content?token=private' }),
  ]), [noteHref, fileHref])
})

test('invented origins resolve only for exact known resource paths and query strings', () => {
  for (const href of [noteHref, fileHref]) {
    assert.equal(resolveToolResourceHref(`http://localhost${href}`, [href]), href)
    assert.equal(resolveToolResourceHref(`https://invented.example${href}`, [href]), href)
    assert.equal(resolveToolResourceHref(`http://localhost${href}`, []), undefined)
  }
  for (const href of [
    'http://localhost/app/w/workspace-2/notes?id=note%3Aone&scope=personal',
    'http://localhost/app/w/workspace-1/notes?id=note%3Atwo&scope=personal',
    'http://localhost/app/w/workspace-1/notes?id=note%3Aone&scope=workspace',
    'https://docs.example/guide',
    `https://external.example${fileHref}?token=private`,
    `https://external.example${fileHref}#other`,
    `javascript:alert('${noteHref}')`,
    `//external.example${noteHref}`,
  ]) assert.equal(resolveToolResourceHref(href, [noteHref, fileHref]), undefined)
})

test('known links use the host app origin while unrelated external links stay external', () => {
  for (const isStreaming of [false, true]) {
    for (const appBaseUrl of [undefined, 'https://preview.example/']) {
      for (const href of [noteHref, fileHref]) {
        const html = renderToStaticMarkup(<MarkdownMessage
          text={`[Open saved result](http://localhost${href}) [Docs](https://docs.example/guide)`}
          isStreaming={isStreaming} appBaseUrl={appBaseUrl} toolResourceHrefs={[href]}
          suppressTypingIndicator
        />)
        const expected = `${appBaseUrl ? 'https://preview.example' : ''}${href}`.replaceAll('&', '&amp;')
        assert.ok(html.includes(`href="${expected}"`))
        assert.doesNotMatch(html, /href="http:\/\/localhost/)
        assert.match(html, /href="https:\/\/docs\.example\/guide"/)
      }
    }
  }
})

test('personal and room transcripts pass tool URLs to streaming and reloaded final answers', () => {
  for (const isStreaming of [false, true]) {
    for (const [name, output, href] of [
      ['create_note', { success: true, url: noteHref }, noteHref],
      ['get_note', { success: true, note: { url: noteHref } }, noteHref],
      ['computer_publish_file', { success: true, downloadUrl: fileHref }, fileHref],
    ] as const) {
      const blocks: AssistantVisualBlock[] = [
        tool(name, output),
        { kind: 'text', text: `[Open saved result](http://localhost${href})` },
      ]
      for (const element of [
        <ChatExchange key="personal" {...exchangeProps(blocks, isStreaming)} />,
        <AssistantVisualBlocks key="room" blocks={blocks} blockKeyPrefix="room" markdownKeyPrefix="room"
          isStreaming={isStreaming} isTextStreaming={isStreaming}
          onOpenDraft={noop} onCreateAutomationDraft={noop} />,
      ]) {
        const html = renderToStaticMarkup(element)
        const expected = href.replaceAll('&', '&amp;')
        assert.ok(html.includes(`href="${expected}"`))
        assert.doesNotMatch(html, /href="http:\/\/localhost/)
        assert.match(html, />Open saved result<\/a>/)
      }
    }
  }
})
