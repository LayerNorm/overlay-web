import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@overlay/ui/primitives', () => ({
  Button: 'button', Input: 'input', Label: 'label', Textarea: 'textarea',
  Dialog: 'test-dialog', DialogContent: 'div', DialogDescription: 'p',
  DialogFooter: 'footer', DialogHeader: 'header', DialogTitle: 'h2',
  Popover: 'test-popover', PopoverContent: 'test-popover-content', PopoverTrigger: 'test-trigger',
  SidebarMenuItem: 'test-item', SidebarMenuButton: 'test-menu-button',
}))

import { HelpMenu } from './HelpMenu'

type TestNode = {
  props: {
    open: boolean
    onOpenChange(open: boolean): void
    onPointerEnter?: unknown
    className?: string
    size?: string
  }
  findByType(type: string): TestNode
}
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { root: TestNode; unmount(): void }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('help opens only when its trigger is clicked, never on hover', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(<HelpMenu collapsed docsUrl="https://example.com/docs" />) })
  const root = renderer.root
  const isOpen = () => root.findByType('test-popover').props.open
  try {
    expect(root.findByType('test-menu-button').props.className).toBe('justify-center px-0')
    expect(root.findByType('test-menu-button').props.size).toBe('lg')
    expect(root.findByType('test-item').props.onPointerEnter).toBeUndefined()
    expect(root.findByType('test-popover-content').props.onPointerEnter).toBeUndefined()
    expect(isOpen()).toBe(false)
    await act(() => root.findByType('test-popover').props.onOpenChange(true))
    expect(isOpen()).toBe(true)
    await act(() => root.findByType('test-popover').props.onOpenChange(false))
    expect(isOpen()).toBe(false)
  } finally {
    await act(() => renderer.unmount())
  }
})
