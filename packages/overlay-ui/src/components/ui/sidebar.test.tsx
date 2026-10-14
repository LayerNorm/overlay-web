import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Sidebar,
  SidebarMenu,
  SidebarMenuAction,
  SidebarGroupAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
} from './sidebar'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('the sidebar reports whether it is open, and the edge handle only exists with a provider', () => {
  const open = renderToStaticMarkup(<SidebarProvider open><Sidebar><SidebarRail /></Sidebar></SidebarProvider>)
  assert.match(open, /data-state="expanded"/)
  assert.match(open, /aria-label="Hide panel"/)
  const closed = renderToStaticMarkup(<SidebarProvider open={false}><Sidebar /></SidebarProvider>)
  assert.match(closed, /data-state="collapsed"/)
  // Without a provider the container still renders (the phone drawer has none); the handle does not.
  assert.match(renderToStaticMarkup(<Sidebar />), /data-state="expanded"/)
  assert.throws(() => renderToStaticMarkup(<SidebarRail />), /SidebarProvider/)
})

test('a menu row marks its active state and never submits a form', () => {
  const html = renderToStaticMarkup(
    <SidebarMenu>
      <SidebarMenuItem><SidebarMenuButton isActive>Agents</SidebarMenuButton></SidebarMenuItem>
      <SidebarMenuItem><SidebarMenuButton>Chats</SidebarMenuButton></SidebarMenuItem>
    </SidebarMenu>,
  )
  assert.match(html, /<ul[^>]*data-slot="sidebar-menu"/)
  assert.equal(html.match(/data-active="true"/g)?.length, 1)
  assert.equal(html.match(/type="button"/g)?.length, 2)
})

test('a menu row can render as a link without nesting a button in an anchor', () => {
  const html = renderToStaticMarkup(
    <SidebarMenuButton asChild isActive><a href="/app/work">Work</a></SidebarMenuButton>,
  )
  assert.match(html, /^<a href="\/app\/work"/)
  assert.doesNotMatch(html, /<button/)
  assert.match(html, /data-active="true"/)
})

test('row actions can appear on hover only, and the sub tree carries the guide line', () => {
  const hover = renderToStaticMarkup(<SidebarMenuAction showOnHover aria-label="More" />)
  assert.match(hover, /group-hover\/menu-item:opacity-100/)
  assert.doesNotMatch(renderToStaticMarkup(<SidebarMenuAction aria-label="More" />), /opacity-0/)
  const sub = renderToStaticMarkup(
    <SidebarMenuSub><SidebarMenuSubItem><SidebarMenuSubButton isActive>Thread</SidebarMenuSubButton></SidebarMenuSubItem></SidebarMenuSub>,
  )
  assert.match(sub, /border-l/)
  assert.match(sub, /data-active="true"/)
})

test('skeleton rows keep the row height and a deterministic width', () => {
  const a = renderToStaticMarkup(<SidebarMenuSkeleton index={1} />)
  const b = renderToStaticMarkup(<SidebarMenuSkeleton index={1} />)
  assert.equal(a, b)
  assert.match(a, /h-8/)
  assert.match(a, /role="status"/)
})


test('menu and group actions default to non-submit buttons and preserve asChild', () => {
  const html = renderToStaticMarkup(<form><SidebarMenuAction>Menu</SidebarMenuAction><SidebarGroupAction>Group</SidebarGroupAction></form>)
  assert.equal(html.match(/type="button"/g)?.length, 2)
  const link = renderToStaticMarkup(<SidebarMenuAction asChild><a href="/app/agents">Open</a></SidebarMenuAction>)
  assert.match(link, /^<a /)
  assert.doesNotMatch(link, /type="button"/)
})
