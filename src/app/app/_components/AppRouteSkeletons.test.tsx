import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {
  AppShellLoadingFallback,
  KnowledgeRouteSkeleton,
  ProjectsRouteSkeleton,
} from './AppRouteSkeletons'

test('ProjectsRouteSkeleton renders only page content, not a nested sidebar', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const markup = renderToStaticMarkup(<ProjectsRouteSkeleton />)

  assert.equal(markup.includes('role="status"'), true)
  assert.equal(markup.includes('aria-label="Loading projects"'), true)
  assert.equal(markup.includes('data-testid="projects-route-loading"'), true)
  assert.equal(markup.includes('border-r'), false)
  assert.equal(markup.includes('w-56'), false)
  assert.equal(markup.match(/bg-\[var\(--surface-elevated\)\]/g)?.length, 6)
})

test('KnowledgeRouteSkeleton exposes an accessible route loading state', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const markup = renderToStaticMarkup(<KnowledgeRouteSkeleton />)

  assert.equal(markup.includes('role="status"'), true)
  assert.equal(markup.includes('aria-label="Loading knowledge"'), true)
  assert.equal(markup.includes('data-testid="knowledge-route-loading"'), true)
  assert.equal(markup.includes('border-r'), false)
})

test('AppShellLoadingFallback renders only the animated app brand', () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const markup = renderToStaticMarkup(<AppShellLoadingFallback />)

  assert.equal(markup.includes('Loading overlay'), true)
  assert.equal(markup.includes('app-brand-loader-logo'), true)
  assert.equal(markup.includes('app-brand-loader-word'), true)
  assert.equal(markup.includes('border-r'), false)
})
