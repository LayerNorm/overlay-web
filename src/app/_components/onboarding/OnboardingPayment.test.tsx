import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test, { type TestContext } from 'node:test'
import React, { act } from 'react'
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react'
import { getFunctionName } from 'convex/server'
import { Button, Checkbox } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { OnboardingPayment } from './OnboardingPayment'
import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'

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
const fetchAccessToken = async () => 'fixture-token'
const useAuth = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken })

test('checkout consent survives task preparation, errors, retry and redirect', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const workspaces = overlayAppClient.workspaces
  const originalCheckout = workspaces.createBillingCheckout
  const destinations: string[] = []
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { search: '', assign: (href: string) => destinations.push(href) },
    addEventListener: () => {},
    removeEventListener: () => {},
  } })
  const client = new ConvexReactClient('https://fixture.convex.cloud')
  t.mock.method(client, 'setAuth', (_fetch, onChange) => onChange(true))
  t.mock.method(client, 'clearAuth', () => {})
  t.mock.method(client, 'watchQuery', (query, args) => {
    assert.equal(getFunctionName(query), 'billing/browse:workspaceSummary')
    assert.deepEqual(args, { workspaceId: 'team-a' })
    return {
      localQueryResult: () => ({ initialized: true, canManage: true }),
      localQueryLogs: () => undefined,
      journal: () => undefined,
      onUpdate: () => () => {},
    } as ReturnType<ConvexReactClient['watchQuery']>
  })
  let checkoutAttempts = 0
  workspaces.createBillingCheckout = async () => {
    if (++checkoutAttempts === 1) throw new Error('Checkout unavailable')
    return { url: 'https://checkout.stripe.com/test' } as Awaited<ReturnType<typeof originalCheckout>>
  }
  t.after(async () => {
    await client.close()
    workspaces.createBillingCheckout = originalCheckout
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  let renderer!: ReturnType<typeof create>
  let title = 'First task'
  const render = () => <ConvexProviderWithAuth client={client} useAuth={useAuth}><OnboardingPayment workspaceId="team-a" title={title} disabled={false}
    onPrepare={async () => {
      title = 'Saved first task'
      renderer.update(render())
    }} onStart={async () => {}} onEdit={() => {}} /></ConvexProviderWithAuth>
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

function billing(state: NonNullable<WorkspaceBillingSummaryResponse['executionAccess']>['state'], canManage = false): WorkspaceBillingSummaryResponse {
  return {
    workspaceId: 'team-a', canManage, canTopUp: false, initialized: true, pricingVersion: 'markup_25_v1',
    executionAccess: { state, canExecute: state === 'ready' },
    subscription: { planKind: state === 'ready' ? 'paid' : 'free', planAmountCents: state === 'ready' ? 800 : 0 },
    credits: { total: 800, used: 0, remaining: 800, allowancePercentUsed: 0, topUpBalance: 0 },
  }
}

async function paymentFixture(t: TestContext, summary: WorkspaceBillingSummaryResponse | null | undefined, billingContactName: string | null = 'Priya') {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '' } } })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  let prepared = 0, started = 0, opened = 0
  const render = (summary: WorkspaceBillingSummaryResponse | null | undefined) => <OnboardingPayment workspaceId="team-a" workspaceName="Acme" personal={false} billingContactName={billingContactName} summary={summary} title="Review the launch plan" disabled={false}
    onPrepare={async () => { prepared++ }} onStart={async () => { started++ }} onEdit={() => {}} onOpenWork={async () => { opened++ }} />
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(render(summary)) })
  t.after(async () => {
    await act(() => renderer.unmount())
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  return {
    text: () => JSON.stringify(renderer.toJSON()),
    button: (label: string) => renderer.root.findAllByType(Button).find(button => React.Children.toArray(button.props.children).includes(label)),
    async click(label: string) { await act(async () => { renderer.root.findAllByType(Button).find(button => React.Children.toArray(button.props.children).includes(label))!.props.onClick() }) },
    async update(value: WorkspaceBillingSummaryResponse | null | undefined) { await act(async () => { renderer.update(render(value)) }) },
    get prepared() { return prepared }, get started() { return started }, get opened() { return opened },
  }
}

test('billing loading and missing access never show the offer or Subscribe', async t => {
  const f = await paymentFixture(t, undefined)
  assert.match(f.text(), /Loading workspace billing/)
  assert.doesNotMatch(f.text(), /\$8|Subscribe/)
  await f.update(null)
  assert.match(f.text(), /unavailable/)
  assert.doesNotMatch(f.text(), /\$8|Subscribe/)
})

test('paid ready task shows workspace budget, scope and Start, without an offer', async t => {
  const f = await paymentFixture(t, billing('ready'))
  assert.match(f.text(), /Saved. Acme's budget covers this/)
  assert.match(f.text(), /Usage is charged to Acme's workspace budget/)
  assert.doesNotMatch(f.text(), /Personal|\$8|Subscribe/)
  assert.ok(f.button('Edit task'))
  await f.click('Start task')
  assert.equal(f.started, 1)
})

test('free member requests billing once, retains the draft, and transitions live to ready', async t => {
  const f = await paymentFixture(t, billing('subscription_required'))
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    calls.push(String(input))
    return Response.json({ requested: true }, { status: 202 })
  })
  assert.match(f.text(), /only owners and admins can set that up/)
  assert.doesNotMatch(f.text(), /\$8/)
  await f.click('Ask Priya to subscribe')
  assert.deepEqual(calls, ['/api/v1/workspaces/team-a/billing/request'])
  assert.equal(f.prepared, 1)
  assert.equal(f.button('Request sent')?.props.disabled, true)
  assert.match(f.text(), /Priya has been asked/)
  await f.update(billing('ready'))
  assert.equal(f.button('Request sent'), undefined)
  assert.ok(f.button('Start task'))
  assert.match(f.text(), /Acme is now subscribed/)
  assert.equal(f.started, 0)
})

test('request failure keeps the request retryable and Open Work never starts the draft', async t => {
  const f = await paymentFixture(t, billing('subscription_required'), null)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Request unavailable' }, { status: 500 }))
  await f.click('Ask an admin to subscribe')
  assert.match(f.text(), /Request unavailable/)
  assert.equal(f.button('Ask an admin to subscribe')?.props.disabled, false)
  await f.click('Open Work')
  assert.equal(f.opened, 1)
  assert.equal(f.started, 0)
})

test('free admin keeps the offer and consent-gated Subscribe, without member request controls', async t => {
  const f = await paymentFixture(t, billing('subscription_required', true))
  assert.match(f.text(), /\$8/)
  assert.equal(f.button('Subscribe')?.props.disabled, true)
  assert.equal(f.button('Ask Priya to subscribe'), undefined)
  assert.equal(f.button('Open Work'), undefined)
})

test('non-managers with exhausted or suspended billing see contact guidance, not a subscription request', async t => {
  const f = await paymentFixture(t, billing('budget_exhausted'))
  for (const state of ['budget_exhausted', 'billing_suspended'] as const) {
    await f.update(billing(state))
    assert.match(f.text(), /Ask a workspace owner or admin/)
    assert.equal(f.button('Ask Priya to subscribe'), undefined)
    assert.equal(f.button('Subscribe'), undefined)
  }
})
