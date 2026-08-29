import assert from 'node:assert/strict'
import test from 'node:test'
import { composerAnchorToMarkdown, joinComposerMarkdownSegments } from './composer-markdown'

test('keeps text, links, and mention chips on the same composer line', () => {
  assert.equal(joinComposerMarkdownSegments([
    { markdown: 'Read ', block: false },
    { markdown: 'tinyfish.ai', block: false },
    { markdown: ' with ', block: false },
    { markdown: '@Firecrawl', block: false },
    { markdown: ' MCP', block: false },
  ]), 'Read tinyfish.ai with @Firecrawl MCP')
})

test('preserves real block boundaries', () => {
  assert.equal(joinComposerMarkdownSegments([
    { markdown: 'First paragraph', block: true },
    { markdown: '- item', block: true },
  ]), 'First paragraph\n- item')
})

test('preserves a shortened anchor label and its full destination in Markdown', () => {
  assert.equal(
    composerAnchorToMarkdown(
      'x.com',
      'https://x.com/todaywasawesome/status/1961234567890123456?s=20&t=overlay',
    ),
    '[x.com](<https://x.com/todaywasawesome/status/1961234567890123456?s=20&t=overlay>)',
  )
})

test('does not serialize unsafe anchor protocols', () => {
  assert.equal(composerAnchorToMarkdown('click me', 'javascript:alert(1)'), 'click me')
})
