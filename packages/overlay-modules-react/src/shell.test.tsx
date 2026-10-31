import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppBreadcrumbContext, AppScreenHeader, AppScreenShell } from './shell'

test('the sidebar toggle precedes header leading controls and breadcrumbs', () => {
  const html = renderToStaticMarkup(
    <AppBreadcrumbContext.Provider value={{ leading: <span>Sidebar toggle</span>, items: [{ label: 'Personal' }, { label: 'Agents' }] }}>
      <AppScreenHeader leading={<span>Back control</span>} title="Agent editor" />
    </AppBreadcrumbContext.Provider>,
  )
  assert.match(html, /Sidebar toggle[\s\S]*Back control[\s\S]*Personal[\s\S]*Agents[\s\S]*Agent editor/)
})

test('header leading controls render without a breadcrumb trail', () => {
  const html = renderToStaticMarkup(<AppScreenHeader leading={<span>Back control</span>} />)
  assert.match(html, /Back control/)
})

test('agent thread headers keep the avatar beside the agent breadcrumb, not before the toggle', () => {
  for (const title of ['Weekly report', 'Researcher']) {
    const html = renderToStaticMarkup(
      <AppBreadcrumbContext.Provider value={{ leading: <span>Sidebar toggle</span>, items: [{ label: 'Personal' }, { label: 'Agents' }] }}>
        <AppScreenHeader breadcrumbs={[{ label: 'Researcher', leading: <span>Agent avatar</span> }]} title={title} />
      </AppBreadcrumbContext.Provider>,
    )
    assert.match(html, /Sidebar toggle[\s\S]*Personal[\s\S]*Agents[\s\S]*Agent avatar[\s\S]*Researcher/)
    assert.equal(html.match(/Agent avatar/g)?.length, 1)
    assert.equal(html.match(/Researcher/g)?.length, 1)
    assert.equal(html.match(/aria-current="page"/g)?.length, 1)
    if (title === 'Weekly report') assert.match(html, /Researcher[\s\S]*Weekly report/)
  }
})

test('header puts view tabs before actions and vertically centers title controls', () => {
  const markup = renderToStaticMarkup(
    <AppScreenHeader title="Work" metadata="3 open" search="Search tasks" tabs="List Board Timeline" actions="New task" />,
  )
  assert.ok(markup.indexOf('Search tasks') < markup.indexOf('List Board Timeline'))
  assert.ok(markup.indexOf('List Board Timeline') < markup.indexOf('New task'))
  assert.match(markup, /flex min-w-0 items-center/)
  assert.match(markup, /text-xs leading-5[^>]*>3 open/)
  assert.match(markup, /<h1[^>]*leading-5/)
})


test('right panels preserve their width without external width control', () => {
  const html = renderToStaticMarkup(<AppScreenShell rightPanel={<div>Details</div>} rightPanelOpen />)
  assert.match(html, /--app-screen-panel-width:384px/)
  assert.match(html, /aria-hidden="true"/)
  assert.match(html, /lg:relative/)
  assert.doesNotMatch(html, /lg:static/)
  const controlled = renderToStaticMarkup(<AppScreenShell rightPanel={<div>Details</div>} rightPanelWidth={480} onRightPanelResize={() => {}} />)
  assert.match(controlled, /--app-screen-panel-width:480px/)
})

test('screen shell exposes separate main and right-panel surfaces for both panel modes', () => {
  for (const mode of ['docked', 'floating'] as const) {
    const html = renderToStaticMarkup(
      <AppScreenShell rightPanel={<div>Sources</div>} rightPanelMode={mode}>
        <span>Conversation</span>
      </AppScreenShell>,
    )
    assert.match(html, /data-slot="app-screen-shell"/)
    assert.match(html, /data-slot="app-screen-layout"/)
    assert.match(html, /data-slot="app-screen-main"[\s\S]*Conversation[\s\S]*data-slot="app-screen-right-panel"/)
    assert.match(html, new RegExp(`data-slot="app-screen-right-panel" data-mode="${mode}"`))
    assert.match(html, /Sources/)
  }
})
