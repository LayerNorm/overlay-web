import assert from 'node:assert/strict'
import test from 'node:test'
import { navigateToOnboardingCheckout } from './checkout-navigation'

test('checkout suppresses unload warnings once, without disabling normal guards', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let suppress: ((event: { stopImmediatePropagation(): void }) => void) | null = null
  let stopped = false
  let failNavigation = false
  const destinations: string[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (name: string, listener: typeof suppress, options: unknown) => {
      assert.equal(name, 'beforeunload')
      assert.deepEqual(options, { capture: true, once: true })
      suppress = listener
    },
    removeEventListener: (name: string, listener: typeof suppress, capture: boolean) => {
      assert.equal(name, 'beforeunload')
      assert.equal(listener, suppress)
      assert.equal(capture, true)
      suppress = null
    },
    location: { assign: (url: string) => {
      if (failNavigation) throw new Error('Navigation failed')
      destinations.push(url)
      assert.ok(suppress)
      suppress({ stopImmediatePropagation: () => { stopped = true } })
      suppress = null
    } },
  } })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  navigateToOnboardingCheckout('https://checkout.stripe.com/test')
  assert.equal(stopped, true)
  assert.equal(suppress, null)
  assert.deepEqual(destinations, ['https://checkout.stripe.com/test'])
  failNavigation = true
  assert.throws(() => navigateToOnboardingCheckout('https://checkout.stripe.com/test'), /Navigation failed/)
  assert.equal(suppress, null)
})
