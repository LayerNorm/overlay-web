import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Popover, PopoverContent } from '@overlay/ui/primitives'
import { InfoTip } from './InfoTip'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

const TEXT = 'Explains the field.'

async function renderTip(run: (renderer: ReactTestRenderer) => Promise<void>) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: { addEventListener() {}, removeEventListener() {} }, configurable: true })
  let renderer: ReactTestRenderer | undefined
  try {
    await act(async () => { renderer = create(<InfoTip text={TEXT} label="Permissions" />) })
    await run(renderer!)
  } finally {
    await act(async () => { renderer?.unmount() })
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

const trigger = (renderer: ReactTestRenderer) => renderer.root.findByProps({ 'aria-label': 'More info about Permissions' }).findByType('button')
const isOpen = (renderer: ReactTestRenderer) => renderer.root.findByType(Popover).props.open as boolean
const click = (renderer: ReactTestRenderer) => act(async () => {
  trigger(renderer).props.onClick({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true } })
})

test('the info tip is a non-submitting button named after its field', async () => {
  await renderTip(async (renderer) => {
    const button = trigger(renderer)
    assert.equal(button.props.type, 'button')
    assert.equal(button.props['aria-expanded'], false)
    assert.equal(isOpen(renderer), false)
  })
})

test('clicking the button shows the text and clicking again hides it', async () => {
  await renderTip(async (renderer) => {
    await click(renderer)
    assert.equal(isOpen(renderer), true)
    assert.equal(trigger(renderer).props['aria-expanded'], true)
    assert.equal(renderer.root.findByType(PopoverContent).props.children, TEXT)
    await click(renderer)
    assert.equal(isOpen(renderer), false)
  })
})

test('a dismiss from the popover (Escape or outside click) hides the text', async () => {
  await renderTip(async (renderer) => {
    await click(renderer)
    await act(async () => { renderer.root.findByType(Popover).props.onOpenChange(false) })
    assert.equal(isOpen(renderer), false)
  })
})
