import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  buildGenerativeUiCatalogPrompt, generativeUiCatalog, validateJsonRenderSpec,
  GENERATIVE_UI_CATALOG_VERSION, GENERATIVE_UI_MAX_DEPTH, GENERATIVE_UI_MAX_ELEMENTS,
  GENERATIVE_UI_MAX_ISSUES, GENERATIVE_UI_MAX_SPEC_BYTES, GENERATIVE_UI_MAX_STRING_LENGTH,
  GENERATIVE_UI_MAX_SPEC_STREAM_BYTES, GENERATIVE_UI_MAX_SPEC_STREAM_PATCHES, compileJsonRenderSpecStream,
  createJsonRenderSpecStreamCompiler,
} from './generative-ui'

type Element = { type: string; props: Record<string, unknown>; children?: string[]; on?: unknown }
type TestSpec = { root: string; elements: Record<string, Element>; state?: Record<string, unknown> }

describe('generative UI prompt examples', () => {
  it('validates each expressive example against the shared catalog', () => {
    const examples = [...buildGenerativeUiCatalogPrompt().matchAll(/^(?:Timeline|Comparison|Diagram|Vector) example: (.+)$/gm)]
    expect(examples).toHaveLength(4)
    for (const [, serialized] of examples) expect(validateJsonRenderSpec(JSON.parse(serialized!)).ok).toBe(true)
  })
})

function single(type = 'Text', props: Record<string, unknown> = { text: 'Hello' }): TestSpec {
  return { root: 'root', elements: { root: { type, props } } }
}
function chain(length: number): TestSpec {
  const elements: Record<string, Element> = {}
  for (let i = 0; i < length; i++) elements[`n${i}`] = { type: 'Stack', props: {}, children: i + 1 < length ? [`n${i + 1}`] : [] }
  return { root: 'n0', elements }
}
function invalid(spec: unknown, path?: string): void {
  const result = validateJsonRenderSpec(spec)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues.length).toBeLessThanOrEqual(GENERATIVE_UI_MAX_ISSUES)
    if (path) expect(result.issues.some((issue) => issue.path.includes(path))).toBe(true)
  }
}

const mockup = readFileSync(new URL('../../../internal/plans/mockups/generative-ui-json-render.tsx', import.meta.url), 'utf8')
const start = mockup.indexOf('const plans = spec(')
const end = mockup.indexOf('function ResponsiveChart', start)
if (start < 0 || end < 0) throw new Error('Approved mockup specs not found')
const mockupSpecs: Record<string, TestSpec> = JSON.parse(JSON.stringify(runInNewContext(
  `${mockup.slice(start, end)}; ({ plans, performance, bugForm, catalog })`,
  { spec: (elements: TestSpec['elements']) => ({ root: 'root', elements }) },
  { timeout: 1000 },
)))

describe('json-render v1 catalog', () => {
  it('exports the complete v1 catalog and limits', () => {
    expect(GENERATIVE_UI_CATALOG_VERSION).toBe(1)
    expect([GENERATIVE_UI_MAX_SPEC_BYTES, GENERATIVE_UI_MAX_ELEMENTS, GENERATIVE_UI_MAX_DEPTH, GENERATIVE_UI_MAX_STRING_LENGTH]).toEqual([65536, 200, 12, 4000])
    expect(generativeUiCatalog.componentNames).toEqual([
      'Stack', 'Grid', 'Card', 'Separator', 'Heading', 'Text', 'Badge', 'Alert', 'KeyValue', 'Metric',
      'Progress', 'Avatar', 'Link', 'CodeBlock', 'Image', 'Table', 'Chart', 'Timeline', 'Comparison', 'Diagram', 'Vector', 'Tabs', 'Accordion',
      'Input', 'Textarea', 'Select', 'Checkbox', 'Switch', 'RadioGroup', 'Button',
    ])
    expect(generativeUiCatalog.actionNames).toEqual(['copy_text', 'open_link', 'send_message', 'submit'])
  })

  it.each(Object.keys(mockupSpecs))('accepts the approved %s mockup spec unchanged', (name) => {
    expect(validateJsonRenderSpec(mockupSpecs[name])).toEqual({ ok: true, spec: mockupSpecs[name] })
  })

  it.each([undefined, null, {}, '', [], { root: '', elements: {} }])('rejects an empty or malformed spec: %j', (value) => invalid(value))
  it('rejects unknown components and invalid props', () => {
    invalid(single('Script', { text: 'no' }), 'type')
    invalid(single('Progress', { value: 101 }), 'value')
    invalid(single('Input', { label: 1 }), 'label')
    invalid(single('constructor', {}), 'type')
  })
  it('accepts null optional props', () => {
    expect(validateJsonRenderSpec(single('Card', { title: null, description: null })).ok).toBe(true)
  })
  it('normalizes harmless extra component props without mutating the input', () => {
    for (const [type, props, expected] of [
      ['Input', { label: 'Title', name: 'title', value: { $bindState: '/form/title' } }, { label: 'Title', value: { $bindState: '/form/title' } }],
      ['Button', { label: 'Submit', variant: 'default' }, { label: 'Submit' }],
      ['Text', { text: 'Safe', dangerouslySetInnerHTML: '<script>no</script>' }, { text: 'Safe' }],
    ] as const) {
      const input = single(type, props)
      const result = validateJsonRenderSpec(input)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.spec.elements.root.props).toEqual(expected)
      expect(input.elements.root.props).toEqual(props)
    }
    invalid(single('Input', { label: 'Title', name: 'x'.repeat(4001) }))
    invalid(single('Input', { label: 'Title', value: { $bindState: '/title', extra: true } }))
    invalid(single('Button', { label: 'Submit', action: 'delete_everything' }))
  })
  it('documents an executable nested-state form and truthful tool outcomes', () => {
    const prompt = buildGenerativeUiCatalogPrompt()
    const line = prompt.split('\n').find(line => line.startsWith('Form example: '))!
    const spec = JSON.parse(line.slice('Form example: '.length))
    expect(validateJsonRenderSpec(spec)).toEqual({ ok: true, spec })
    expect(prompt).toContain('Only say a view was displayed after render_ui returns success:true')
    expect(prompt).toContain('Never claim success after a failed or omitted call')
    expect(prompt).toContain('its only optional param is label')
  })
  it('validates bounded expressive components and rejects unsafe vector paths', () => {
    const timeline = single('Timeline', { title: 'Events', events: [{ id: 'one', at: '09:00', title: 'Started' }] })
    const comparison = single('Comparison', {
      title: 'Choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      criteria: [{ id: 'cost', label: 'Cost', values: [{ optionId: 'a', value: 'Low' }, { optionId: 'b', value: 'High' }] }],
      priorities: [{ id: 'p', label: 'Cost', recommendedOptionId: 'a', rationale: 'Lower cost.' }],
    })
    const diagram = single('Diagram', {
      title: 'Flow', description: 'A to B.', width: 600, height: 300,
      nodes: [{ id: 'a', label: 'A', x: 0, y: 100, width: 120, height: 60, mobileOrder: 0 }, { id: 'b', label: 'B', x: 400, y: 100, width: 120, height: 60, mobileOrder: 1 }],
      edges: [{ id: 'ab', from: 'a', to: 'b', label: 'next' }],
    })
    const vector = single('Vector', { title: 'Path', description: 'A line.', width: 120, height: 80, shapes: [{ id: 'line', kind: 'path', d: 'M 1 1 L 100 70', stroke: 'accent' }] })
    const unsafeVector = single('Vector', { title: 'Unsafe', description: 'Bad path.', width: 120, height: 80, shapes: [{ id: 'line', kind: 'path', d: 'M0 0 <script>', stroke: 'accent' }] })
    for (const spec of [timeline, comparison, diagram, vector]) expect(validateJsonRenderSpec(spec).ok).toBe(true)
    invalid(unsafeVector)
    invalid(single('Vector', { title: 'Unsafe', description: 'Bad attributes.', width: 120, height: 80, shapes: [{ id: 'rect', kind: 'rect', x: 0, y: 0, width: 20, height: 20, onload: 'alert(1)' }] }))
    invalid(single('Vector', { title: 'Unsafe', description: 'Bad paint.', width: 120, height: 80, shapes: [{ id: 'rect', kind: 'rect', x: 0, y: 0, width: 20, height: 20, fill: 'url(https://example.com)' }] }))
    invalid(single('Vector', { title: 'Unsafe', description: 'External resource.', width: 120, height: 80, shapes: [{ id: 'image', kind: 'image', src: 'https://example.com/image.svg' }] }))
    invalid(single('Timeline', { title: 'Events', events: [{ id: 'same', at: '09:00', title: 'One' }, { id: 'same', at: '10:00', title: 'Two' }] }))
    invalid(single('Comparison', {
      title: 'Choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      criteria: [{ id: 'same', label: 'Cost', values: [{ optionId: 'a', value: 'Low' }, { optionId: 'b', value: 'High' }] }, { id: 'same', label: 'Speed', values: [{ optionId: 'a', value: 'Fast' }, { optionId: 'b', value: 'Slow' }] }],
      priorities: [{ id: 'same', label: 'Cost', recommendedOptionId: 'a', rationale: 'Low.' }, { id: 'same', label: 'Speed', recommendedOptionId: 'a', rationale: 'Fast.' }],
    }))
    invalid(single('Vector', { title: 'Duplicate IDs', description: 'Two shapes.', width: 120, height: 80, shapes: [
      { id: 'same', kind: 'rect', x: 1, y: 1, width: 20, height: 20 }, { id: 'same', kind: 'circle', cx: 60, cy: 40, radius: 10 },
    ] }))
    invalid(single('Vector', { title: 'Bad path', description: 'Missing operands.', width: 120, height: 80, shapes: [{ id: 'path', kind: 'path', d: 'M 1 1 L 2', stroke: 'accent' }] }))
    invalid(single('Vector', { title: 'Bad path', description: 'Must start with move.', width: 120, height: 80, shapes: [{ id: 'path', kind: 'path', d: 'L 1 2', stroke: 'accent' }] }))
    invalid(single('Vector', { title: 'Bad path', description: 'Relative path is bounded.', width: 120, height: 80, shapes: [{ id: 'path', kind: 'path', d: 'M 1 1 l 100 0 l 100 0', stroke: 'accent' }] }))
    invalid(single('Vector', { title: 'Bad circle', description: 'Circle is bounded.', width: 120, height: 80, shapes: [{ id: 'circle', kind: 'circle', cx: 5, cy: 5, radius: 10 }] }))
    invalid(single('Vector', { title: 'Bad line', description: 'Y uses height bounds.', width: 120, height: 80, shapes: [{ id: 'line', kind: 'line', x1: 1, y1: 100, x2: 2, y2: 2 }] }))
  })
  it('compiles strict JSONL seeds, bounded appends, and rejects malformed paths and protocol attacks', () => {
    expect([GENERATIVE_UI_MAX_SPEC_STREAM_BYTES, GENERATIVE_UI_MAX_SPEC_STREAM_PATCHES]).toEqual([131072, 512])
    const lines = [
      { op: 'add', path: '/root', value: 'view' },
      { op: 'add', path: '/elements/view', value: { type: 'Stack', props: {}, children: [] } },
      { op: 'add', path: '/elements/timeline', value: { type: 'Timeline', props: { title: 'Events', events: [{ id: 'one', at: '09:00', title: 'Started' }] } } },
      { op: 'replace', path: '/elements/view/children', value: ['timeline'] },
    ]
    const stream = lines.map(line => JSON.stringify(line)).join('\n')
    expect(compileJsonRenderSpecStream(stream).ok).toBe(true)
    expect(compileJsonRenderSpecStream(`${stream}\n{` ).ok).toBe(false)
    expect(compileJsonRenderSpecStream([lines[0], { op: 'add', path: '/__proto__/polluted', value: true }].map(line => JSON.stringify(line)).join('\n')).ok).toBe(false)
    expect(compileJsonRenderSpecStream([lines[0], lines[1], { op: 'remove', path: '/elements/view/children' }].map(line => JSON.stringify(line)).join('\n')).ok).toBe(false)
    expect(compileJsonRenderSpecStream(' '.repeat(GENERATIVE_UI_MAX_SPEC_STREAM_BYTES + 1)).ok).toBe(false)
  })
  it('accepts arbitrary string chunk boundaries and a final line without a newline', () => {
    const lines = [
      { op: 'add', path: '/root', value: 'view' },
      { op: 'add', path: '/elements/view', value: { type: 'Stack', props: {}, children: [] } },
      { op: 'add', path: '/elements/note', value: { type: 'Text', props: { text: 'Queue 🧭: "open"\nnext' } } },
      { op: 'replace', path: '/elements/view/children', value: ['note'] },
    ]
    const stream = lines.map(line => JSON.stringify(line)).join('\n')
    for (let split = 0; split <= stream.length; split++) {
      const compiler = createJsonRenderSpecStreamCompiler()
      compiler.push(stream.slice(0, split))
      compiler.push(stream.slice(split))
      expect(compiler.finish().root).toBe('view')
    }
  })
  it('enforces the patch count at exactly 512 and rejects the next patch', () => {
    const seed = [
      { op: 'add', path: '/root', value: 'view' },
      { op: 'add', path: '/elements/view', value: { type: 'Stack', props: {}, children: [] } },
    ]
    const updates = Array.from({ length: GENERATIVE_UI_MAX_SPEC_STREAM_PATCHES - seed.length }, () => ({ op: 'replace', path: '/elements/view/props', value: {} }))
    expect(compileJsonRenderSpecStream([...seed, ...updates].map(line => JSON.stringify(line)).join('\n')).ok).toBe(true)
    expect(compileJsonRenderSpecStream([...seed, ...updates, updates[0]].map(line => JSON.stringify(line)).join('\n')).ok).toBe(false)
  })
  it('moves unambiguous container children out of props and checks the resulting graph', () => {
    const root = { type: 'Card', props: { title: 'Form', children: ['field'] } }
    const field = { type: 'Input', props: { label: 'Title', value: { $bindState: '/form/title' } } }
    const spec = { root: 'root', elements: { root, field } }
    const expected = { root: 'root', elements: { root: { type: 'Card', props: { title: 'Form' }, children: ['field'] }, field } }
    expect(validateJsonRenderSpec(spec)).toEqual({ ok: true, spec: expected })
    expect(root.props.children).toEqual(['field'])
    expect(validateJsonRenderSpec({ ...spec, elements: { ...spec.elements, root: { ...root, children: ['field'] } } }).ok).toBe(true)
    invalid({ ...spec, elements: { ...spec.elements, root: { ...root, children: [] } } }, 'children')
    invalid({ ...spec, elements: { ...spec.elements, root: { ...root, props: { children: ['missing'] } } } }, 'children')
    invalid({ ...spec, elements: { ...spec.elements, root: { ...root, props: { children: [{ type: 'Input' }] } } } }, 'children')
    invalid({ ...spec, elements: { ...spec.elements, root: { ...root, props: { children: ['root'] } } } }, 'children')
  })
  it('rejects dangling root and child references', () => {
    invalid({ ...single(), root: 'missing' }, 'root')
    invalid({ root: 'root', elements: { root: { type: 'Stack', props: {}, children: ['missing'] } } }, 'children')
  })
  it('enforces the UTF-8 serialized-size limit', () => {
    invalid({ ...single(), state: { padding: Array(20).fill('界'.repeat(2000)) } })
    const valid = { ...single(), state: { padding: Array(10).fill('a'.repeat(4000)) } }
    expect(validateJsonRenderSpec(valid).ok).toBe(true)
  })
  it('enforces depth 12, including disconnected elements', () => {
    expect(validateJsonRenderSpec(chain(12)).ok).toBe(true)
    invalid(chain(13))
    invalid({ ...chain(13), root: 'n12' })
  })
  it('rejects cycles', () => {
    const spec = chain(2)
    spec.elements.n1.children = ['n0']
    invalid(spec, 'children')
  })
  it('accepts shared children without exponential traversal', () => {
    const spec = chain(12)
    for (const node of Object.values(spec.elements)) if (node.children?.length) node.children.push(node.children[0])
    expect(validateJsonRenderSpec(spec).ok).toBe(true)
  })
  it('enforces 200 elements', () => {
    const spec = single('Stack', {})
    for (let i = 1; i < 200; i++) spec.elements[`n${i}`] = { type: 'Text', props: { text: `${i}` } }
    expect(validateJsonRenderSpec(spec).ok).toBe(true)
    spec.elements.extra = { type: 'Text', props: { text: 'extra' } }
    invalid(spec, 'elements')
  })
  it('enforces string length in props and state', () => {
    expect(validateJsonRenderSpec(single('Text', { text: 'a'.repeat(4000) })).ok).toBe(true)
    invalid(single('Text', { text: 'a'.repeat(4001) }))
    invalid({ ...single(), state: { text: 'a'.repeat(4001) } })
  })
  it.each(['http://example.com', 'javascript:alert(1)', '//example.com', '/settings', 'https://', 'https://user:pass@example.com', 'https://example.com\\@evil.test'])('rejects unsafe Link and Image URLs: %s', (url) => {
    invalid(single('Link', { label: 'Link', url }), 'url')
    invalid(single('Image', { src: url, alt: 'Image' }), 'src')
  })
  it('accepts HTTPS and the existing workspace file image URL only', () => {
    expect(validateJsonRenderSpec(single('Link', { label: 'Docs', url: 'https://example.com/guide' })).ok).toBe(true)
    expect(validateJsonRenderSpec(single('Image', { src: 'https://example.com/image.png', alt: 'Chart' })).ok).toBe(true)
    expect(validateJsonRenderSpec(single('Image', { src: '/api/v1/files/file%3Aone/content', alt: 'Chart' })).ok).toBe(true)
    invalid(single('Link', { label: 'File', url: '/api/v1/files/one/content' }))
    invalid(single('Image', { src: '/api/v1/files/one/content?token=secret', alt: 'Chart' }))
    invalid(single('Image', { src: '/api/v1/files/%2e%2e/content', alt: 'Chart' }))
    invalid(single('Image', { src: '/api/v1/files/one%2fsecret/content', alt: 'Chart' }))
    invalid(single('Link', { label: 'Link', url: { $state: '/url' } }))
  })
  it.each([
    { action: 'copy_text', params: { text: 'Copied' } },
    { action: 'open_link', params: { url: 'https://example.com' } },
    { action: 'send_message', params: { text: 'Continue' } },
    { action: 'submit', params: { label: 'Bug report' } },
    { action: 'submit' },
  ])('accepts allowlisted action %j', (action) => {
    const spec = single('Button', { label: 'Go' })
    spec.elements.root.on = { press: action }
    expect(validateJsonRenderSpec(spec).ok).toBe(true)
  })
  it.each([
    { action: 'fetch', params: { url: 'https://example.com' } },
    { action: 'setState', params: { statePath: '/url', value: 'javascript:alert(1)' } },
    { action: 'open_link', params: { url: 'http://example.com' } },
    { action: 'open_link', params: { url: { $state: '/url' } } },
    { action: 'copy_text' },
    { action: 'submit', onSuccess: { action: 'fetch' } },
  ])('rejects unknown or unsafe actions: %j', (action) => {
    const spec = single('Button', { label: 'Go' })
    spec.elements.root.on = { press: action }
    invalid(spec, 'on')
  })
  it('rejects unknown props.action and non-Button events', () => {
    invalid(single('Button', { label: 'Go', action: 'fetch' }), 'action')
    const spec = single()
    spec.elements.root.on = { press: { action: 'submit' } }
    invalid(spec, 'on')
  })
  it('preserves $state and $bindState through JSON serialization', () => {
    const spec = structuredClone(mockupSpecs.bugForm)
    spec.state = { form: { title: 'A bug', logs: true }, total: '$1,200' }
    spec.elements.total = { type: 'Text', props: { text: { $state: '/total' } } }
    const roundTrip = JSON.parse(JSON.stringify(spec))
    expect(validateJsonRenderSpec(roundTrip)).toEqual({ ok: true, spec })
    expect(roundTrip.elements.title.props.value).toEqual({ $bindState: '/form/title' })
    expect(roundTrip.elements.total.props.text).toEqual({ $state: '/total' })
  })
  it('rejects unsafe binding paths and non-JSON values', () => {
    invalid(single('Input', { label: 'Name', value: { $bindState: '/__proto__/name' } }))
    invalid(single('Text', { text: () => 'not JSON' }))
    invalid(single('Metric', { label: 'Count', value: Number.NaN }))
    const circular: Record<string, unknown> = {}
    circular.self = circular
    invalid(circular)
  })
  it('validates Table, Tabs and Chart dimensions', () => {
    invalid(single('Table', { columns: ['Name'], rows: [['one', 'two']] }))
    invalid(single('Tabs', { labels: ['Overview'] }))
    invalid(single('Chart', { title: 'Runs', labels: ['Mon'], values: [1, 2] }))
    for (const type of ['bar', 'line', 'area', 'pie']) expect(validateJsonRenderSpec(single('Chart', { title: 'Runs', type, labels: ['Mon'], values: [1] })).ok).toBe(true)
  })
  it('generates tool-argument instructions and the custom rules from the catalog', () => {
    const prompt = buildGenerativeUiCatalogPrompt()
    for (const name of generativeUiCatalog.componentNames) expect(prompt).toContain(`${name}:`)
    expect(prompt).toContain('render_ui tool takes a spec argument')
    expect(prompt).toContain('Never emit a spec, JSONL patches')
    expect(prompt).toContain('one spec per reply')
    expect(prompt).toContain('No emojis. No em or en dashes')
    expect(prompt).toContain('more than four columns')
    expect(prompt).toContain('Never put secrets or tokens')
    expect(prompt).not.toMatch(/[\u2013\u2014]/)
  })
})
