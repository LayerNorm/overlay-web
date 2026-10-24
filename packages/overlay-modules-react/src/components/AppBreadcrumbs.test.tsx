import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppBreadcrumbContext, AppBreadcrumbs } from './AppBreadcrumbs'
import { Input } from '@overlay/ui/primitives'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('breadcrumbs preserve scope, page, subpage and selected item with one current page', () => {
  const html = renderToStaticMarkup(
    <AppBreadcrumbContext.Provider value={{ items: [{ label: 'Workspace' }, { label: 'Work' }] }}>
      <AppBreadcrumbs items={[{ label: 'Board' }]} title="Launch plan" />
    </AppBreadcrumbContext.Provider>,
  )
  assert.match(html, /aria-label="Breadcrumb"/)
  assert.match(html, /data-slot="breadcrumb-list"/)
  assert.equal(html.match(/data-slot="breadcrumb-separator"/g)?.length, 3)
  assert.match(html, /data-slot="breadcrumb-page" aria-current="page"/)
  assert.match(html, /Workspace[\s\S]*Work[\s\S]*Board[\s\S]*Launch plan/)
  assert.equal(html.match(/aria-current="page"/g)?.length, 1)
  assert.match(html, /min-w-0 truncate/)
})

test('an editable current note title does not inherit disabled link semantics', () => {
  const html = renderToStaticMarkup(
    <AppBreadcrumbs title={<Input aria-label="Note title" defaultValue="Weekly report" />} />,
  )
  assert.match(html, /aria-current="page"/)
  assert.match(html, /aria-label="Note title"/)
  assert.doesNotMatch(html, /aria-disabled=|role="link"| disabled(?:=|\/?\>)/)
})

test('shadcn links compose with the app router and preserve the page heading', () => {
  const html = renderToStaticMarkup(
    <AppBreadcrumbContext.Provider value={{
      items: [{ label: 'Workspace', href: '/app/work?scope=workspace' }, { label: 'Work', href: '/app/work?scope=workspace' }],
      renderLink: (item, className) => <a href={item.href} className={className}>{item.label}</a>,
    }}>
      <AppBreadcrumbs asHeading title="Board" />
    </AppBreadcrumbContext.Provider>,
  )
  assert.equal(html.match(/data-slot="breadcrumb-link"/g)?.length, 2)
  assert.equal(html.match(/aria-current="page"/g)?.length, 1)
  assert.match(html, /<h1[^>]*><span[^>]*data-slot="breadcrumb-page"[^>]*>Board<\/span><\/h1>/)
  assert.doesNotMatch(html, /<a[^>]*>\s*<a/)
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
