import assert from 'node:assert/strict'
import test from 'node:test'
import React, { useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useConversationBottomVisibility } from './useConversationScroll'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

test('binds after a deferred viewport mounts, rebinds on replacement, and cleans up listeners', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const frames = new Map<number, FrameRequestCallback>()
  const windowListeners = new Map<string, Set<() => void>>()
  const viewports = new Map<string, { scrollListeners: Set<() => void> }>()
  let nextFrameId = 0
  let markerTop = 600

  const listenersFor = (type: string) => {
    let listeners = windowListeners.get(type)
    if (!listeners) {
      listeners = new Set()
      windowListeners.set(type, listeners)
    }
    return listeners
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = ++nextFrameId
        frames.set(id, callback)
        return id
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      addEventListener: (type: string, listener: () => void) => listenersFor(type).add(listener),
      removeEventListener: (type: string, listener: () => void) => listenersFor(type).delete(listener),
    },
  })

  function Harness({ viewportId }: { viewportId: string | null }) {
    const messagesScrollRef = useRef<HTMLDivElement | null>(null)
    const messagesEndRef = useRef<HTMLDivElement | null>(null)
    const { isConversationBottomVisible, messagesScrollRefCallback } = useConversationBottomVisibility({
      messagesScrollRef,
      messagesEndRef,
      activeChatId: 'chat',
      actChat: { messages: [] } as never,
      chat0: { messages: [] } as never,
      isActiveLoading: false,
      isOptimisticLoading: false,
      runtimeHydrationVersion: 0,
      isTemporaryChat: false,
      showAutomationChatTab: true,
    })
    return (
      <>
        <div data-scroll-visibility data-visible={isConversationBottomVisible} />
        <div data-end-marker ref={messagesEndRef} />
        {viewportId ? (
          <div key={viewportId} data-scroll-viewport={viewportId} ref={messagesScrollRefCallback} />
        ) : null}
      </>
    )
  }

  let renderer!: ReactTestRenderer
  const visibility = () => renderer.root.findByProps({ 'data-scroll-visibility': true }).props['data-visible']
  const flushFrames = async () => {
    await act(async () => {
      while (frames.size > 0) {
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach((callback) => callback(0))
      }
    })
  }
  const scroll = async (viewportId: string) => {
    await act(async () => {
      for (const listener of [...viewports.get(viewportId)!.scrollListeners]) listener()
    })
    await flushFrames()
  }

  try {
    await act(async () => {
      renderer = create(<Harness viewportId={null} />, {
        createNodeMock: (element) => {
          const viewportId = element.props['data-scroll-viewport']
          if (typeof viewportId === 'string') {
            const viewport = { scrollListeners: new Set<() => void>() }
            viewports.set(viewportId, viewport)
            return {
              addEventListener: (type: string, listener: () => void) => {
                if (type === 'scroll') viewport.scrollListeners.add(listener)
              },
              removeEventListener: (type: string, listener: () => void) => {
                if (type === 'scroll') viewport.scrollListeners.delete(listener)
              },
              getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
            }
          }
          if (element.props['data-end-marker']) {
            return { getBoundingClientRect: () => ({ top: markerTop, bottom: markerTop + 1 }) }
          }
          return {}
        },
      })
    })
    await flushFrames()
    assert.equal(viewports.size, 0, 'the initial deferred placeholder has no viewport')

    await act(async () => { renderer.update(<Harness viewportId="first" />) })
    await flushFrames()
    assert.equal(viewports.get('first')!.scrollListeners.size, 1, 'the late viewport gets a scroll listener')
    assert.equal(windowListeners.get('resize')?.size, 1)

    markerTop = 800
    await scroll('first')
    assert.equal(visibility(), false, 'scrolling up reveals that the transcript is no longer at the bottom')
    markerTop = 600
    await scroll('first')
    assert.equal(visibility(), true, 'scrolling back to the bottom hides the control')

    await act(async () => { renderer.update(<Harness viewportId="second" />) })
    await flushFrames()
    assert.equal(viewports.get('first')!.scrollListeners.size, 0, 'the replaced viewport is detached')
    assert.equal(viewports.get('second')!.scrollListeners.size, 1, 'the replacement viewport is bound')
    assert.equal(windowListeners.get('resize')?.size, 1, 'resize listeners are not duplicated')

    markerTop = 800
    await scroll('second')
    assert.equal(visibility(), false, 'the replacement viewport continues updating visibility')

    await act(async () => { renderer.unmount() })
    assert.equal(viewports.get('second')!.scrollListeners.size, 0)
    assert.equal(windowListeners.get('resize')?.size, 0)
    assert.equal(frames.size, 0)
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
