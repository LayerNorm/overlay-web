import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { AppShellLoadingFallback, InitialAppLoading, ProjectsRouteSkeleton } from './AppRouteSkeletons'

test('ProjectsRouteSkeleton renders only page content, not a nested sidebar', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const markup = renderToStaticMarkup(<ProjectsRouteSkeleton />)

  assert.equal(markup.includes('border-r'), false)
  assert.equal(markup.includes('w-56'), false)
  assert.equal(markup.match(/bg-\(--surface-elevated\)/g)?.length, 6)
})

test('AppShellLoadingFallback renders only the animated app brand', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const markup = renderToStaticMarkup(<AppShellLoadingFallback />)

  assert.equal(markup.includes('Loading Overlay'), true)
  assert.equal(markup.includes('app-brand-loader-lockup'), true)
  assert.equal(markup.includes('approved-brand'), true)
  assert.equal(markup.includes('approved-brand--look'), true)
  assert.equal(markup.includes('app-brand-loader-pulse'), false)
  assert.equal(markup.includes('app-brand-loader--steady'), false)
  assert.equal(markup.includes('Your AI Chief of Staff.'), true)
  assert.equal(markup.includes('border-r'), false)
})

test('nested shell and route fallbacks are settled before hydration', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  for (const fallback of [
    <AppShellLoadingFallback key="nested-shell" settled />,
    <InitialAppLoading key="route" />,
  ]) {
    const markup = renderToStaticMarkup(fallback)
    assert.equal(markup.includes('app-brand-loader--steady'), true)
    assert.equal(markup.includes('Opening Workspace'), true)
    assert.equal(markup.includes('Your AI Chief of Staff.'), false)
    assert.equal(markup.includes('approved-brand--look'), true)
  }
})
