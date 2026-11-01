import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import React, { act, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HarnessResourceGrant, HarnessResourceGrantReceipt, HarnessResourceRequest } from '@overlay/agent-runtime/harness-resource'
import { parseResourceLimit, RunResourceRequest } from './RunResourceRequest'

type Instance = { props: Record<string, unknown>; children: Array<Instance | string> }
type Renderer = { root: { findAllByType(type: string): Instance[] }; update(element: ReactElement): void; unmount(): void }
const { create } = createRequire(import.meta.url)('react-test-renderer') as { create(element: ReactElement): Renderer }
const request: HarnessResourceRequest = {
  token: 'request', runId: 'run', rootRunId: 'run', workflowRunId: 'workflow', policyRevision: 0,
  reason: 'model_spend', currentMaxCostMicros: 1_000_000, usedCostMicros: 940_000,
  reservedCostMicros: 60_000, requiredCostMicros: 50_000, deadlineAt: 1_000_000, requestedAt: 100,
}

function receipt(grant: HarnessResourceGrant): HarnessResourceGrantReceipt {
  return { token: request.token, runId: request.runId, rootRunId: request.rootRunId, workflowRunId: request.workflowRunId,
    grant, policyRevisionBefore: 0, policyRevisionAfter: 1, grantedAt: 200,
    maxCostMicros: grant.kind === 'model_spend' ? grant.newMaxCostMicros : request.currentMaxCostMicros,
    deadlineAt: grant.kind === 'time' ? 200 + grant.durationMs : request.deadlineAt }
}

function text(node: Instance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('')
}

function button(renderer: Renderer, label: string): Instance {
  const found = renderer.root.findAllByType('button').find(node => text(node) === label)
  assert.ok(found, `Missing button: ${label}`)
  return found
}

async function mount(t: TestContext, element: ReactElement) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  let renderer!: Renderer
  await act(async () => { renderer = create(element) })
  t.after(async () => {
    await act(async () => renderer.unmount())
    if (previous) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  return renderer
}

const click = async (node: Instance) => act(async () => { (node.props.onClick as () => void)() })

test('currency input uses exact integer cents and rejects ambiguous or excessive amounts', () => {
  for (const [input, micros] of [['1.01', 1_010_000], ['2', 2_000_000], ['0.29', 290_000], ['100.00', 100_000_000]] as const) {
    assert.equal(parseResourceLimit(input), micros)
  }
  for (const invalid of ['1e2', '1.001', '-1', ' 2', 'Infinity', '', '100.01', '1000', '.5']) assert.equal(parseResourceLimit(invalid), null)
})

test('the approved card displays actual limits and shadcn time selection, not a tool approval', () => {
  const spend = renderToStaticMarkup(<RunResourceRequest request={request} canAuthorize onGrant={async grant => receipt(grant)} />)
  assert.match(spend, /\$0\.94 used/)
  assert.match(spend, /\$0\.06 reserved/)
  assert.match(spend, /New total model limit \(USD\)/)
  assert.doesNotMatch(spend, />Deny</)
  const time = renderToStaticMarkup(<RunResourceRequest request={{ ...request, reason: 'time' }} canAuthorize onGrant={async grant => receipt(grant)} />)
  assert.match(time, /role="combobox"/)
  assert.match(time, /\$1\.00 model spending limit/)
  const readonly = renderToStaticMarkup(<RunResourceRequest request={request} canAuthorize={false} onGrant={async grant => receipt(grant)} />)
  assert.match(readonly, /Waiting for the authorized owner/)
  assert.doesNotMatch(readonly, /Raise limit/)
})

test('Keep paused never submits a grant and review preserves the proposed total', async t => {
  let grants = 0
  const renderer = await mount(t, <RunResourceRequest request={request} canAuthorize onGrant={async grant => { grants++; return receipt(grant) }} />)
  await act(async () => { (renderer.root.findAllByType('input')[0].props.onChange as (event: unknown) => void)({ target: { value: '3.25' } }) })
  await click(button(renderer, 'Keep paused'))
  assert.equal(grants, 0)
  await click(button(renderer, 'Review limits'))
  assert.equal(renderer.root.findAllByType('input')[0].props.value, '3.25')
})

test('invalid totals cannot submit, and double clicks send one exact cumulative grant', async t => {
  const grants: HarnessResourceGrant[] = []
  let resolve!: (receipt: HarnessResourceGrantReceipt) => void
  const result = new Promise<HarnessResourceGrantReceipt>(yes => { resolve = yes })
  const renderer = await mount(t, <RunResourceRequest request={request} canAuthorize onGrant={async grant => { grants.push(grant); return result }} />)
  const change = async (value: string) => act(async () => { (renderer.root.findAllByType('input')[0].props.onChange as (event: unknown) => void)({ target: { value } }) })
  await change('1.02')
  assert.equal(button(renderer, 'Raise limit & resume').props.disabled, true)
  await click(button(renderer, 'Raise limit & resume'))
  assert.equal(grants.length, 0)
  await change('2.29')
  const submit = button(renderer, 'Raise limit & resume').props.onClick as () => void
  await act(async () => { submit(); submit() })
  assert.deepEqual(grants, [{ kind: 'model_spend', newMaxCostMicros: 2_290_000 }])
  await act(async () => { resolve(receipt(grants[0])) })
  assert.equal(renderer.root.findAllByType('button').length, 0)
  assert.match(renderer.root.findAllByType('div').map(text).join(' '), /Waiting for the same task to resume/)
})

test('failed approval remains reviewable and a changed request resets dismissed state', async t => {
  const onGrant = async () => { throw new Error('You no longer have permission. No limits changed.') }
  const renderer = await mount(t, <RunResourceRequest request={request} canAuthorize onGrant={onGrant} />)
  await click(button(renderer, 'Raise limit & resume'))
  assert.equal(renderer.root.findAllByType('p').find(node => node.props.role === 'alert')?.children.join(''), 'You no longer have permission. No limits changed.')
  assert.equal(button(renderer, 'Raise limit & resume').props.disabled, false)
  await click(button(renderer, 'Keep paused'))
  await act(async () => renderer.update(<RunResourceRequest request={{ ...request, token: 'new-request', policyRevision: 1 }} canAuthorize onGrant={onGrant} />))
  assert.ok(button(renderer, 'Raise limit & resume'))
})

test('an accepted grant awaiting reconciliation does not claim that execution resumed', () => {
  const markup = renderToStaticMarkup(<RunResourceRequest request={request} canAuthorize awaitingReceipt
    receipt={receipt({ kind: 'model_spend', newMaxCostMicros: 2_000_000 })} onGrant={async grant => receipt(grant)} />)
  assert.match(markup, /The task remains paused/)
  assert.doesNotMatch(markup, /Raise limit|Resuming the same task/)
})
