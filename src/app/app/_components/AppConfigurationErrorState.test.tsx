import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { OverlayConfigError } from '@/server/config'
import { AppConfigurationErrorState } from './AppConfigurationErrorState'

// The component is a server component; tsx compiles JSX to React.createElement.
;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('a missing provider value is reported as a configuration fault', () => {
  const markup = renderToStaticMarkup(
    <AppConfigurationErrorState
      error={new OverlayConfigError('Overlay provider configuration is invalid', [
        'auth.workos.clientId is required when auth.provider is workos',
      ])}
    />,
  )

  assert.match(markup, /data-testid="app-configuration-error"/)
  assert.match(markup, /Overlay provider configuration is invalid/)
  assert.match(markup, /auth.workos.clientId is required/)
  // The on-prem profile hint only helps when configuration is the problem.
  assert.match(markup, /onprem-minimal.example.json/)
})

test('an unreachable backend is not reported as invalid configuration', () => {
  const markup = renderToStaticMarkup(
    <AppConfigurationErrorState
      error={new Error(
        'Convex query admin/authorization:resolveSubject could not reach '
        + 'different-caiman-77.convex.cloud (from NEXT_PUBLIC_CONVEX_URL): fetch failed',
      )}
    />,
  )

  assert.match(markup, /data-testid="app-dependency-error"/)
  assert.match(markup, /could not reach a required service/)
  assert.match(markup, /different-caiman-77.convex.cloud/)
  assert.match(markup, /NEXT_PUBLIC_CONVEX_URL/)
  assert.match(markup, /redeployed after the value last changed/)
  // Copy that would send the reader after a non-existent setting must not show.
  assert.doesNotMatch(markup, /provider configuration is invalid/)
  assert.doesNotMatch(markup, /onprem-minimal.example.json/)
})

test('a bare failure is stated once rather than duplicated as its own detail', () => {
  const markup = renderToStaticMarkup(
    <AppConfigurationErrorState error={new Error('fetch failed')} />,
  )

  assert.equal(markup.split('fetch failed').length - 1, 1)
})
