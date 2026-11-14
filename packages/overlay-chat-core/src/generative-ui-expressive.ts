import { z } from 'zod'

const text = z.string().max(4000)
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().optional()
const expressiveTone = z.enum(['neutral', 'accent', 'context', 'success', 'warning', 'danger'])
const expressiveId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
const vectorDimension = z.number().finite().min(1).max(2000)
const vectorCoordinate = z.number().finite().min(0).max(2000)
const vectorPaint = z.enum(['none', 'foreground', 'muted', 'border', 'surface', 'accent', 'success', 'warning', 'danger'])
const vectorShapeBase = { id: expressiveId, fill: optional(vectorPaint), stroke: optional(vectorPaint), strokeWidth: optional(z.number().finite().min(0).max(20)) }
const vectorShapes = z.discriminatedUnion('kind', [
  z.object({ ...vectorShapeBase, kind: z.literal('rect'), x: vectorCoordinate, y: vectorCoordinate, width: vectorDimension, height: vectorDimension, radius: optional(z.number().finite().min(0).max(100)) }).strict(),
  z.object({ ...vectorShapeBase, kind: z.literal('circle'), cx: vectorCoordinate, cy: vectorCoordinate, radius: vectorDimension }).strict(),
  z.object({ ...vectorShapeBase, kind: z.literal('ellipse'), cx: vectorCoordinate, cy: vectorCoordinate, rx: vectorDimension, ry: vectorDimension }).strict(),
  z.object({ ...vectorShapeBase, kind: z.literal('line'), x1: vectorCoordinate, y1: vectorCoordinate, x2: vectorCoordinate, y2: vectorCoordinate }).strict(),
  z.object({ ...vectorShapeBase, kind: z.literal('polyline'), points: z.array(z.object({ x: vectorCoordinate, y: vectorCoordinate }).strict()).min(2).max(120) }).strict(),
  z.object({ ...vectorShapeBase, kind: z.literal('path'), d: text.max(2048) }).strict(),
  z.object({ id: expressiveId, kind: z.literal('text'), x: vectorCoordinate, y: vectorCoordinate, text, align: optional(z.enum(['start', 'middle', 'end'])), tone: optional(expressiveTone) }).strict(),
])
const vectorLayout = z.object({ width: vectorDimension, height: vectorDimension, shapes: z.array(vectorShapes).max(120) }).strict()

function component<T extends z.ZodRawShape>(props: T, description: string, strict = true) {
  return { props: strict ? z.object(props).strict() : z.object(props), description, slots: [] }
}

export const expressiveComponents = {
  Timeline: component({
    title: text, events: z.array(z.object({ id: expressiveId, at: text, title: text, detail: optional(text), tone: optional(expressiveTone) }).strict()).min(1).max(40),
    conclusion: optional(text), impact: optional(text),
  }, 'Ordered events with an optional conclusion and impact.'),
  Comparison: component({
    title: text,
    options: z.array(z.object({ id: expressiveId, label: text, detail: optional(text) }).strict()).min(2).max(4),
    criteria: z.array(z.object({ id: expressiveId, label: text, values: z.array(z.object({ optionId: expressiveId, value: text }).strict()).min(2).max(4) }).strict()).min(1).max(12),
    priorities: z.array(z.object({ id: expressiveId, label: text, recommendedOptionId: expressiveId, rationale: text }).strict()).min(1).max(8),
    selectedPriority: optional(expressiveId),
  }, 'Compare options across shared criteria and let the reader choose a priority.'),
  Diagram: component({
    title: text, description: text, width: z.number().int().min(320).max(1600), height: z.number().int().min(240).max(1200),
    nodes: z.array(z.object({ id: expressiveId, label: text.max(120), detail: optional(text.max(240)), tone: optional(expressiveTone), x: vectorCoordinate, y: vectorCoordinate, width: z.number().finite().min(120).max(360), height: z.number().finite().min(60).max(180), mobileOrder: z.number().int().min(0).max(39) }).strict()).min(1).max(40),
    edges: z.array(z.object({ id: expressiveId, from: expressiveId, to: expressiveId, label: optional(text.max(100)), tone: optional(expressiveTone) }).strict()).max(80),
  }, 'A bounded positioned diagram. Set every desktop position and mobile order explicitly.'),
  Vector: component({
    title: text, description: text, width: vectorDimension, height: vectorDimension,
    shapes: z.array(vectorShapes).min(1).max(120), narrow: optional(vectorLayout),
  }, 'Accessible illustration built only from bounded typed SVG primitives; never provide SVG markup.'),
}

type AddIssue = (path: string, message: string) => void
type DiagramProps = z.infer<typeof expressiveComponents.Diagram.props>
type ComparisonProps = z.infer<typeof expressiveComponents.Comparison.props>
type VectorShape = z.infer<typeof vectorShapes>
type PathState = { x: number; y: number; startX: number; startY: number }

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length
}

function validateComparison(id: string, p: ComparisonProps, add: AddIssue) {
  const optionIds = p.options.map(option => option.id)
  if (!unique(optionIds)) add(`elements/${id}/props/options`, 'Option IDs must be unique')
  if (!unique(p.criteria.map(item => item.id))) add(`elements/${id}/props/criteria`, 'Criterion IDs must be unique')
  if (!unique(p.priorities.map(item => item.id))) add(`elements/${id}/props/priorities`, 'Priority IDs must be unique')
  for (const criterion of p.criteria) {
    const ids = criterion.values.map(value => value.optionId)
    if (!unique(ids) || ids.length !== optionIds.length || optionIds.some(optionId => !ids.includes(optionId))) {
      add(`elements/${id}/props/criteria`, 'Each criterion must provide one value for every option')
    }
  }
  if (p.priorities.some(priority => !optionIds.includes(priority.recommendedOptionId))) add(`elements/${id}/props/priorities`, 'Priority recommendations must refer to an option')
  if (p.selectedPriority && !p.priorities.some(priority => priority.id === p.selectedPriority)) add(`elements/${id}/props/selectedPriority`, 'Selected priority must exist')
}

function overlaps(a: DiagramProps['nodes'][number], b: DiagramProps['nodes'][number]): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function validateDiagram(id: string, p: DiagramProps, add: AddIssue) {
  const ids = p.nodes.map(node => node.id)
  if (!unique(ids)) add(`elements/${id}/props/nodes`, 'Node IDs must be unique')
  if (!unique(p.nodes.map(node => node.mobileOrder))) add(`elements/${id}/props/nodes`, 'Mobile order values must be unique')
  if (!unique(p.edges.map(edge => edge.id))) add(`elements/${id}/props/edges`, 'Edge IDs must be unique')
  for (const node of p.nodes) if (node.x + node.width > p.width || node.y + node.height > p.height) {
    add(`elements/${id}/props/nodes/${node.id}`, 'Node position exceeds the diagram bounds')
  }
  for (let i = 0; i < p.nodes.length; i++) for (let j = i + 1; j < p.nodes.length; j++) {
    if (overlaps(p.nodes[i]!, p.nodes[j]!)) add(`elements/${id}/props/nodes`, `Nodes ${p.nodes[i]!.id} and ${p.nodes[j]!.id} overlap`)
  }
  if (p.edges.some(edge => !ids.includes(edge.from) || !ids.includes(edge.to))) add(`elements/${id}/props/edges`, 'Edges must refer to existing node IDs')
}

const pathNumber = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const pathTokenPattern = new RegExp(`[MmLlHhVvCcQqZz]|${pathNumber}`, 'g')
const pathArity: Record<string, number> = { M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1, C: 6, c: 6, Q: 4, q: 4, Z: 0, z: 0 }

function pathPointIndexes(command: string): number[] {
  return command === 'C' || command === 'c' ? [0, 1, 2]
    : command === 'Q' || command === 'q' ? [0, 1]
      : /[MmLl]/.test(command) ? [0] : []
}

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x <= width && y >= 0 && y <= height
}

function validatePathPointGroup(command: string, values: number[], state: PathState, width: number, height: number): boolean {
  const relative = command === command.toLowerCase()
  const originX = state.x
  const originY = state.y
  const pairs = pathPointIndexes(command)
  for (const pair of pairs) {
    const xIndex = pair * 2
    const px = relative ? originX + values[xIndex]! : values[xIndex]!
    const py = relative ? originY + values[xIndex + 1]! : values[xIndex + 1]!
    if (!inBounds(px, py, width, height)) return false
    if (pair === pairs.at(-1)) { state.x = px; state.y = py }
    if ((command === 'M' || command === 'm') && pair === 0) { state.startX = px; state.startY = py }
  }
  if (command === 'H' || command === 'h') state.x = relative ? state.x + values[0]! : values[0]!
  if (command === 'V' || command === 'v') state.y = relative ? state.y + values[0]! : values[0]!
  return inBounds(state.x, state.y, width, height)
}

function validatePathCommand(command: string, values: number[], state: PathState, width: number, height: number): boolean {
  const arity = pathArity[command]
  if (arity === 0) {
    if (values.length) return false
    state.x = state.startX
    state.y = state.startY
    return true
  }
  if (!arity || !values.length || values.length % arity) return false
  for (let offset = 0; offset < values.length; offset += arity) {
    if (!validatePathPointGroup(command, values.slice(offset, offset + arity), state, width, height)) return false
  }
  return true
}

function safePathData(value: string, width: number, height: number): boolean {
  const tokens = value.match(pathTokenPattern)
  if (!tokens || value.replace(pathTokenPattern, '').replace(/[\s,]/g, '')) return false
  let command = ''
  let operands: number[] = []
  let count = 0
  const state: PathState = { x: 0, y: 0, startX: 0, startY: 0 }
  for (const token of tokens) {
    if (Object.hasOwn(pathArity, token)) {
      if (command && !validatePathCommand(command, operands, state, width, height)) return false
      command = token
      operands = []
      count++
      if (count > 128 || count === 1 && token !== 'M' && token !== 'm') return false
    } else {
      if (!command || command === 'Z' || command === 'z') return false
      const parsed = Number(token)
      if (!Number.isFinite(parsed) || Math.abs(parsed) > 2000 || operands.length >= 768) return false
      operands.push(parsed)
    }
  }
  return count > 0 && validatePathCommand(command, operands, state, width, height)
}

function validateVectorLayout(width: number, height: number, shapes: VectorShape[], path: string, add: AddIssue) {
  if (!unique(shapes.map(shape => shape.id))) add(path, 'Shape IDs must be unique')
  const within = (x: number, y: number) => inBounds(x, y, width, height)
  for (const [index, shape] of shapes.entries()) {
    const valid = shape.kind === 'rect' ? shape.width > 0 && shape.height > 0 && shape.x >= 0 && shape.y >= 0 && shape.x + shape.width <= width && shape.y + shape.height <= height
      : shape.kind === 'circle' ? shape.radius > 0 && within(shape.cx - shape.radius, shape.cy - shape.radius) && within(shape.cx + shape.radius, shape.cy + shape.radius)
        : shape.kind === 'ellipse' ? shape.rx > 0 && shape.ry > 0 && within(shape.cx - shape.rx, shape.cy - shape.ry) && within(shape.cx + shape.rx, shape.cy + shape.ry)
          : shape.kind === 'line' ? within(shape.x1, shape.y1) && within(shape.x2, shape.y2)
            : shape.kind === 'polyline' ? shape.points.length >= 2 && shape.points.every(point => within(point.x, point.y))
              : shape.kind === 'path' ? safePathData(shape.d, width, height) : within(shape.x, shape.y)
    if (!valid) add(`${path}/${index}`, 'Shape geometry exceeds the viewBox bounds')
  }
}

export function validateExpressiveComponent(id: string, type: string, props: unknown, add: AddIssue): boolean {
  if (type === 'Timeline') {
    const p = props as z.infer<typeof expressiveComponents.Timeline.props>
    if (!unique(p.events.map(event => event.id))) add(`elements/${id}/props/events`, 'Event IDs must be unique')
    return true
  }
  if (type === 'Comparison') { validateComparison(id, props as ComparisonProps, add); return true }
  if (type === 'Diagram') { validateDiagram(id, props as DiagramProps, add); return true }
  if (type === 'Vector') {
    const p = props as z.infer<typeof expressiveComponents.Vector.props>
    validateVectorLayout(p.width, p.height, p.shapes, `elements/${id}/props/shapes`, add)
    if (p.narrow) validateVectorLayout(p.narrow.width, p.narrow.height, p.narrow.shapes, `elements/${id}/props/narrow/shapes`, add)
    return true
  }
  return false
}
