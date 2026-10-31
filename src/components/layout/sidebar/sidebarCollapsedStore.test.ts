import assert from 'node:assert/strict'
import test from 'node:test'
import { getSidebarCollapsedSnapshot, setStoredSidebarCollapsed, subscribeToSidebarCollapsed } from './sidebarCollapsedStore'

test('context panel collapse persists and notifies subscribers, including when storage is unavailable', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const events = new EventTarget()
  const values = new Map<string, string>()
  let denied = false
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => { if (denied) throw new Error('denied'); return values.get(key) ?? null },
      setItem: (key: string, value: string) => { if (denied) throw new Error('denied'); values.set(key, value) },
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  } })
  let changes = 0
  const unsubscribe = subscribeToSidebarCollapsed(() => { changes += 1 })
  try {
    setStoredSidebarCollapsed(true)
    assert.equal(getSidebarCollapsedSnapshot(), true)
    assert.equal(values.get('overlay:app-sidebar-collapsed'), 'true')
    setStoredSidebarCollapsed(false)
    assert.equal(getSidebarCollapsedSnapshot(), false)
    denied = true
    setStoredSidebarCollapsed(true)
    assert.equal(getSidebarCollapsedSnapshot(), true)
    setStoredSidebarCollapsed(false)
    assert.equal(getSidebarCollapsedSnapshot(), false)
    assert.equal(changes, 4)
  } finally {
    unsubscribe()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
