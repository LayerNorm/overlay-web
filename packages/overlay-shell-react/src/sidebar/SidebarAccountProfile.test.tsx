import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShellAdapterProvider, type ShellAdapter, type ShellLinkProps } from '../adapter'
import { SidebarAccountAvatar, SidebarAccountProfile } from './SidebarAccountProfile'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('account profile links to the account page and shows the user name and email', () => {
  const adapter: ShellAdapter = {
    rememberScope: () => undefined,
    Link: function TestLink({ href, children, ...props }: ShellLinkProps) {
      return <a href={href} {...props}>{children}</a>
    },
  }
  const html = renderToStaticMarkup(
    <ShellAdapterProvider value={adapter}>
      <SidebarAccountProfile name="Jordan Doe" email="jordan@example.com" onAccountClick={() => undefined} />
    </ShellAdapterProvider>,
  )

  assert.match(html, /href="\/account"/)
  assert.match(html, /Jordan Doe/)
  assert.match(html, /jordan@example\.com/)
  assert.match(html, /aria-label="Account"/)
})

test('account avatar displays the first-letter fallback when no photo is supplied', () => {
  const html = renderToStaticMarkup(<SidebarAccountAvatar name="Jordan Doe" />)

  assert.match(html, />J</)
})
