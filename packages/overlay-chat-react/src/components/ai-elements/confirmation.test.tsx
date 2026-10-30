import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationBody,
  ConfirmationIcon,
  ConfirmationRequest,
  ConfirmationTitle,
} from './confirmation'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('approval card is flat and lists Approve before Deny without a row mark', () => {
  const html = renderToStaticMarkup(
    <Confirmation>
      <ConfirmationIcon />
      <ConfirmationBody>
        <ConfirmationTitle>Send email</ConfirmationTitle>
        <ConfirmationRequest>gmail_send</ConfirmationRequest>
        <ConfirmationActions>
          <ConfirmationAction tone="primary">Approve</ConfirmationAction>
          <ConfirmationAction>Deny</ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationBody>
    </Confirmation>,
  )
  assert.match(html, /data-slot="confirmation" role="group"/)
  assert.doesNotMatch(html, /\bborder\b/)
  assert.equal(renderToStaticMarkup(<ConfirmationIcon />), '')
  assert.doesNotMatch(html, /class="overlay-mark /)
  assert.ok(html.indexOf('Approve') < html.indexOf('Deny'))
})
