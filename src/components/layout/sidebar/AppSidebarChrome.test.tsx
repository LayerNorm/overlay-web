import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { Circle } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobileNavStep, SidebarBrandLink, SidebarRailBrand } from './AppSidebarChrome'

test('mobile navigation exposes the actual rows as tour targets', () => {
  const ids = ['work', 'agents', 'chat', 'automations', 'files', 'extensions']
  const html = renderToStaticMarkup(<MobileNavStep
    brandLink={<span>Overlay</span>}
    onClose={() => {}}
    navItems={ids.map((id) => ({
      id, label: id, icon: Circle, active: false, pending: false,
      unreadCount: 0, opensPanel: false, onSelect() {},
    }))}


    footer={null}
  />)
  for (const id of ids) assert.match(html, new RegExp(`data-tour="nav-${id}"`))
})

test('default sidebar branding uses the accessible O wordmark', () => {
  const html = renderToStaticMarkup(<SidebarBrandLink
    href="/app"
    logoSrc="/assets/overlay-logo.png"
    logoAlt="Overlay"
    label="Overlay"
    onNavigate={() => {}}
    className=""
    labelClassName="text-lg"
  />)

  assert.match(html, /aria-label="Overlay"/)
  assert.match(html, /brand-lockup-word">verlay</)
  assert.doesNotMatch(html, /<img/)
})

test('custom white-label images and names survive in both sidebar layouts', () => {
  const brand = {
    logoSrc: '/customer-logo.png',
    logoAlt: 'Acme logo',
    label: 'Acme',
  }
  const link = renderToStaticMarkup(<SidebarBrandLink
    {...brand}
    href="/app"
    onNavigate={() => {}}
    className=""
    labelClassName="text-lg"
  />)
  const rail = renderToStaticMarkup(<SidebarRailBrand
    {...brand}
    collapsed={false}
    homeHref="/app"
    onExpand={() => {}}
    onCollapse={() => {}}
  />)

  for (const html of [link, rail]) {
    assert.match(html, /<img/)
    assert.match(html, /customer-logo/)
    assert.match(html, /alt="Acme logo"/)
    assert.match(html, />Acme</)
    assert.doesNotMatch(html, /brand-lockup-word/)
  }
})

test('default image with a custom brand name keeps that name', () => {
  const html = renderToStaticMarkup(<SidebarBrandLink
    href="/app"
    logoSrc="/assets/overlay-logo.png"
    label="Acme"
    onNavigate={() => {}}
    className=""
    labelClassName="text-lg"
  />)

  assert.match(html, />Acme</)
  assert.match(html, /<svg/)
  assert.doesNotMatch(html, /brand-lockup-word/)
})
