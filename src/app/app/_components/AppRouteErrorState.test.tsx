import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { AppRouteErrorState } from './AppRouteErrorState'

test('AppRouteErrorState renders a scoped retry affordance', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const markup = renderToStaticMarkup(
    <AppRouteErrorState
      error={new Error('Deliberate route failure')}
      reset={() => undefined}
      title="Knowledge failed to load"
    />,
  )

  assert.equal(markup.includes('data-testid="app-route-error"'), true)
  assert.equal(markup.includes('Knowledge failed to load'), true)
  assert.equal(markup.includes('Retry the segment without leaving the app.'), true)
  assert.equal(markup.includes('Retry'), true)
})
