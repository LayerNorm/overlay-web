import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArchiveToastContent } from './ArchiveToastHost'

test('custom archive toast owns a responsive wrapper, Undo, link, and accessible dismiss', () => {
  const html = renderToStaticMarkup(
    <ArchiveToastContent
      detail={{ name: 'Project', summary: '3 items archived', undo: async () => undefined }}
      dismiss={() => undefined}
    />,
  )

  assert.match(html, /role="status" class="flex w-full flex-wrap items-center gap-2"/)
  assert.match(html, /min-w-0 flex-1 break-words/)
  assert.match(html, /3 items archived/)
  assert.match(html, />Undo</)
  assert.match(html, /View archived/)
  assert.match(html, /aria-label="Dismiss archive notification"/)
})
