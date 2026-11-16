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
    onPointerEnter(event: { pointerType: string }): void
    onPointerLeave(event: { pointerType: string }): void
    onClick?: unknown
    className?: string
    size?: string
  }
  findByType(type: string): TestNode
}
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { root: TestNode; unmount(): void }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('touch and pen leave opening to the trigger and do not schedule hover dismissal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(<HelpMenu collapsed docsUrl="https://example.com/docs" />) })
  const root = renderer.root
  const isOpen = () => root.findByType('test-popover').props.open
  try {
    expect(root.findByType('test-menu-button').props.onClick).toBeUndefined()
    expect(root.findByType('test-menu-button').props.className).toBe('justify-center px-0')
    expect(root.findByType('test-menu-button').props.size).toBe('lg')
    for (const pointerType of ['touch', 'pen']) {
      await act(() => root.findByType('test-item').props.onPointerEnter({ pointerType }))
      expect(isOpen()).toBe(false)
      await act(() => root.findByType('test-popover').props.onOpenChange(true))
      await act(() => root.findByType('test-item').props.onPointerLeave({ pointerType }))
      await act(() => root.findByType('test-popover-content').props.onPointerLeave({ pointerType }))
      await act(() => vi.advanceTimersByTime(500))
      expect(isOpen()).toBe(true)
      await act(() => root.findByType('test-popover').props.onOpenChange(false))
    }
  } finally {
    await act(() => renderer.unmount())
  }
})

test('mouse can cross into the menu and an explicit open cancels pending hover dismissal', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(<HelpMenu collapsed docsUrl="https://example.com/docs" />) })
  const root = renderer.root
  const isOpen = () => root.findByType('test-popover').props.open
  const mouse = { pointerType: 'mouse' }
  try {
    await act(() => root.findByType('test-item').props.onPointerEnter(mouse))
    expect(isOpen()).toBe(true)
    await act(() => root.findByType('test-item').props.onPointerLeave(mouse))
    await act(() => root.findByType('test-popover-content').props.onPointerEnter(mouse))
    await act(() => vi.advanceTimersByTime(500))
    expect(isOpen()).toBe(true)
    await act(() => root.findByType('test-popover-content').props.onPointerLeave(mouse))
    await act(() => vi.advanceTimersByTime(200))
    expect(isOpen()).toBe(false)
    await act(() => root.findByType('test-item').props.onPointerEnter(mouse))
    await act(() => root.findByType('test-item').props.onPointerLeave(mouse))
    await act(() => root.findByType('test-popover').props.onOpenChange(true))
    await act(() => vi.advanceTimersByTime(500))
    expect(isOpen()).toBe(true)
  } finally {
    await act(() => renderer.unmount())
  }
})
