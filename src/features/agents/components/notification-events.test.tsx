import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentComputerRecoveryNotice } from './AgentComputerRecoveryNotice'
import { consumeOneShotNotification, notifyActionError } from './notification-events'

test('each repeated action failure notifies once at its event path', () => {
  const messages: string[] = []
  const announce = (message: string) => messages.push(message)

  notifyActionError(announce, new Error('Save failed.'), 'Could not save.')
  notifyActionError(announce, new Error('Save failed.'), 'Could not save.')

  assert.deepEqual(messages, ['Save failed.', 'Save failed.'])
})

test('a rerendered one-shot callback does not replay its notification', () => {
  const handled = { current: null as string | null }

  assert.equal(consumeOneShotNotification('connected:slack', handled), true)
  assert.equal(consumeOneShotNotification('connected:slack', handled), false)
})

test('computer load and provision failures remain visible with load retry', () => {
  const html = renderToStaticMarkup(
    <AgentComputerRecoveryNotice
      loadError="Could not load the computer."
      provisionError="Machine setup failed."
      onRetryLoad={() => undefined}
    />,
  )

  assert.match(html, /Could not load the computer\./)
  assert.match(html, /Machine setup failed\./)
  assert.match(html, /Try again/)
})
