import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act } from 'react'
import { Button, Checkbox } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { OnboardingPayment } from './OnboardingPayment'

type Control = { props: {
  checked?: boolean
  disabled?: boolean
  children?: React.ReactNode
  onCheckedChange(value: boolean): void
  onClick(): Promise<void>
} }
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    root: { findByType(type: unknown): Control; findAllByType(type: unknown): Control[] }
    update(element: React.ReactElement): void
    unmount(): void
    toJSON(): unknown
  }
}

test('checkout consent survives task preparation, errors, retry and redirect', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const workspaces = overlayAppClient.workspaces
  const originalBilling = workspaces.billing
  const originalCheckout = workspaces.createBillingCheckout
  const destinations: string[] = []
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { search: '', assign: (href: string) => destinations.push(href) },
    addEventListener: () => {},
    removeEventListener: () => {},
  } })
  workspaces.billing = async () => ({ initialized: true, canManage: true }) as Awaited<ReturnType<typeof originalBilling>>
  let checkoutAttempts = 0
  workspaces.createBillingCheckout = async () => {
    if (++checkoutAttempts === 1) throw new Error('Checkout unavailable')
    return { url: 'https://checkout.stripe.com/test' } as Awaited<ReturnType<typeof originalCheckout>>
  }
  t.after(() => {
    workspaces.billing = originalBilling
    workspaces.createBillingCheckout = originalCheckout
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  let renderer!: ReturnType<typeof create>
  let title = 'First task'
  const render = () => <OnboardingPayment workspaceId="team-a" title={title} disabled={false}
    onPrepare={async () => {
      title = 'Saved first task'
      renderer.update(render())
    }} onStart={async () => {}} onEdit={() => {}} />
  await act(async () => { renderer = create(render()) })
  const checkbox = () => renderer.root.findByType(Checkbox)
  const subscribe = () => renderer.root.findAllByType(Button).find((button) =>
    React.Children.toArray(button.props.children).includes('Subscribe'))!
  try {
    assert.equal(checkbox().props.checked, false)
    assert.equal(subscribe().props.disabled, true)
    await act(() => checkbox().props.onCheckedChange(true))
    assert.equal(subscribe().props.disabled, false)
    await act(async () => { await subscribe().props.onClick() })
    assert.equal(checkbox().props.checked, true)
    assert.match(JSON.stringify(renderer.toJSON()), /Checkout unavailable/)
    assert.deepEqual(destinations, [])
    await act(async () => { await subscribe().props.onClick() })
    assert.equal(checkbox().props.checked, true)
    assert.deepEqual(destinations, ['https://checkout.stripe.com/test'])
  } finally {
    await act(() => renderer.unmount())
  }
})
