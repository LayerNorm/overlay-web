import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppBreadcrumbContext, AppBreadcrumbs } from './AppBreadcrumbs'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('breadcrumbs preserve scope, page, subpage and selected item with one current page', () => {
  const html = renderToStaticMarkup(
    <AppBreadcrumbContext.Provider value={{ items: [{ label: 'Workspace' }, { label: 'Work' }] }}>
      <AppBreadcrumbs items={[{ label: 'Board' }]} title="Launch plan" />
    </AppBreadcrumbContext.Provider>,
  )
  assert.match(html, /aria-label="Breadcrumb"/)
  assert.match(html, /Workspace[\s\S]*Work[\s\S]*Board[\s\S]*Launch plan/)
  assert.equal(html.match(/aria-current="page"/g)?.length, 1)
  assert.match(html, /min-w-0 truncate/)
})

test('the page heading is not duplicated and explicit agent/thread labels are retained', () => {
  const html = renderToStaticMarkup(
    <AppBreadcrumbContext.Provider value={{ items: [{ label: 'Personal' }, { label: 'Agents' }] }}>
      <AppBreadcrumbs items={[{ label: 'Agents' }, { label: 'Researcher' }]} title="Weekly report" />
    </AppBreadcrumbContext.Provider>,
  )
  assert.equal(html.match(/>Agents</g)?.length, 1)
  assert.match(html, /Personal[\s\S]*Agents[\s\S]*Researcher[\s\S]*Weekly report/)
})
