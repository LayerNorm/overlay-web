import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { AppShellLoadingFallback, ProjectsRouteSkeleton } from './AppRouteSkeletons'

test('ProjectsRouteSkeleton renders only page content, not a nested sidebar', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const markup = renderToStaticMarkup(<ProjectsRouteSkeleton />)

  assert.equal(markup.includes('border-r'), false)
  assert.equal(markup.includes('w-56'), false)
  assert.equal(markup.match(/bg-\[var\(--surface-elevated\)\]/g)?.length, 6)
})

test('AppShellLoadingFallback renders only the animated app brand', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const markup = renderToStaticMarkup(<AppShellLoadingFallback />)

  assert.equal(markup.includes('Loading overlay'), true)
  assert.equal(markup.includes('app-brand-loader-logo'), true)
  assert.equal(markup.includes('app-brand-loader-word'), true)
  assert.equal(markup.includes('border-r'), false)
})
