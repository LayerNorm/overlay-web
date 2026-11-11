import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import React, { act, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GeneratedJsonRenderData } from '@overlay/chat-core/generated-ui'
import { JsonRenderBoundary, JsonRenderCard, formatJsonRenderSubmission, seedMissingGeneratedUiState } from './JsonRenderCard'
import { QuestionnaireComposerProvider } from './Questionnaire'
import { jsonRenderRegistry, protectJsonRenderComponent } from './json-render-registry'

type TestNode = { type: unknown; props: Record<string, unknown>; findAll(predicate: (node: TestNode) => boolean): TestNode[] }
type TestRenderer = { root: TestNode; update(element: ReactElement): void; unmount(): void; toJSON(): unknown }
const { create } = createRequire(import.meta.url)('react-test-renderer') as { create(element: ReactElement): TestRenderer }

test('form follow-ups are readable label and value lines, including empty and nested values', () => {
  assert.equal(formatJsonRenderSubmission({ title: 'Bug', includeLogs: true, severity: null, details: { steps: 'Open app' } }, 'Report'),
    'Report\nTitle: Bug\nInclude Logs: Yes\nSeverity: (empty)\nDetails / Steps: Open app')
  assert.equal(formatJsonRenderSubmission({}), 'Form submitted')
})

test('final spec state seeds missing form values without overwriting local values', () => {
  const values = new Map([['/form/title', 'Edited']])
  seedMissingGeneratedUiState({ form: { title: 'Default', notify: true }, 'a/b': 4 }, path => values.get(path), (path, value) => values.set(path, value))
  assert.deepEqual(Object.fromEntries(values), { '/form/title': 'Edited', '/form/notify': true, '/a~1b': 4 })
})

test('final streamed spec state seeds controls without remounting the card', async t => {
  t.mock.method(console, 'error', () => {})
  const partial = data(single('Input', { label: 'Title', value: { $bindState: '/title' } }), { streaming: true })
  const complete = data({ root: 'root', elements: { root: { type: 'Input', props: { label: 'Title', value: { $bindState: '/title' } } } }, state: { title: 'Seeded' } })
  let renderer!: TestRenderer
  await act(async () => { renderer = create(<JsonRenderCard partId="seed" data={partial} />) })
  assert.equal(renderer.root.findAll(node => node.type === 'input')[0]?.props.readOnly, true)
  await act(async () => { renderer.update(<JsonRenderCard partId="seed" data={complete} />) })
  const after = renderer.root.findAll(node => node.type === 'input')[0]
  assert.equal(after.props.value, 'Seeded')
  assert.equal(after.props.readOnly, false)
  await act(async () => renderer.unmount())
})

test('card boundary identity survives repeated streaming updates and final data', async t => {
  t.mock.method(console, 'error', () => {})
  let renderer!: TestRenderer
  const view = (text: string, streaming: boolean) => data(single('Text', { text }), { streaming })
  try {
    await act(async () => { renderer = create(<JsonRenderCard partId="stable" data={view('First', true)} />) })
    const boundary = () => renderer.root.findAll(node => node.type === JsonRenderBoundary)[0] as TestNode & { instance: unknown }
    const initial = boundary().instance
    await act(async () => renderer.update(<JsonRenderCard partId="stable" data={view('Second', true)} />))
    assert.equal(boundary().instance, initial)
    await act(async () => renderer.update(<JsonRenderCard partId="stable" data={view('Final', false)} />))
    assert.equal(boundary().instance, initial)
  } finally {
    await act(async () => renderer?.unmount())
  }
})

test('bound state saves after 700ms and flushes the last snapshot on unmount', async t => {
  t.mock.method(console, 'error', () => {})
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const saved: GeneratedJsonRenderData[] = []
  let renderer!: TestRenderer
  const spec = single('Input', { label: 'Title', value: { $bindState: '/title' } })
  await act(async () => { renderer = create(<JsonRenderCard partId="edit" data={data(spec)} onDataChange={(_id, next) => { saved.push(next) }} />) })
  const change = async (value: string) => act(async () => {
    const input = renderer.root.findAll(node => node.type === 'input')[0]
    ;(input.props.onChange as (event: unknown) => void)({ target: { value } })
  })
  await change('First')
  await act(async () => { t.mock.timers.tick(699) })
  assert.equal(saved.length, 0)
  await act(async () => { t.mock.timers.tick(1) })
  assert.equal(saved[0].stateJson, '{"title":"First"}')
  await change('Final')
  await act(async () => renderer.unmount())
  assert.equal(saved.length, 2)
  assert.equal(saved[1].stateJson, '{"title":"Final"}')
})

test('submit claims persisted final state once, sends readable values and remains locked after reload', async t => {
  t.mock.method(console, 'error', () => {})
  const saved: GeneratedJsonRenderData[] = []
  const sent: string[] = []
  const spec = single('Button', { label: 'Submit' }, { press: { action: 'submit', params: { label: 'Bug report' } } })
  const value = data(spec, { stateJson: '{"title":"Broken sidebar","logs":true}' })
  let renderer!: TestRenderer
  await act(async () => { renderer = create(<JsonRenderCard partId="submit" data={value} onDataChange={(_id, next) => { saved.push(next) }} actions={{ onSendMessage: text => { sent.push(text) } }} />) })
  const click = () => (renderer.root.findAll(node => node.type === 'button')[0].props.onClick as () => void)()
  await act(async () => { click(); click() })
  assert.equal(saved.length, 1)
  assert.ok(saved[0].submittedAt)
  assert.deepEqual(sent, ['Bug report\nTitle: Broken sidebar\nLogs: Yes'])
  assert.equal(renderer.root.findAll(node => node.type === 'button')[0].props.disabled, true)
  await act(async () => renderer.unmount())
  const html = renderToStaticMarkup(<JsonRenderCard partId="submit" data={saved[0]} />)
  assert.ok(html.includes('disabled=""'))
})

test('failed persistence blocks submission and read-only cards never save or send', async t => {
  t.mock.method(console, 'error', () => {})
  let sends = 0
  let saves = 0
  const spec = single('Button', { label: 'Submit' }, { press: { action: 'submit' } })
  let renderer!: TestRenderer
  const props = { partId: 'failed', data: data(spec), onDataChange: async () => { saves++; throw new Error('denied') }, actions: { onSendMessage: () => { sends++ } } }
  await act(async () => { renderer = create(<JsonRenderCard {...props} />) })
  await act(async () => { (renderer.root.findAll(node => node.type === 'button')[0].props.onClick as () => void)() })
  assert.equal(saves, 1)
  assert.equal(sends, 0)
  assert.equal(renderer.root.findAll(node => node.type === 'button')[0].props.disabled, false)
  assert.equal(renderer.root.findAll(node => node.props.role === 'alert').length, 1)
  await act(async () => renderer.update(<JsonRenderCard {...props} readOnly />))
  await act(async () => { (renderer.root.findAll(node => node.type === 'button')[0].props.onClick as () => void)() })
  assert.equal(saves, 1)
  await act(async () => renderer.unmount())
})

test('personal send_message uses the existing composer context without submitting the card', async t => {
  t.mock.method(console, 'error', () => {})
  const sent: string[] = []
  const saved: unknown[] = []
  const spec = single('Button', { label: 'Continue' }, { press: { action: 'send_message', params: { text: 'Compare seats' } } })
  let renderer!: TestRenderer
  await act(async () => { renderer = create(<QuestionnaireComposerProvider value="Unsent draft" onChange={() => {}} onSendMessage={async text => { sent.push(text) }}>
    <JsonRenderCard partId="send" data={data(spec)} onDataChange={(_id, next) => { saved.push(next) }} />
  </QuestionnaireComposerProvider>) })
  await act(async () => { (renderer.root.findAll(node => node.type === 'button')[0].props.onClick as () => void)() })
  assert.deepEqual(sent, ['Compare seats'])
  assert.deepEqual(saved, [])
  await act(async () => renderer.unmount())
})

test('a send failure after successful submission stays locked and never automatically resends', async t => {
  t.mock.method(console, 'error', () => {})
  let sends = 0
  const spec = single('Button', { label: 'Submit' }, { press: { action: 'submit' } })
  let renderer!: TestRenderer
  await act(async () => { renderer = create(<JsonRenderCard partId="send-failed" data={data(spec)} onDataChange={() => {}} actions={{ onSendMessage: async () => { sends++; throw new Error('offline') } }} />) })
  const click = () => (renderer.root.findAll(node => node.type === 'button')[0].props.onClick as () => void)()
  await act(async () => { click() })
  await act(async () => { click() })
  assert.equal(sends, 1)
  assert.equal(renderer.root.findAll(node => node.type === 'button')[0].props.disabled, true)
  assert.ok(JSON.stringify(renderer.toJSON()).includes('values were saved'))
  await act(async () => renderer.unmount())
})
const source = readFileSync(new URL('../../../../internal/plans/mockups/generative-ui-json-render.tsx', import.meta.url), 'utf8')
const start = source.indexOf('const plans = spec(')
const end = source.indexOf('function ResponsiveChart', start)
assert.ok(start >= 0 && end > start)
const fixtures: Record<string, unknown> = JSON.parse(JSON.stringify(runInNewContext(
  `${source.slice(start, end)}; ({ plans, performance, bugForm, catalog })`,
  { spec: (elements: unknown) => ({ root: 'root', elements }) }, { timeout: 1000 },
)))
function data(spec: unknown, fields: Partial<GeneratedJsonRenderData> = {}): GeneratedJsonRenderData {
  return { version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Plain summary <script>no</script>', specJson: JSON.stringify(spec), ...fields }
}
function single(type: string, props: Record<string, unknown>, on?: unknown) {
  return { root: 'root', elements: { root: { type, props, ...(on ? { on } : {}) } } }
}

for (const [name, expected] of Object.entries({ plans: 'Plans for your team', performance: 'Tasks completed', bugForm: 'Bug report', catalog: 'Q4 rollout' })) {
  test(`renders the approved ${name} spec with real primitives`, () => {
    const html = renderToStaticMarkup(<JsonRenderCard partId={name} data={data(fixtures[name])} />)
    assert.ok(html.includes(expected))
    assert.ok(!html.includes('Could not display this view'))
    if (name === 'plans') assert.ok(html.includes('data-slot="table"') && html.includes('Current'))
    if (name === 'catalog') assert.ok(html.includes('data-slot="tabs"') && html.includes('data-slot="code-block"'))
  })
}

for (const [name, fields] of Object.entries({
  'bad JSON': { specJson: '{' },
  'invalid spec': { specJson: JSON.stringify(single('Unknown', {})) },
  'wrong catalog version': { catalogVersion: 99 },
  'empty spec': { specJson: '{}' },
  'bad state JSON': { stateJson: '{' },
})) {
  test(`shows the quiet plain-text fallback for ${name}`, () => {
    const html = renderToStaticMarkup(<JsonRenderCard partId="fallback" data={data(fixtures.plans, fields)} />)
    assert.ok(html.includes('Plain summary &lt;script&gt;no&lt;/script&gt;'))
    assert.ok(html.includes('class="gen-fallback">Could not display this view'))
    assert.ok(!html.includes('<script>'))
  })
}

test('seeds bound state and locks a submitted form', () => {
  const html = renderToStaticMarkup(<JsonRenderCard partId="submitted" data={data(fixtures.bugForm, {
    stateJson: JSON.stringify({ form: { title: 'Broken sidebar', severity: 'High', steps: 'Open a thread', logs: true } }), submittedAt: 123,
  })} />)
  assert.ok(html.includes('value="Broken sidebar"'))
  assert.ok(html.includes('Open a thread'))
  assert.ok(html.includes('readOnly=""'))
  assert.ok(html.includes('disabled=""'))
})

test('keeps currency, markup and code as plain text', () => {
  const html = renderToStaticMarkup(<JsonRenderCard partId="plain" data={data(single('Text', { text: '$5 to $10 <img src=x> **bold**' }))} />)
  assert.ok(html.includes('$5 to $10 &lt;img src=x&gt; **bold**'))
  assert.ok(!html.includes('<img'))
})

test('renders Image, RadioGroup and all chart types', () => {
  for (const spec of [single('Image', { src: 'https://example.com/image.png', alt: 'Preview' }),
    single('RadioGroup', { label: 'Priority', options: ['Low', 'High'], value: 'Low' }),
    ...['bar', 'line', 'area', 'pie'].map((type) => single('Chart', { title: 'Runs', type, labels: ['Mon', 'Tue'], values: [1, 2] }))]) {
    const html = renderToStaticMarkup(<JsonRenderCard partId="extra" data={data(spec)} />)
    assert.ok(!html.includes('Could not display this view'))
  }
})

test('catches a render-time component throw without losing the transcript', async (t) => {
  t.mock.method(console, 'error', () => {})
  const original = jsonRenderRegistry.Text
  jsonRenderRegistry.Text = protectJsonRenderComponent(() => { throw new Error('Render failed') })
  let renderer: TestRenderer | undefined
  try {
    await act(async () => { renderer = create(<JsonRenderCard partId="throw" data={data(single('Text', { text: 'Hello' }))} />) })
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('Could not display this view'))
  } finally {
    jsonRenderRegistry.Text = original
    await act(async () => renderer?.unmount())
  }
})

test('memoizes settled cards despite parent data-object churn and refreshes changed specs', async (t) => {
  t.mock.method(console, 'error', () => {})
  const original = jsonRenderRegistry.Text
  let renders = 0
  jsonRenderRegistry.Text = (props) => { renders++; return original(props) }
  const value = data(single('Text', { text: 'Hello' }))
  let renderer: TestRenderer | undefined
  try {
    await act(async () => { renderer = create(<JsonRenderCard partId="memo" data={value} />) })
    const initial = renders
    await act(async () => { renderer!.update(<JsonRenderCard partId="memo" data={{ ...value }} />) })
    assert.equal(renders, initial)
    await act(async () => { renderer!.update(<JsonRenderCard partId="memo" data={data(single('Text', { text: 'Changed' }))} />) })
    assert.ok(renders > initial)
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('Changed'))
  } finally {
    jsonRenderRegistry.Text = original
    await act(async () => renderer?.unmount())
  }
})

test('forwards submit/send callbacks, uses current callbacks and safely no-ops when absent', async (t) => {
  t.mock.method(console, 'error', () => {})
  const calls: unknown[] = []
  const spec = single('Button', { label: 'Go' }, { press: [{ action: 'send_message', params: { text: 'Continue' } }, { action: 'submit', params: { label: 'Report' } }] })
  const value = data(spec, { stateJson: '{"title":"A bug"}' })
  let renderer: TestRenderer | undefined
  const click = async () => { await act(async () => { (renderer!.root.findAll((node) => node.type === 'button')[0].props.onClick as () => void)() }) }
  try {
    await act(async () => { renderer = create(<JsonRenderCard partId="actions" data={value} />) })
    await click()
    await act(async () => { renderer!.update(<JsonRenderCard partId="actions" data={value} actions={{
      onSendMessage: (text, partId) => { calls.push([text, partId]) }, onSubmit: (state, label, partId) => { calls.push([state, label, partId]) },
    }} />) })
    await click()
    assert.deepEqual(calls, [['Continue', 'actions'], [{ title: 'A bug' }, 'Report', 'actions']])
    await act(async () => { renderer!.update(<JsonRenderCard partId="actions" data={value} readOnly actions={{ onSendMessage: () => { calls.push('unexpected') } }} />) })
    await click()
    assert.equal(calls.length, 2)
  } finally { await act(async () => renderer?.unmount()) }
})

test('bound input edits notify the state hook without persistence', async (t) => {
  t.mock.method(console, 'error', () => {})
  const changes: unknown[] = []
  const spec = single('Input', { label: 'Title', value: { $bindState: '/title' } })
  let renderer: TestRenderer | undefined
  try {
    await act(async () => { renderer = create(<JsonRenderCard partId="form" data={data(spec, { stateJson: '{"title":"Initial"}' })} actions={{ onStateChange: (value, partId) => { changes.push([value, partId]) } }} />) })
    const input = () => renderer!.root.findAll((node) => node.type === 'input')[0]
    assert.equal(input().props.value, 'Initial')
    await act(async () => { (input().props.onChange as (event: unknown) => void)({ target: { value: 'Edited' } }) })
    assert.equal(input().props.value, 'Edited')
    assert.deepEqual(changes, [[[{ path: '/title', value: 'Edited' }], 'form']])
  } finally { await act(async () => renderer?.unmount()) }
})

test('copy_text and open_link work locally with HTTPS and noopener', async (t) => {
  t.mock.method(console, 'error', () => {})
  const calls: unknown[] = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { open: (...args: unknown[]) => { calls.push(args) } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text: string) => { calls.push(text) } } } })
  const spec = single('Button', { label: 'Go' }, { press: [{ action: 'copy_text', params: { text: 'Copied' } }, { action: 'open_link', params: { url: 'https://example.com/guide' } }] })
  let renderer: TestRenderer | undefined
  try {
    await act(async () => { renderer = create(<JsonRenderCard partId="local-actions" data={data(spec)} />) })
    await act(async () => { (renderer!.root.findAll((node) => node.type === 'button')[0].props.onClick as () => void)() })
    assert.deepEqual(calls, ['Copied', ['https://example.com/guide', '_blank', 'noopener,noreferrer']])
  } finally {
    await act(async () => renderer?.unmount())
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})
