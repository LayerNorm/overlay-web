import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  NATIVE_RUN_RETIRED_MESSAGE,
  NATIVE_THREAD_UNAVAILABLE_MESSAGE,
} from '@/shared/agents/native-run-retirement'
import { NativeThreadReadOnlyFooter } from './NativeThreadReadOnlyFooter'
import type { NativeThreadSafety } from './chat/useNativeThreadSafety'

function render(status: NativeThreadSafety['status']) {
  const safety = {
    status,
    readOnly: true,
    notice: status === 'retired'
      ? NATIVE_RUN_RETIRED_MESSAGE
      : status === 'unavailable'
        ? NATIVE_THREAD_UNAVAILABLE_MESSAGE
        : 'Checking thread safety…',
    refresh: async () => status,
    ensureWritable: async () => false,
    checkWritable: async () => ({ accepted: false, status }),
    isCurrentScope: () => true,
  } as NativeThreadSafety
  return renderToStaticMarkup(
    <NativeThreadReadOnlyFooter safety={safety} onNewThread={() => undefined} />,
  )
}

test('retired footer shows the canonical message and New thread action', () => {
  const html = render('retired')
  assert.ok(html.includes(NATIVE_RUN_RETIRED_MESSAGE))
  assert.ok(html.includes('New thread'))
  assert.ok(!html.includes('Retry'))
})

test('unavailable footer shows Retry and checking footer has no action', () => {
  const unavailable = render('unavailable')
  assert.ok(unavailable.includes(NATIVE_THREAD_UNAVAILABLE_MESSAGE))
  assert.ok(unavailable.includes('Retry'))
  assert.ok(!unavailable.includes('New thread'))

  const checking = render('checking')
  assert.ok(checking.includes('Checking thread safety'))
  assert.ok(!checking.includes('<button'))
})
