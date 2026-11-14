'use client'

import { Children, Component, createContext, useContext, useId, type ContextType, type CSSProperties, type ReactNode } from 'react'
import { defineRegistry, useBoundProp, type Components, type ComponentRenderer } from '@json-render/react'
import { generativeUiCatalog } from '@overlay/chat-core/generative-ui'
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent, Alert, AlertDescription,
  Avatar, AvatarFallback, Badge, Button, Card, CardHeader, CardTitle, CardDescription, CardContent,
  ChartContainer, ChartTooltip, ChartTooltipContent, Checkbox, Input, Progress, RadioGroup,
  RadioGroupItem, SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem, Separator,
  Switch, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption,
  Tabs, TabsTriggerList, TabsTrigger, TabsContent, Textarea,
} from '@overlay/ui/primitives'
import { CodeBlock, CodeBlockHeader, CodeBlockTitle, CodeBlockContent, CodeBlockCopyButton } from '@overlay/ui/ai'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { ExternalLink, TriangleAlert } from 'lucide-react'
import { ComparisonComponent, DiagramComponent, TimelineComponent, VectorComponent } from './expressive-json-render'
import { JsonRenderReadOnly } from './json-render-registry-context'

export { JsonRenderReadOnly } from './json-render-registry-context'

export const JsonRenderFailure = createContext<(() => void) | null>(null)

class RegistryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  static contextType = JsonRenderFailure
  declare context: ContextType<typeof JsonRenderFailure>
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.context?.() }
  render() { return this.state.failed ? null : this.props.children }
}

export function protectJsonRenderComponent(Render: ComponentRenderer): ComponentRenderer {
  return function ProtectedComponent(props) {
    return <RegistryBoundary><Render {...props} /></RegistryBoundary>
  }
}

function plain(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

type FieldProps = {
  type: 'Input' | 'Textarea' | 'Select' | 'RadioGroup'
  props: { label: string; value?: unknown; placeholder?: string | null; options?: string[] }
  bindings?: Record<string, string>
}
function BoundField({ type, props: p, bindings }: FieldProps) {
  const readOnly = useContext(JsonRenderReadOnly)
  const [value, setValue] = useBoundProp(p.value, bindings?.value)
  const id = useId()
  const options = p.options ?? []
  return <div className="gen-field"><label id={`${id}-label`} htmlFor={id}>{p.label}</label>
    {type === 'Select' ? <SelectRoot value={plain(value)} onValueChange={setValue} disabled={readOnly}>
      <SelectTrigger id={id} className="w-full"><SelectValue placeholder={p.placeholder ?? 'Choose an option'} /></SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
    </SelectRoot> : type === 'RadioGroup' ? <RadioGroup id={id} aria-labelledby={`${id}-label`} value={plain(value)} onValueChange={setValue} disabled={readOnly}>
      {options.map((option, index) => <label className="gen-check" key={option} htmlFor={`${id}-${index}`}><RadioGroupItem id={`${id}-${index}`} value={option} />{option}</label>)}
    </RadioGroup> : type === 'Textarea' ? <Textarea id={id} value={plain(value)} onChange={(event) => setValue(event.target.value)} readOnly={readOnly} placeholder={p.placeholder ?? undefined} rows={3} />
      : <Input id={id} value={plain(value)} onChange={(event) => setValue(event.target.value)} readOnly={readOnly} placeholder={p.placeholder ?? undefined} />}
  </div>
}

function BoundCheck({ type, props: p, bindings }: { type: 'Checkbox' | 'Switch'; props: { label: string; checked?: unknown }; bindings?: Record<string, string> }) {
  const readOnly = useContext(JsonRenderReadOnly)
  const [checked, setChecked] = useBoundProp(p.checked, bindings?.checked)
  const id = useId()
  const Control = type === 'Checkbox' ? Checkbox : Switch
  return <label className="gen-check" htmlFor={id}><Control id={id} checked={!!checked} onCheckedChange={setChecked} disabled={readOnly} />{p.label}</label>
}

const chartColors = ['var(--chart-1)', 'var(--muted)', 'var(--success)', 'var(--warning)', 'var(--danger)']
function SpecChart({ props: p }: Parameters<Components<typeof generativeUiCatalog>['Chart']>[0]) {
  const series = p.series?.length ? p.series : [{ label: p.title, values: p.values }]
  const data = p.labels.map((label, index) => Object.fromEntries([
    ['label', label], ...series.map((item, i) => [`series${i}`, item.values[index]]),
  ]))
  const config = Object.fromEntries(series.map((item, index) => [`series${index}`, { label: item.label, color: chartColors[index % chartColors.length] }]))
  const axes = <><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} minTickGap={0} interval={0} /><YAxis width={28} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickCount={3} /><ChartTooltip content={<ChartTooltipContent />} /></>
  const common = { data, accessibilityLayer: true, margin: { top: 4, right: 8, bottom: 0, left: 0 } }
  return <Card className="gen-card"><CardHeader><CardTitle>{p.title}</CardTitle>{p.description && <CardDescription>{p.description}</CardDescription>}</CardHeader><CardContent>
    <ChartContainer config={config} className="gen-chart" style={{ height: 190, width: '100%' }}>
      {p.type === 'pie' ? <PieChart accessibilityLayer><ChartTooltip content={<ChartTooltipContent nameKey="label" />} /><Pie data={data} dataKey="series0" nameKey="label" isAnimationActive={false}>{data.map((_, index) => <Cell key={index} fill={chartColors[index % chartColors.length]} />)}</Pie></PieChart>
        : p.type === 'line' ? <LineChart {...common}>{axes}{series.map((item, index) => <Line key={item.label} dataKey={`series${index}`} stroke={`var(--color-series${index})`} strokeWidth={2} dot={false} isAnimationActive={false} />)}</LineChart>
          : p.type === 'area' ? <AreaChart {...common}>{axes}{series.map((item, index) => <Area key={item.label} dataKey={`series${index}`} stroke={`var(--color-series${index})`} fill={`var(--color-series${index})`} fillOpacity={0.15} isAnimationActive={false} />)}</AreaChart>
            : <BarChart {...common}>{axes}{series.map((item, index) => <Bar key={item.label} dataKey={`series${index}`} fill={`var(--color-series${index})`} radius={4} maxBarSize={35} isAnimationActive={false} />)}</BarChart>}
    </ChartContainer>
  </CardContent></Card>
}

const components: Components<typeof generativeUiCatalog> = {
  Stack: ({ props: p, children }) => <div className={`gen-stack ${p.direction === 'horizontal' ? 'horizontal' : ''}`} style={{ gap: p.gap ?? 16 }}>{children}</div>,
  Grid: ({ props: p, children }) => <div className="gen-grid" style={{ '--columns': p.columns, gap: p.gap ?? 12 } as CSSProperties}>{children}</div>,
  Card: ({ props: p, children }) => <Card className="gen-card">{(p.title || p.description) && <CardHeader>{p.title && <CardTitle>{p.title}</CardTitle>}{p.description && <CardDescription>{p.description}</CardDescription>}</CardHeader>}<CardContent>{children}</CardContent></Card>,
  Separator: () => <Separator />,
  Heading: ({ props: p }) => <h3 className="gen-heading">{plain(p.text)}</h3>,
  Text: ({ props: p }) => <p className={`gen-text ${p.variant ?? ''}`}>{plain(p.text)}</p>,
  Badge: ({ props: p }) => <Badge variant={p.variant === 'outline' ? 'muted' : p.variant ?? undefined}>{p.text}</Badge>,
  Alert: ({ props: p }) => <Alert className={`gen-alert ${p.variant}`}><TriangleAlert size={16} /><AlertDescription>{p.text}</AlertDescription></Alert>,
  KeyValue: ({ props: p }) => <dl className="gen-facts">{p.items.map((item, index) => <div key={index}><dt>{item.label}</dt><dd>{plain(item.value)}</dd></div>)}</dl>,
  Metric: ({ props: p }) => <Card className="gen-metric"><CardContent><p className="gen-muted">{p.label}</p><div className="metric-value">{plain(p.value)}{p.delta && <span className="metric-delta">{p.delta}</span>}</div></CardContent></Card>,
  Progress: ({ props: p }) => <div className="gen-stack"><div className="gen-split"><span>{p.label}</span><span className="gen-muted">{p.value}%</span></div><Progress value={p.value} aria-label={p.label ?? 'Progress'} /></div>,
  Avatar: ({ props: p }) => <div className="gen-owner"><Avatar><AvatarFallback>{p.initials}</AvatarFallback></Avatar><div>{p.name}{p.caption && <p className="gen-muted">{p.caption}</p>}</div></div>,
  Link: ({ props: p }) => { const readOnly = useContext(JsonRenderReadOnly); return <a className="gen-link" href={readOnly ? undefined : p.url} aria-disabled={readOnly} tabIndex={readOnly ? -1 : undefined} onClick={event => { if (readOnly) event.preventDefault() }} target="_blank" rel="noopener noreferrer">{p.label}<ExternalLink size={13} /></a> },
  CodeBlock: ({ props: p }) => { const readOnly = useContext(JsonRenderReadOnly); return <CodeBlock size="sm"><CodeBlockHeader><CodeBlockTitle>{p.language}</CodeBlockTitle>{!readOnly ? <CodeBlockCopyButton value={p.code} /> : null}</CodeBlockHeader><CodeBlockContent>{p.code}</CodeBlockContent></CodeBlock> },
  // eslint-disable-next-line @next/next/no-img-element
  Image: ({ props: p }) => <figure><img src={p.src} alt={p.alt} className="gen-image" loading="lazy" />{p.caption && <figcaption className="gen-muted">{p.caption}</figcaption>}</figure>,
  Table: ({ props: p }) => <Table>{p.caption && <TableCaption>{p.caption}</TableCaption>}<TableHeader><TableRow>{p.columns.map((column, index) => <TableHead key={index}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{p.rows.map((row, index) => <TableRow key={index}>{row.map((cell, i) => <TableCell key={i}>{plain(cell)}{i === 0 && cell === p.current && <Badge className="current-badge">Current</Badge>}</TableCell>)}</TableRow>)}</TableBody></Table>,
  Chart: SpecChart,
  Timeline: TimelineComponent,
  Comparison: ComparisonComponent,
  Diagram: DiagramComponent,
  Vector: VectorComponent,
  Tabs: ({ props: p, children }) => <Tabs defaultValue={p.labels[0]}><TabsTriggerList>{p.labels.map((label, index) => <TabsTrigger key={index} value={label}>{label}</TabsTrigger>)}</TabsTriggerList>{Children.toArray(children).map((child, index) => <TabsContent key={index} value={p.labels[index]} className="gen-tab-content">{child}</TabsContent>)}</Tabs>,
  Accordion: ({ props: p }) => <Accordion type="single" collapsible><AccordionItem value="details"><AccordionTrigger>{p.title}</AccordionTrigger><AccordionContent>{p.text}</AccordionContent></AccordionItem></Accordion>,
  Input: (context) => <BoundField type="Input" {...context} />,
  Textarea: (context) => <BoundField type="Textarea" {...context} />,
  Select: (context) => <BoundField type="Select" {...context} />,
  RadioGroup: (context) => <BoundField type="RadioGroup" {...context} />,
  Checkbox: (context) => <BoundCheck type="Checkbox" {...context} />,
  Switch: (context) => <BoundCheck type="Switch" {...context} />,
  Button: function ActionButton({ props: p, emit }) {
    const readOnly = useContext(JsonRenderReadOnly)
    return <Button className="gen-submit" disabled={readOnly} onClick={() => emit('press')}>{p.label}</Button>
  },
}

const { registry } = defineRegistry(generativeUiCatalog, {
  components,
  actions: { copy_text: async () => {}, open_link: async () => {}, send_message: async () => {}, submit: async () => {} },
})

export const jsonRenderRegistry = Object.fromEntries(Object.entries(registry).map(([name, render]) => [name, protectJsonRenderComponent(render)]))
