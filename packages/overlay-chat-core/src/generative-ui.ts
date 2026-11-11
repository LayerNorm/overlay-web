import { defineCatalog, defineSchema, type Spec } from '@json-render/core'
import { z } from 'zod'
import { expressiveComponents, validateExpressiveComponent } from './generative-ui-expressive'

export { compileJsonRenderSpecStream, createJsonRenderSpecStreamCompiler } from './generative-ui-stream'
export type { JsonRenderSpecStreamCompiler } from './generative-ui-stream'
export { GENERATIVE_UI_MAX_SPEC_STREAM_BYTES, GENERATIVE_UI_MAX_SPEC_STREAM_PATCHES } from './generative-ui-stream'

export const GENERATIVE_UI_CATALOG_VERSION = 1 as const
export const GENERATIVE_UI_MAX_SPEC_BYTES = 64 * 1024
export const GENERATIVE_UI_MAX_ELEMENTS = 200
export const GENERATIVE_UI_MAX_DEPTH = 12
export const GENERATIVE_UI_MAX_STRING_LENGTH = 4000
export const GENERATIVE_UI_MAX_ISSUES = 20
export const GENERATIVE_UI_ACTIONS = ['copy_text', 'open_link', 'send_message', 'submit'] as const

const text = z.string().max(GENERATIVE_UI_MAX_STRING_LENGTH)
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().optional()
const statePath = text.regex(/^\/(?:[^~]|~[01])*$/).refine((path) =>
  !path.split('/').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part)), 'Unsafe state path')
const stateReference = z.object({ $state: statePath }).strict()
const binding = z.union([stateReference, z.object({ $bindState: statePath }).strict()])
const boundText = z.union([text, binding])
const boundBoolean = z.union([z.boolean(), binding])
const cell = z.union([text, z.number().finite(), z.boolean(), z.null()])

function isHttpsUrl(value: string): boolean {
  if (!value.startsWith('https://') || /[\s\\]/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}
const httpsUrl = text.refine(isHttpsUrl, 'URL must use HTTPS')
function isWorkspaceFileUrl(value: string): boolean {
  const match = /^\/api\/v1\/files\/((?:[A-Za-z0-9._~!()*'-]|%[\da-fA-F]{2})+)\/content$/.exec(value)
  if (!match) return false
  try {
    const id = decodeURIComponent(match[1]!)
    return id !== '.' && id !== '..' && !/[\/\\\s]/.test(id)
  } catch {
    return false
  }
}
const imageUrl = text.refine((value) => isHttpsUrl(value) || isWorkspaceFileUrl(value),
  'Image must use HTTPS or a workspace file content URL')
const actionName = z.enum(GENERATIVE_UI_ACTIONS)
const actionParams = {
  copy_text: z.object({ text: z.union([text, stateReference]) }).strict(),
  open_link: z.object({ url: httpsUrl }).strict(),
  send_message: z.object({ text: z.union([text, stateReference]) }).strict(),
  submit: z.object({ label: optional(text) }).strict(),
}
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('copy_text'), params: actionParams.copy_text }).strict(),
  z.object({ action: z.literal('open_link'), params: actionParams.open_link }).strict(),
  z.object({ action: z.literal('send_message'), params: actionParams.send_message }).strict(),
  z.object({ action: z.literal('submit'), params: optional(actionParams.submit) }).strict(),
])

function component<T extends z.ZodRawShape>(props: T, description: string, children = false, strict = false) {
  return { props: strict ? z.object(props).strict() : z.object(props), description, slots: children ? ['default'] : [] }
}

const field = { label: text, value: optional(boundText), placeholder: optional(text) }
const options = z.array(text).min(1)
const components = {
  Stack: component({ direction: optional(z.enum(['horizontal', 'vertical'])), gap: optional(z.number().min(0).max(64)) }, 'Arrange children in a row or column.', true),
  Grid: component({ columns: z.number().int().min(1).max(4), gap: optional(z.number().min(0).max(64)) }, 'Responsive grid of children.', true),
  Card: component({ title: optional(text), description: optional(text) }, 'Bordered content group.', true),
  Separator: component({}, 'Separate content.'),
  Heading: component({ text: boundText }, 'Plain-text heading.'),
  Text: component({ text: boundText, variant: optional(z.enum(['body', 'muted', 'caption'])) }, 'Plain text, never markdown.'),
  Badge: component({ text, variant: optional(z.enum(['default', 'muted', 'outline', 'danger', 'success', 'warning'])) }, 'Short status label.'),
  Alert: component({ text, variant: z.enum(['info', 'warning', 'error', 'success']) }, 'Status or warning message.'),
  KeyValue: component({ items: z.array(z.object({ label: text, value: cell }).strict()) }, 'Label and value list.'),
  Metric: component({ label: text, value: cell, delta: optional(text), format: optional(z.enum(['number', 'currency', 'percent', 'duration'])) }, 'Single metric with optional change.'),
  Progress: component({ label: optional(text), value: z.number().min(0).max(100) }, 'Progress from 0 to 100.'),
  Avatar: component({ initials: text, name: text, caption: optional(text) }, 'Person initials and name.'),
  Link: component({ label: text, url: httpsUrl }, 'Open an HTTPS URL in a new tab.'),
  CodeBlock: component({ language: text, code: text }, 'Display code as text, never execute it.'),
  Image: component({ src: imageUrl, alt: text, caption: optional(text) }, 'HTTPS or workspace file image.'),
  Table: component({ columns: z.array(text).min(1), rows: z.array(z.array(cell)), current: optional(text), caption: optional(text) }, 'Plain-text cells. Current marks a row by its first cell.'),
  Chart: component({
    title: text, description: optional(text), type: optional(z.enum(['bar', 'line', 'area', 'pie'])),
    labels: z.array(text).min(1), values: z.array(z.number().finite()).min(1),
    series: optional(z.array(z.object({ label: text, values: z.array(z.number().finite()) }).strict())),
  }, 'Chart from provided labels and values only; defaults to bar. No fetching.'),
  ...expressiveComponents,
  Tabs: component({ labels: z.array(text).min(1) }, 'One child per tab label.', true),
  Accordion: component({ title: text, text }, 'Expandable text section.'),
  Input: component(field, 'Text input bound with $bindState.'),
  Textarea: component(field, 'Multiline input bound with $bindState.'),
  Select: component({ ...field, options }, 'Select an option, bound with $bindState.'),
  Checkbox: component({ label: text, checked: optional(boundBoolean) }, 'Checkbox bound with $bindState.'),
  Switch: component({ label: text, checked: optional(boundBoolean) }, 'Switch bound with $bindState.'),
  RadioGroup: component({ ...field, options }, 'Radio options bound with $bindState.'),
  Button: component({ label: text, action: optional(actionName) }, 'Emit an allowlisted action through on.press.'),
}

const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(s.object({
      type: s.ref('catalog.components'), props: s.propsOf('catalog.components'),
      children: { ...s.array(s.string()), ...s.optional() },
      on: { ...s.any(), ...s.optional() },
    })),
    state: { ...s.any(), ...s.optional() },
  }),
  catalog: s.object({
    components: s.map({ props: s.zod(), slots: s.array(s.string()), description: s.string() }),
    actions: s.map({ params: s.zod(), description: s.string() }),
  }),
}), {
  promptTemplate: ({ catalog, componentNames, actionNames, formatZodType, options }) => {
    const definitions = catalog as { components: typeof components; actions: Record<string, { params: z.ZodType; description: string }> }
    return [
      options.system,
      'The render_ui tool takes a spec argument: { root: string, elements: { [id]: { type, props, children?: string[], on?: { press: { action, params? } } } }, state?: object }.',
      'This describes tool arguments only. Never emit a spec, JSONL patches, or a code fence as assistant text.',
      'Components:',
      ...componentNames.map((name) => {
        const definition = definitions.components[name as keyof typeof components]
        return `${name}: ${formatZodType(definition.props)}. ${definition.description}`
      }),
      'Actions:',
      ...actionNames.map((name) => `${name}: ${formatZodType(definitions.actions[name]!.params)}. ${definitions.actions[name]!.description}`),
      ...(options.customRules ?? []),
    ].filter(Boolean).join('\n')
  },
})

export const generativeUiCatalog = defineCatalog(schema, {
  components,
  actions: {
    copy_text: { params: actionParams.copy_text, description: 'Copy text to the clipboard.' },
    open_link: { params: actionParams.open_link, description: 'Open HTTPS in a new tab with noopener.' },
    send_message: { params: actionParams.send_message, description: 'Send a follow-up message in this conversation.' },
    submit: { params: actionParams.submit, description: 'Submit bound form state and lock the card.' },
  },
})

export function buildGenerativeUiCatalogPrompt(): string {
  return generativeUiCatalog.prompt({
    system: 'Use render_ui for comparisons, structured results, dashboards, or forms when UI is clearer than prose.',
    customRules: [
      'Use one spec per reply unless asked otherwise.',
      'To show a view, call render_ui. Prose describing a form does not create fields or a submit button. Only say a view was displayed after render_ui returns success:true. If it fails, fix the listed issues and call render_ui again, or plainly say you could not display it. Never claim success after a failed or omitted call.',
      'No emojis. No em or en dashes in generated copy.',
      'Choose the visual form that fits the answer. Do not default to Card, Metric, or Chart for every response. Use Timeline for ordered events, Comparison for shared criteria and trade-offs, Diagram for positioned nodes and relationships, and Vector for bounded custom illustrations. Prefer open layouts and separators over nested cards.',
      'Prefer Table over markdown tables for more than four columns.',
      'Never put secrets or tokens in a spec.',
      `Limits: ${GENERATIVE_UI_MAX_SPEC_BYTES} serialized UTF-8 bytes, ${GENERATIVE_UI_MAX_ELEMENTS} elements, depth ${GENERATIVE_UI_MAX_DEPTH}, strings ${GENERATIVE_UI_MAX_STRING_LENGTH} characters.`,
      'Use only copy_text, open_link, send_message, submit. No fetching, internal navigation, connector, billing, or approval actions.',
      'Use {$state:"/path"} to read state and {$bindState:"/path"} for form bindings. URLs must be literal HTTPS; only Image also accepts /api/v1/files/{id}/content.',
      'Put initial values in spec.state. Bind value for Input, Textarea, Select and RadioGroup; bind checked for Checkbox and Switch. Select and RadioGroup options are strings. Button actions belong in on.press, not props. submit automatically reads the bound state; its only optional param is label. Leaf children arrays may be omitted. Use the documented props; unsupported component props are ignored.',
      'Timeline events have stable ids, at, title, optional detail and tone; add a conclusion or impact only when useful. Comparison options have stable ids; every criterion supplies one text value per option; priorities select a recommendation. Diagram requires title, description, explicit x/y/width/height for each node, unique mobileOrder values, and edges that reference node ids. Vector requires title, description and a text equivalent; its shapes are typed rect, circle, ellipse, line, polyline, path or text primitives with numeric viewBox coordinates and semantic paint values only. Never provide SVG/XML, CSS, URLs, attributes, or event handlers.',
      `Timeline example: ${JSON.stringify({ root: 'timeline', elements: { timeline: { type: 'Timeline', props: { title: 'Delivery incident', events: [{ id: 'started', at: '09:41', title: 'Queue delay began', tone: 'warning' }, { id: 'recovered', at: '09:47', title: 'Delivery recovered', tone: 'success' }], impact: 'Six minutes of delayed delivery', conclusion: 'Queue depth returned to normal.' } } } })}`,
      `Comparison example: ${JSON.stringify({
        root: 'comparison',
        elements: { comparison: { type: 'Comparison', props: {
          title: 'Delivery choice', options: [{ id: 'queue', label: 'Reliable delivery' }, { id: 'direct', label: 'Lowest latency' }],
          criteria: [{ id: 'speed', label: 'Speed', values: [{ optionId: 'queue', value: 'Moderate' }, { optionId: 'direct', value: 'Fast' }] }],
          priorities: [{ id: 'reliability', label: 'Reliability', recommendedOptionId: 'queue', rationale: 'Retries protect delivery.' }, { id: 'latency', label: 'Lowest latency', recommendedOptionId: 'direct', rationale: 'Direct delivery removes queue delay.' }],
        } } },
      })}`,
      `Diagram example: ${JSON.stringify({ root: 'diagram', elements: { diagram: { type: 'Diagram', props: { title: 'Request to answer', description: 'A request passes access checks, an agent uses tools, and an answer returns.', width: 900, height: 420, nodes: [{ id: 'source', label: 'Source', x: 24, y: 150, width: 150, height: 84, mobileOrder: 0 }, { id: 'agent', label: 'Agent', x: 340, y: 150, width: 180, height: 84, tone: 'accent', mobileOrder: 1 }, { id: 'answer', label: 'Answer', x: 700, y: 150, width: 170, height: 84, tone: 'success', mobileOrder: 2 }], edges: [{ id: 'request', from: 'source', to: 'agent', label: 'request' }, { id: 'response', from: 'agent', to: 'answer', label: 'response' }] } } } })}`,
      `Vector example: ${JSON.stringify({ root: 'illustration', elements: { illustration: { type: 'Vector', props: { title: 'Bounded retry path', description: 'A request retries twice before a final dead-letter exit.', width: 360, height: 180, shapes: [{ id: 'path', kind: 'path', d: 'M 24 90 H 300', stroke: 'border', strokeWidth: 3 }, { id: 'attempt', kind: 'circle', cx: 180, cy: 90, radius: 28, fill: 'surface', stroke: 'accent', strokeWidth: 2 }, { id: 'label', kind: 'text', x: 180, y: 95, text: 'Retry', align: 'middle', tone: 'neutral' }] } } } })}`,
      `For progressive output prefer render_ui({summary, specStream}) for larger views. specStream is a JSONL string inside the tool argument, never assistant prose. Seed first with {"op":"add","path":"/root","value":"view"} and {"op":"add","path":"/elements/view","value":{"type":"Stack","props":{"gap":16},"children":[]}}, then add stable named elements under /elements/<id> and replace the root children array as needed. Use only add and replace on /root, /elements, or /state paths. A final newline is optional.`,
      `Form example: ${JSON.stringify({
        root: 'card',
        state: { form: { title: '', details: '', severity: 'Medium', reproducible: true, frequency: 'Sometimes' } },
        elements: {
          card: { type: 'Card', props: { title: 'Bug report' }, children: ['fields'] },
          fields: { type: 'Stack', props: { gap: 12 }, children: ['heading', 'title', 'details', 'severity', 'reproducible', 'frequency', 'submit'] },
          heading: { type: 'Heading', props: { text: 'Report a bug' } },
          title: { type: 'Input', props: { label: 'Title', placeholder: 'What happened?', value: { $bindState: '/form/title' } } },
          details: { type: 'Textarea', props: { label: 'Details', placeholder: 'Steps to reproduce', value: { $bindState: '/form/details' } } },
          severity: { type: 'Select', props: { label: 'Severity', options: ['Low', 'Medium', 'High'], value: { $bindState: '/form/severity' } } },
          reproducible: { type: 'Checkbox', props: { label: 'Reproducible', checked: { $bindState: '/form/reproducible' } } },
          frequency: { type: 'RadioGroup', props: { label: 'Frequency', options: ['Always', 'Sometimes'], value: { $bindState: '/form/frequency' } } },
          submit: { type: 'Button', props: { label: 'Submit bug report' }, on: { press: { action: 'submit', params: { label: 'Bug report' } } } },
        },
      })}`,
    ],
  })
}

export type JsonRenderSpecIssue = { path: string; message: string }
export type JsonRenderSpecValidation = { ok: true; spec: Spec } | { ok: false; issues: JsonRenderSpecIssue[] }

const envelope = z.object({
  root: z.string().min(1),
  elements: z.record(z.string().min(1), z.object({
    type: z.string(), props: z.record(z.string(), z.unknown()), children: z.array(z.string()).optional(),
    on: z.object({ press: z.union([action, z.array(action).min(1)]) }).strict().optional(),
  }).strict()),
  state: z.record(z.string(), z.unknown()).optional(),
}).strict()

type CatalogSpec = z.infer<typeof envelope>
type CatalogElement = CatalogSpec['elements'][string]
type AddSpecIssue = (path: string, message: string) => void

function validateJsonValues(value: unknown, add: AddSpecIssue): JsonRenderSpecIssue | null {
  const pending = [{ value, path: '', depth: 0 }]
  while (pending.length) {
    const item = pending.pop()!
    if (item.depth > 64) return { path: item.path, message: 'Spec nesting is too deep' }
    if (typeof item.value === 'string' && item.value.length > GENERATIVE_UI_MAX_STRING_LENGTH) add(item.path, 'String exceeds 4000 characters')
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) add(item.path, 'Numbers must be finite')
    if (item.value === undefined || typeof item.value === 'function' || typeof item.value === 'symbol') add(item.path, 'Value must be JSON')
    if (item.value && typeof item.value === 'object') {
      if (!Array.isArray(item.value) && Object.getPrototypeOf(item.value) !== Object.prototype && Object.getPrototypeOf(item.value) !== null) add(item.path, 'Value must be a plain JSON object')
      for (const [key, child] of Object.entries(item.value)) {
        if (key.length > GENERATIVE_UI_MAX_STRING_LENGTH) add(item.path, 'Key exceeds 4000 characters')
        if (['__proto__', 'prototype', 'constructor'].includes(key)) add(item.path, 'Unsafe object key')
        pending.push({ value: child, path: `${item.path}/${key}`, depth: item.depth + 1 })
      }
    }
  }
  return null
}

function normalizeElementChildren(id: string, element: CatalogElement, definition: typeof components[keyof typeof components], add: AddSpecIssue) {
  if (definition.slots.length && Object.hasOwn(element.props, 'children')) {
    const children = z.array(z.string()).safeParse(element.props.children)
    if (!children.success) add(`elements/${id}/props/children`, 'Children must be an array of element IDs')
    else if (element.children && JSON.stringify(element.children) !== JSON.stringify(children.data)) {
      add(`elements/${id}/children`, 'Conflicting children; specify children beside props only')
    } else element.children = children.data
  }
}

function validateElementCollections(id: string, element: CatalogElement, add: AddSpecIssue) {
  if (validateExpressiveComponent(id, element.type, element.props, add)) return
  switch (element.type) {
    case "Table": {
      const p = element.props as z.infer<typeof components.Table.props>
      if (p.rows.some(row => row.length !== p.columns.length)) add(`elements/${id}/props/rows`, "Rows must match column count")
      break
    }
    case "Chart": {
      const p = element.props as z.infer<typeof components.Chart.props>
      if (p.values.length !== p.labels.length || p.series?.some(series => series.values.length !== p.labels.length)) add(`elements/${id}/props/values`, "Chart values must match labels")
      break
    }
    case "Tabs":
      if ((element.props.labels as string[]).length !== (element.children?.length ?? 0)) add(`elements/${id}/children`, "Tabs require one child per label")
      break
  }
}

function validateElement(id: string, element: CatalogElement, spec: CatalogSpec, add: AddSpecIssue) {
  const definition = Object.hasOwn(components, element.type) ? components[element.type as keyof typeof components] : undefined
  if (!definition) {
    add(`elements/${id}/type`, `Unknown component: ${element.type}`)
    return
  }
  normalizeElementChildren(id, element, definition, add)
  const props = definition.props.safeParse(element.props)
  if (!props.success) for (const issue of props.error.issues) add(`elements/${id}/props/${issue.path.join('/')}`, issue.message)
  else element.props = props.data
  if (element.on && element.type !== 'Button') add(`elements/${id}/on`, 'Only Button supports actions')
  if (element.children?.length && !definition.slots.length) add(`elements/${id}/children`, 'Component does not accept children')
  for (const child of element.children ?? []) if (!Object.hasOwn(spec.elements, child)) add(`elements/${id}/children`, `Child does not resolve: ${child}`)
  if (props.success) validateElementCollections(id, element, add)
}

function validateElementTree(spec: CatalogSpec, add: AddSpecIssue) {
  const heights = new Map<string, number>()
  const visiting = new Set<string>()
  function height(id: string): number {
    if (visiting.has(id)) { add(`elements/${id}/children`, 'Element cycle detected'); return GENERATIVE_UI_MAX_DEPTH + 1 }
    if (visiting.size >= GENERATIVE_UI_MAX_DEPTH) { add(`elements/${id}`, 'Spec exceeds depth 12'); return GENERATIVE_UI_MAX_DEPTH + 1 }
    if (heights.has(id)) return heights.get(id)!
    visiting.add(id)
    let depth = 1
    for (const child of spec.elements[id]!.children ?? []) depth = Math.max(depth, 1 + height(child))
    visiting.delete(id)
    heights.set(id, depth)
    return depth
  }
  for (const id of Object.keys(spec.elements)) if (height(id) > GENERATIVE_UI_MAX_DEPTH) add(`elements/${id}`, 'Spec exceeds depth 12')
}

export function validateJsonRenderSpec(value: unknown): JsonRenderSpecValidation {
  const issues: JsonRenderSpecIssue[] = []
  const add: AddSpecIssue = (path, message) => {
    if (issues.length < GENERATIVE_UI_MAX_ISSUES) issues.push({ path, message })
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
    if (typeof serialized !== 'string') throw new Error('Not JSON')
  } catch {
    return { ok: false, issues: [{ path: '', message: 'Spec must be serializable JSON' }] }
  }
  if (new TextEncoder().encode(serialized).byteLength > GENERATIVE_UI_MAX_SPEC_BYTES) {
    return { ok: false, issues: [{ path: '', message: `Spec exceeds ${GENERATIVE_UI_MAX_SPEC_BYTES} serialized bytes` }] }
  }
  const nestingIssue = validateJsonValues(value, add)
  if (nestingIssue) return { ok: false, issues: [nestingIssue] }
  if (issues.length) return { ok: false, issues }
  const parsed = envelope.safeParse(value)
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, GENERATIVE_UI_MAX_ISSUES).map((issue) => ({ path: issue.path.join('/'), message: issue.message })) }
  const spec = parsed.data
  const entries = Object.entries(spec.elements)
  if (entries.length > GENERATIVE_UI_MAX_ELEMENTS) add('elements', 'Spec exceeds 200 elements')
  if (!Object.hasOwn(spec.elements, spec.root)) add('root', 'Root does not resolve to an element')
  for (const [id, element] of entries) validateElement(id, element, spec, add)
  if (issues.length) return { ok: false, issues }
  validateElementTree(spec, add)
  const catalogResult = generativeUiCatalog.validate(spec)
  if (!catalogResult.success) for (const issue of catalogResult.error?.issues ?? []) add(issue.path.join('/'), issue.message)
  return issues.length ? { ok: false, issues } : { ok: true, spec: spec as Spec }
}
