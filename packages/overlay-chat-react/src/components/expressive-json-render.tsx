'use client'

import { useContext, useId, useState, type CSSProperties } from 'react'
import { ArrowRight } from 'lucide-react'
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from '@overlay/ui/primitives'
import { JsonRenderReadOnly } from './json-render-registry-context'

type Tone = 'neutral' | 'accent' | 'context' | 'success' | 'warning' | 'danger'
type TimelineProps = { title: string; events: Array<{ id: string; at: string; title: string; detail?: string | null; tone?: Tone | null }>; conclusion?: string | null; impact?: string | null }
type ComparisonProps = { title: string; options: Array<{ id: string; label: string; detail?: string | null }>; criteria: Array<{ id: string; label: string; values: Array<{ optionId: string; value: string }> }>; priorities: Array<{ id: string; label: string; recommendedOptionId: string; rationale: string }>; selectedPriority?: string | null }
type DiagramNode = { id: string; label: string; detail?: string | null; tone?: Tone | null; x: number; y: number; width: number; height: number; mobileOrder: number }
type DiagramProps = { title: string; description: string; width: number; height: number; nodes: DiagramNode[]; edges: Array<{ id: string; from: string; to: string; label?: string | null; tone?: Tone | null }> }
type Paint = 'none' | 'foreground' | 'muted' | 'border' | 'surface' | 'accent' | 'success' | 'warning' | 'danger'
type VectorShape =
  | { id: string; kind: 'rect'; x: number; y: number; width: number; height: number; radius?: number | null; fill?: Paint | null; stroke?: Paint | null; strokeWidth?: number | null }
  | { id: string; kind: 'circle'; cx: number; cy: number; radius: number; fill?: Paint | null; stroke?: Paint | null; strokeWidth?: number | null }
  | { id: string; kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: Paint | null; stroke?: Paint | null; strokeWidth?: number | null }
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number; fill?: Paint | null; stroke?: Paint | null; strokeWidth?: number | null }
  | { id: string; kind: 'polyline'; points: Array<{ x: number; y: number }>; fill?: Paint | null; stroke?: Paint | null; strokeWidth?: number | null }
  | { id: string; kind: 'path'; d: string; fill?: Paint | null; stroke?: Paint | null; strokeWidth?: number | null }
  | { id: string; kind: 'text'; x: number; y: number; text: string; align?: 'start' | 'middle' | 'end' | null; tone?: Tone | null }
type VectorLayout = { width: number; height: number; shapes: VectorShape[] }
type VectorProps = { title: string; description: string; width: number; height: number; shapes: VectorShape[]; narrow?: VectorLayout | null }

const paints: Record<Exclude<Paint, 'none'>, string> = {
  foreground: 'var(--foreground)', muted: 'var(--muted)', border: 'var(--border)', surface: 'var(--surface-elevated)',
  accent: 'var(--primary)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)',
}
const tonePaint: Record<Tone, string> = { neutral: paints.foreground, accent: paints.foreground, context: paints.muted, success: paints.success, warning: paints.warning, danger: paints.danger }

export function TimelineComponent({ props: p }: { props: TimelineProps }) {
  return <section className="gen-timeline" aria-label={p.title}>
    <h3 className="gen-expressive-title">{p.title}</h3>
    <ol>{p.events.map(event => <li key={event.id} data-tone={event.tone ?? 'neutral'}>
      <time>{event.at}</time><div><h4>{event.title}</h4>{event.detail ? <p>{event.detail}</p> : null}</div>
    </li>)}</ol>
    {p.impact ? <p className="gen-timeline-impact">{p.impact}</p> : null}
    {p.conclusion ? <p className="gen-timeline-conclusion">{p.conclusion}</p> : null}
  </section>
}

export function ComparisonComponent({ props: p }: { props: ComparisonProps }) {
  const readOnly = useContext(JsonRenderReadOnly)
  const [priorityId, setPriorityId] = useState(p.selectedPriority ?? p.priorities[0]?.id ?? '')
  const priority = p.priorities.find(item => item.id === priorityId) ?? p.priorities[0]
  const recommendation = p.options.find(option => option.id === priority?.recommendedOptionId)
  return <section className="gen-comparison" aria-label={p.title}>
    <div className="gen-comparison-heading"><h3 className="gen-expressive-title">{p.title}</h3>
      <label className="gen-priority"><span>Prioritize</span><SelectRoot value={priorityId} onValueChange={setPriorityId} disabled={readOnly}>
        <SelectTrigger aria-label="Comparison priority"><SelectValue /></SelectTrigger>
        <SelectContent>{p.priorities.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
      </SelectRoot></label>
    </div>
    <div className="gen-comparison-options" style={{ '--option-count': p.options.length } as CSSProperties}>{p.options.map(option => <div className="gen-comparison-option" key={option.id} data-recommended={option.id === recommendation?.id}>
      <h4>{option.label}</h4>{option.detail ? <p>{option.detail}</p> : null}
    </div>)}</div>
    <dl style={{ '--option-count': p.options.length } as CSSProperties}>{p.criteria.map(criterion => <div className="gen-comparison-row" key={criterion.id}>
      <dt>{criterion.label}</dt>{p.options.map(option => <dd key={option.id}><span>{option.label}</span>{criterion.values.find(value => value.optionId === option.id)?.value ?? ''}</dd>)}
    </div>)}</dl>
    {priority ? <p className="gen-comparison-recommendation"><strong>{recommendation?.label ?? 'Recommendation'}</strong><span>{priority.rationale}</span></p> : null}
  </section>
}

function edgePath(from: DiagramNode, to: DiagramNode): string {
  const sx = from.x + from.width / 2
  const sy = from.y + from.height / 2
  const tx = to.x + to.width / 2
  const ty = to.y + to.height / 2
  if (tx > sx) {
    const x1 = from.x + from.width
    const x2 = to.x
    const mid = (x1 + x2) / 2
    return `M ${x1} ${sy} H ${mid} V ${ty} H ${x2}`
  }
  const y1 = from.y + from.height
  const y2 = to.y
  const mid = (y1 + y2) / 2
  return `M ${sx} ${y1} V ${mid} H ${tx} V ${y2}`
}

export function DiagramComponent({ props: p }: { props: DiagramProps }) {
  const id = useId().replace(/:/g, '')
  const nodes = new Map(p.nodes.map(node => [node.id, node]))
  const ordered = [...p.nodes].sort((a, b) => a.mobileOrder - b.mobileOrder)
  const slots = Array.from({ length: (ordered.at(-1)?.mobileOrder ?? -1) + 1 }, (_, index) => ordered.find(node => node.mobileOrder === index))
  return <figure className="gen-diagram" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <figcaption><h3 id={`${id}-title`} className="gen-expressive-title">{p.title}</h3><p id={`${id}-description`}>{p.description}</p></figcaption>
    <div className="gen-diagram-wide-scroll"><div className="gen-diagram-wide" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
      <svg className="gen-diagram-edges" viewBox={`0 0 ${p.width} ${p.height}`} preserveAspectRatio="none" aria-hidden="true">
        {p.edges.map(edge => { const from = nodes.get(edge.from); const to = nodes.get(edge.to); return from && to ? <path key={edge.id} d={edgePath(from, to)} data-tone={edge.tone ?? 'neutral'} /> : null })}
      </svg>
      {p.nodes.map(node => <div key={node.id} className="gen-diagram-node" data-tone={node.tone ?? 'neutral'} style={{ left: `${node.x / p.width * 100}%`, top: `${node.y / p.height * 100}%`, width: `${node.width / p.width * 100}%`, minHeight: `${node.height / p.height * 100}%` }}>
        <strong>{node.label}</strong>{node.detail ? <span>{node.detail}</span> : null}
      </div>)}
    </div></div>
    <ol className="gen-diagram-mobile">{slots.map((node, index) => <li key={node?.id ?? `reserved-${index}`} data-reserved={!node} data-tone={node?.tone ?? 'neutral'}>
      {node ? <><strong>{node.label}</strong>{node.detail ? <span>{node.detail}</span> : null}</> : <span className="sr-only">Diagram position reserved</span>}
    </li>)}</ol>
    {p.edges.length ? <ul className="gen-diagram-relations">{p.edges.map(edge => <li key={edge.id}><span>{nodes.get(edge.from)?.label ?? edge.from}</span><ArrowRight size={14} aria-hidden="true" /><span>{edge.label ?? 'connects to'}</span><ArrowRight size={14} aria-hidden="true" /><span>{nodes.get(edge.to)?.label ?? edge.to}</span></li>)}</ul> : null}
  </figure>
}

function SvgShapes({ shapes }: { shapes: VectorShape[] }) {
  return <>{shapes.map(shape => {
    const fill = shape.kind === 'text' || !shape.fill || shape.fill === 'none' ? 'none' : paints[shape.fill]
    const stroke = shape.kind === 'text' ? 'none' : shape.stroke === 'none' || !shape.stroke ? 'none' : paints[shape.stroke]
    const strokeWidth = shape.kind === 'text' ? undefined : shape.strokeWidth ?? 1.5
    if (shape.kind === 'rect') return <rect key={shape.id} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.radius ?? 0} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    if (shape.kind === 'circle') return <circle key={shape.id} cx={shape.cx} cy={shape.cy} r={shape.radius} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    if (shape.kind === 'ellipse') return <ellipse key={shape.id} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    if (shape.kind === 'line') return <line key={shape.id} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} fill="none" stroke={stroke === 'none' ? paints.foreground : stroke} strokeWidth={strokeWidth} />
    if (shape.kind === 'polyline') return <polyline key={shape.id} points={shape.points.map(point => `${point.x},${point.y}`).join(' ')} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    if (shape.kind === 'path') return <path key={shape.id} d={shape.d} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    return <text key={shape.id} x={shape.x} y={shape.y} textAnchor={shape.align ?? 'start'} fill={tonePaint[shape.tone ?? 'neutral']}>{shape.text}</text>
  })}</>
}

function VectorSvg({ layout, title, description, titleId, descriptionId, narrow = false }: { layout: VectorLayout; title: string; description: string; titleId: string; descriptionId: string; narrow?: boolean }) {
  return <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`} style={{ minWidth: `${Math.max(narrow ? 320 : 520, layout.width * 12 / 14)}px` }}>
    <title id={titleId}>{title}</title><desc id={descriptionId}>{description}</desc>
    <SvgShapes shapes={layout.shapes} />
  </svg>
}

export function VectorComponent({ props: p }: { props: VectorProps }) {
  const id = useId().replace(/:/g, '')
  const wide = { width: p.width, height: p.height, shapes: p.shapes }
  return <figure className="gen-vector" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <figcaption><h3 id={`${id}-title`} className="gen-expressive-title">{p.title}</h3><p id={`${id}-description`}>{p.description}</p></figcaption>
    {p.narrow ? <><div className="gen-vector-wide gen-vector-scroll"><VectorSvg layout={wide} title={p.title} description={p.description} titleId={`${id}-wide-title`} descriptionId={`${id}-wide-desc`} /><div className="sr-only">Wide illustration view</div></div><div className="gen-vector-narrow gen-vector-scroll"><VectorSvg layout={p.narrow} title={p.title} description={p.description} titleId={`${id}-narrow-title`} descriptionId={`${id}-narrow-desc`} narrow /></div></>
      : <div className="gen-vector-scroll"><VectorSvg layout={wide} title={p.title} description={p.description} titleId={`${id}-wide-title`} descriptionId={`${id}-wide-desc`} /></div>}
  </figure>
}
