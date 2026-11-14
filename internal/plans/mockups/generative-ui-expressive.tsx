import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowRight, Bot, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Folder,
  ListChecks, MessageSquare, PanelLeft, Pause, Play, Plus, RotateCcw, Send,
  Settings, ShieldCheck, Sun, TriangleAlert, Users, Workflow, X,
} from 'lucide-react'
import { Button } from '../../../packages/overlay-ui/src/components/ui/button'
import { Textarea } from '../../../packages/overlay-ui/src/components/ui/textarea'
import { Toaster, toast } from '../../../packages/overlay-ui/src/components/ui/sonner'
import { Avatar, AvatarFallback } from '../../../packages/overlay-ui/src/components/ui/avatar'
import { DoubleSidebar } from '../../../packages/overlay-shell-react/src/sidebar/DoubleSidebar'
import { OverlayMark } from '../../../packages/overlay-ui/src/components/orb/OverlayMark'
import { SidebarMenu, SidebarMenuSubItem, SidebarMenuSubButton } from '../../../packages/overlay-ui/src/components/ui/sidebar'

type SceneId = 'flow' | 'timeline' | 'tradeoffs' | 'retries'

const scenes: Array<{ id: SceneId; title: string; question: string; status: string }> = [
  { id: 'flow', title: 'How a request becomes an answer', question: 'Can you show how a request becomes an answer?', status: 'Complete' },
  { id: 'timeline', title: 'Why did delivery slow down?', question: 'Why did this answer take just over six minutes?', status: 'Complete' },
  { id: 'tradeoffs', title: 'Queue or direct delivery?', question: 'Which delivery path fits a reliability-first workflow?', status: 'Complete' },
  { id: 'retries', title: 'Where retries go', question: 'Show where a failed delivery goes after each retry.', status: 'Complete' },
]

const flowStages = [
  'Request received',
  'Access checked',
  'Research agent selected',
  'Approved tool selected',
  'Workspace context found',
  'Results brought together',
  'Answer assembled',
]

type FlowNodeData = {
  id: string
  title: string
  detail: string
  detailLines?: [string, string]
  x: number
  y: number
  width: number
  height: number
  reveal: number
  tone: string
}

type FlowEdgeData = { id: string; path: string; reveal: number }

const wideFlowNodes: FlowNodeData[] = [
  { id: 'request', title: 'Request', detail: 'The question', x: 30, y: 183, width: 145, height: 84, reveal: 1, tone: 'source' },
  { id: 'boundary', title: 'Access boundary', detail: 'Identity and thread scope', x: 220, y: 183, width: 175, height: 84, reveal: 2, tone: 'boundary' },
  { id: 'agent', title: 'Research agent', detail: 'Plans the answer', x: 440, y: 183, width: 155, height: 84, reveal: 3, tone: 'agent' },
  { id: 'tools', title: 'Approved tools', detail: 'Only what is allowed', x: 670, y: 90, width: 140, height: 82, reveal: 4, tone: 'tool' },
  { id: 'memory', title: 'Memory', detail: 'Workspace context', detailLines: ['Workspace', 'context'], x: 670, y: 280, width: 140, height: 82, reveal: 5, tone: 'context' },
  { id: 'answer', title: 'Answer', detail: 'With sources', x: 850, y: 183, width: 120, height: 84, reveal: 7, tone: 'answer' },
]

const wideFlowEdges: FlowEdgeData[] = [
  { id: 'request-boundary', path: 'M175 225 H212', reveal: 2 },
  { id: 'boundary-agent', path: 'M395 225 H432', reveal: 3 },
  { id: 'agent-tools', path: 'M595 225 C630 225 632 131 662 131', reveal: 4 },
  { id: 'agent-context', path: 'M595 225 C630 225 632 321 662 321', reveal: 5 },
  { id: 'tools-answer', path: 'M810 131 C835 131 830 208 842 208', reveal: 6 },
  { id: 'context-answer', path: 'M810 321 C835 321 830 242 842 242', reveal: 6 },
]

const narrowFlowNodes: FlowNodeData[] = [
  { id: 'request', title: 'Request', detail: 'The question', x: 30, y: 22, width: 300, height: 74, reveal: 1, tone: 'source' },
  { id: 'boundary', title: 'Access boundary', detail: 'Identity and thread scope', x: 30, y: 132, width: 300, height: 80, reveal: 2, tone: 'boundary' },
  { id: 'agent', title: 'Research agent', detail: 'Plans the answer', x: 30, y: 245, width: 300, height: 80, reveal: 3, tone: 'agent' },
  { id: 'tools', title: 'Approved tools', detail: 'Only what is allowed', x: 20, y: 405, width: 150, height: 88, reveal: 4, tone: 'tool' },
  { id: 'memory', title: 'Memory', detail: 'Workspace context', detailLines: ['Workspace', 'context'], x: 190, y: 405, width: 150, height: 88, reveal: 5, tone: 'context' },
  { id: 'answer', title: 'Answer', detail: 'With sources', x: 45, y: 575, width: 270, height: 78, reveal: 7, tone: 'answer' },
]

const narrowFlowEdges: FlowEdgeData[] = [
  { id: 'request-boundary', path: 'M180 96 V124', reveal: 2 },
  { id: 'boundary-agent', path: 'M180 212 V237', reveal: 3 },
  { id: 'agent-tools', path: 'M180 325 C180 355 95 360 95 397', reveal: 4 },
  { id: 'agent-context', path: 'M180 325 C180 355 265 360 265 397', reveal: 5 },
  { id: 'tools-answer', path: 'M95 493 C95 535 145 535 145 567', reveal: 6 },
  { id: 'context-answer', path: 'M265 493 C265 535 215 535 215 567', reveal: 6 },
]

function FlowMap({ phase, narrow }: { phase: number; narrow: boolean }) {
  const nodes = narrow ? narrowFlowNodes : wideFlowNodes
  const edges = narrow ? narrowFlowEdges : wideFlowEdges
  const titleId = narrow ? 'flow-map-narrow-title' : 'flow-map-wide-title'
  const descriptionId = narrow ? 'flow-map-narrow-description' : 'flow-map-wide-description'
  const markerId = narrow ? 'flow-arrow-narrow' : 'flow-arrow-wide'

  return <svg
    className={`flow-diagram ${narrow ? 'flow-diagram--narrow' : 'flow-diagram--wide'}`}
    viewBox={narrow ? '0 0 360 680' : '0 0 1000 430'}
    role="img"
    aria-labelledby={`${titleId} ${descriptionId}`}
  >
    <title id={titleId}>How a request becomes an answer</title>
    <desc id={descriptionId}>A request passes an access boundary, reaches a research agent, gathers approved tool and workspace context, then becomes an answer.</desc>
    <defs>
      <marker id={markerId} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8 Z" className="flow-arrowhead" />
      </marker>
    </defs>
    {narrow ? <>
      <rect className="flow-zone" x="12" y="388" width="336" height="124" rx="18" />
      <text className="flow-zone-label" x="180" y="380" textAnchor="middle" opacity={phase >= 4 ? 1 : 0}>APPROVED CONTEXT</text>
    </> : <>
      <rect className="flow-zone" x="650" y="54" width="182" height="344" rx="18" />
      <text className="flow-zone-label" x="741" y="45" textAnchor="middle" opacity={phase >= 4 ? 1 : 0}>APPROVED CONTEXT</text>
    </>}
    {edges.map(edge => <path
      key={edge.id}
      d={edge.path}
      className="flow-edge"
      markerEnd={`url(#${markerId})`}
      opacity={phase >= edge.reveal ? 1 : 0}
    />)}
    {nodes.map(node => <g
      key={node.id}
      transform={`translate(${node.x} ${node.y})`}
      className={`flow-node flow-node--${node.tone} ${phase >= node.reveal ? 'is-revealed' : ''}`}
    >
      <rect width={node.width} height={node.height} rx="14" />
      <text className="flow-node-title" x="14" y={narrow ? 31 : 33}>{node.title}</text>
      {node.detailLines ? <text className="flow-node-detail" x="14" y={narrow ? 53 : 57}>
        <tspan x="14" dy="0">{node.detailLines[0]}</tspan>
        <tspan x="14" dy="16">{node.detailLines[1]}</tspan>
      </text> : <text className="flow-node-detail" x="14" y={narrow ? 53 : 57}>{node.detail}</text>}
    </g>)}
  </svg>
}

const timelineEvents = [
  { time: '09:41:12', title: 'Request accepted', detail: 'The thread stayed responsive while the task began.', kind: 'normal' },
  { time: '09:42:04', title: 'Source lookup stalled', detail: 'The first response exceeded its time budget.', kind: 'cause', note: 'Source timeout' },
  { time: '09:44:51', title: 'Bounded retry waited', detail: 'Backoff prevented a rapid duplicate request.', kind: 'effect', note: 'Retry with backoff' },
  { time: '09:47:24', title: 'Answer delivered', detail: 'The request completed after the source recovered.', kind: 'resolved' },
]

function DeliveryTimeline() {
  return <section className="timeline-scene" aria-labelledby="timeline-title">
    <p className="scene-lead">The delay came from one slow source read, followed by a bounded retry. Queue depth was not the cause.</p>
    <div className="timeline-intro">
      <div>
        <p className="section-label">Delivery review</p>
        <h2 id="timeline-title">One turn, four moments</h2>
      </div>
      <p className="timeline-range"><time>09:41:12</time><span aria-hidden="true">to</span><time>09:47:24</time></p>
    </div>
    <div className="timeline-events" aria-label="Illustrative incident timeline">
      {timelineEvents.map(event => <article className={`timeline-event timeline-event--${event.kind}`} key={event.time}>
        <time className="timeline-time">{event.time}</time>
        <span className="timeline-marker" aria-hidden="true" />
        <div className="timeline-copy"><h3>{event.title}</h3><p>{event.detail}</p></div>
        {event.note && <div className="timeline-annotation"><ArrowRight size={14} aria-hidden="true" /><span>{event.note}</span></div>}
      </article>)}
    </div>
    <div className="impact-band">
      <span className="impact-label">User impact</span>
      <p>One answer was delayed by <strong>6 minutes 12 seconds</strong>. No duplicate was delivered.</p>
    </div>
    <div className="timeline-conclusion">
      <span>Conclusion</span>
      <p>Keep the retry bound, but shorten the source timeout or return a useful partial answer while it recovers.</p>
    </div>
    <p className="scene-footnote">Illustrative event data for this design preview.</p>
  </section>
}

const comparisonRows = [
  { label: 'Delivery guarantee', queued: 'Recoverable after interruption', direct: 'Best effort for this turn' },
  { label: 'Ordering', queued: 'Per-thread order is preserved', direct: 'Arrival order can vary' },
  { label: 'Time to first response', queued: 'Small queue wait is possible', direct: 'Usually the shortest path' },
  { label: 'Good fit', queued: 'Retry-sensitive work', direct: 'Short, latency-sensitive work' },
]

function TradeoffScene() {
  const [priority, setPriority] = React.useState<'reliable' | 'latency'>('reliable')
  const recommendation = priority === 'reliable' ? 'Queue delivery' : 'Direct delivery'

  return <section className="tradeoff-scene" aria-labelledby="tradeoff-title">
    <p className="scene-lead">The trade-off is between recoverable delivery and the shortest path to a response. Choose the constraint that matters most.</p>
    <div className="tradeoff-heading">
      <div>
        <p className="section-label">Decision guide</p>
        <h2 id="tradeoff-title">Two paths, the same criteria</h2>
      </div>
      <div className="priority-control" role="group" aria-label="Choose the decision priority">
        <Button variant={priority === 'reliable' ? 'secondary' : 'outline'} size="sm" aria-pressed={priority === 'reliable'} onClick={() => setPriority('reliable')}>Reliable delivery</Button>
        <Button variant={priority === 'latency' ? 'secondary' : 'outline'} size="sm" aria-pressed={priority === 'latency'} onClick={() => setPriority('latency')}>Lowest latency</Button>
      </div>
    </div>
    <div className={`comparison ${priority === 'latency' ? 'comparison--direct' : ''}`}>
      <div className="comparison-label">Criterion</div>
      <div className={`comparison-column ${priority === 'reliable' ? 'is-recommended' : ''}`}>
        <div className="comparison-title"><span>Queue</span>{priority === 'reliable' && <span className="recommendation-mark">Recommended</span>}</div>
      </div>
      <div className={`comparison-column ${priority === 'latency' ? 'is-recommended' : ''}`}>
        <div className="comparison-title"><span>Direct</span>{priority === 'latency' && <span className="recommendation-mark">Recommended</span>}</div>
      </div>
      {comparisonRows.map(row => <React.Fragment key={row.label}>
        <div className="comparison-label comparison-cell">{row.label}</div>
        <div className={`comparison-cell ${priority === 'reliable' ? 'is-recommended' : ''}`}>{row.queued}</div>
        <div className={`comparison-cell ${priority === 'latency' ? 'is-recommended' : ''}`}>{row.direct}</div>
      </React.Fragment>)}
    </div>
    <div className="recommendation-line" aria-live="polite">
      <ShieldCheck size={18} aria-hidden="true" />
      <p><strong>{recommendation}</strong><span>{priority === 'reliable' ? 'Choose this when retries and ordering matter more than a small queue wait.' : 'Choose this when the fastest first response matters more than recovery guarantees.'}</span></p>
    </div>
    <p className="scene-footnote">The selection changes emphasis only. This comparison does not configure a delivery system.</p>
  </section>
}

function RetryDiagram() {
  return <section className="retry-scene" aria-labelledby="retry-title">
    <p className="scene-lead">Retries stay bounded. Each failure waits longer, and the final failure takes a separate dead-letter exit instead of looping forever.</p>
    <div className="retry-heading">
      <div><p className="section-label">Retry path</p><h2 id="retry-title">Three attempts, then a clear exit</h2></div>
      <span className="retry-cap"><span aria-hidden="true" />Maximum 3 attempts</span>
    </div>
    <svg className="retry-diagram retry-diagram--wide" viewBox="0 0 1000 390" role="img" aria-labelledby="retry-wide-title retry-wide-desc">
      <title id="retry-wide-title">Bounded retry path</title>
      <desc id="retry-wide-desc">A request reaches a worker. Failed attempts wait 250 milliseconds and then one second before retrying. After the third failure, work exits to a dead-letter queue.</desc>
      <defs><marker id="retry-arrow-wide" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" className="retry-arrowhead" /></marker></defs>
      <text className="retry-lane-label" x="32" y="72">ONE REQUEST</text>
      <rect className="retry-request" x="30" y="112" width="135" height="74" rx="15" />
      <text className="retry-node-title" x="48" y="143">Request</text><text className="retry-node-detail" x="48" y="166">One delivery</text>
      <path className="retry-edge" d="M165 149 H224" markerEnd="url(#retry-arrow-wide)" />
      <path className="retry-track" d="M260 149 H700" />
      <g className="retry-attempt"><circle cx="260" cy="149" r="37" /><text x="260" y="145" textAnchor="middle" className="retry-count">01</text><text x="260" y="207" textAnchor="middle" className="retry-caption">Attempt one</text></g>
      <g className="retry-attempt"><circle cx="480" cy="149" r="37" /><text x="480" y="145" textAnchor="middle" className="retry-count">02</text><text x="480" y="207" textAnchor="middle" className="retry-caption">Attempt two</text></g>
      <g className="retry-attempt"><circle cx="700" cy="149" r="37" /><text x="700" y="145" textAnchor="middle" className="retry-count">03</text><text x="700" y="207" textAnchor="middle" className="retry-caption">Final attempt</text></g>
      <path className="retry-loop" d="M260 186 C260 252 480 252 480 186" markerEnd="url(#retry-arrow-wide)" />
      <text className="retry-delay" x="370" y="274" textAnchor="middle">Wait 250 ms</text>
      <path className="retry-loop retry-loop--second" d="M480 186 C480 314 700 314 700 186" markerEnd="url(#retry-arrow-wide)" />
      <text className="retry-delay" x="590" y="332" textAnchor="middle">Wait 1 s</text>
      <path className="retry-success" d="M737 149 C790 149 790 106 842 106" markerEnd="url(#retry-arrow-wide)" />
      <path className="retry-dead-path" d="M737 149 C790 149 790 266 842 266" markerEnd="url(#retry-arrow-wide)" />
      <rect className="retry-outcome retry-outcome--success" x="850" y="72" width="125" height="82" rx="14" />
      <text className="retry-node-title" x="868" y="102">Delivered</text><text className="retry-node-detail" x="868" y="121"><tspan x="868">Stop on</tspan><tspan x="868" dy="16">success</tspan></text>
      <rect className="retry-outcome retry-outcome--dead" x="850" y="226" width="125" height="82" rx="14" />
      <text className="retry-node-title" x="868" y="256">Dead letter</text><text className="retry-node-detail" x="868" y="275"><tspan x="868">Review</tspan><tspan x="868" dy="16">separately</tspan></text>
      <line className="retry-time-line" x1="30" y1="350" x2="970" y2="350" />
      <text className="retry-time" x="30" y="374">0 ms</text><text className="retry-time" x="370" y="374" textAnchor="middle">250 ms backoff</text><text className="retry-time" x="700" y="374" textAnchor="middle">1 s backoff</text><text className="retry-time" x="970" y="374" textAnchor="end">Then exit</text>
    </svg>
    <svg className="retry-diagram retry-diagram--narrow" viewBox="0 0 360 755" role="img" aria-labelledby="retry-narrow-title retry-narrow-desc">
      <title id="retry-narrow-title">Bounded retry path</title>
      <desc id="retry-narrow-desc">A request reaches a worker. Failed attempts wait 250 milliseconds and then one second before retrying. After the third failure, work exits to a dead-letter queue.</desc>
      <defs><marker id="retry-arrow-narrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" className="retry-arrowhead" /></marker></defs>
      <rect className="retry-request" x="48" y="20" width="264" height="72" rx="15" />
      <text className="retry-node-title" x="70" y="51">Request</text><text className="retry-node-detail" x="70" y="74">One delivery</text>
      <path className="retry-edge" d="M180 92 V124" markerEnd="url(#retry-arrow-narrow)" />
      <g className="retry-attempt"><circle cx="180" cy="160" r="34" /><text x="180" y="156" textAnchor="middle" className="retry-count">01</text><text x="180" y="212" textAnchor="middle" className="retry-caption">Attempt one</text></g>
      <g className="retry-attempt"><circle cx="180" cy="310" r="34" /><text x="180" y="306" textAnchor="middle" className="retry-count">02</text><text x="180" y="362" textAnchor="middle" className="retry-caption">Attempt two</text></g>
      <g className="retry-attempt"><circle cx="180" cy="460" r="34" /><text x="180" y="456" textAnchor="middle" className="retry-count">03</text><text x="180" y="512" textAnchor="middle" className="retry-caption">Final attempt</text></g>
      <path className="retry-loop retry-loop--narrow" d="M145 160 C54 160 54 310 145 310" markerEnd="url(#retry-arrow-narrow)" />
      <text className="retry-delay" x="15" y="335">Wait 250 ms</text>
      <path className="retry-loop retry-loop--narrow retry-loop--second" d="M215 310 C306 310 306 460 215 460" markerEnd="url(#retry-arrow-narrow)" />
      <text className="retry-delay" x="218" y="390">Wait 1 s</text>
      <path className="retry-final-stem" d="M180 494 V496 M180 530 V540" />
      <path className="retry-success" d="M180 540 C148 548 112 554 96 571" markerEnd="url(#retry-arrow-narrow)" />
      <path className="retry-dead-path" d="M180 540 C212 548 248 554 264 571" markerEnd="url(#retry-arrow-narrow)" />
      <rect className="retry-outcome retry-outcome--success" x="18" y="578" width="152" height="82" rx="14" />
      <text className="retry-node-title" x="34" y="608">Delivered</text><text className="retry-node-detail" x="34" y="627"><tspan x="34">Stop on</tspan><tspan x="34" dy="16">success</tspan></text>
      <rect className="retry-outcome retry-outcome--dead" x="190" y="578" width="152" height="82" rx="14" />
      <text className="retry-node-title" x="204" y="608">Dead letter</text><text className="retry-node-detail" x="204" y="627"><tspan x="204">Review</tspan><tspan x="204" dy="16">separately</tspan></text>
      <line className="retry-time-line" x1="20" y1="692" x2="340" y2="692" />
      <text className="retry-time" x="20" y="718">0 ms</text><text className="retry-time" x="180" y="718" textAnchor="middle">250 ms, then 1 s</text><text className="retry-time" x="340" y="718" textAnchor="end">Exit</text>
    </svg>
    <ol className="visually-hidden">
      <li>Try the request once.</li><li>After failure, wait 250 milliseconds before attempt two.</li><li>After another failure, wait one second before the final attempt.</li><li>Stop after success or route the final failure to the dead-letter queue.</li>
    </ol>
    <p className="retry-summary"><Clock3 size={17} aria-hidden="true" />A success exits immediately. Only a third failure enters the dead-letter path.</p>
    <p className="scene-footnote">Illustrative retry policy. Values and labels are fixed local mockup data.</p>
  </section>
}

function FlowScene({ phase, reducedMotion, failed }: {
  phase: number
  reducedMotion: boolean
  failed: boolean
}) {
  const complete = phase >= flowStages.length
  const stageText = failed
    ? 'Simulated failure. No view was created.'
    : complete ? 'Simulated view complete' : phase === 0 ? 'Preparing simulated view' : `Simulated: ${flowStages[phase - 1] ?? 'Preparing the view'}`

  return <section className="flow-scene" aria-labelledby="flow-title">
    <p className="scene-lead">The question passes a scoped access check before the agent gathers approved information. The answer appears after those steps, not before.</p>
    <div className="flow-heading">
      <div><p className="section-label">Answer path</p><h2 id="flow-title">How a request becomes an answer</h2></div>
      <p className="flow-stage" role="status" aria-live="polite"><span className={complete ? 'stage-dot stage-dot--complete' : 'stage-dot'} />{stageText}</p>
    </div>
    {failed ? <div className="failure-preview" role="alert">
      <div className="failure-mark" aria-hidden="true"><TriangleAlert size={16} /></div>
      <div><h3>Could not display this view</h3><p>No UI was created. Fix the spec and try again, or answer plainly in text.</p><Button className="failure-action" variant="outline" size="sm" disabled>Open source trail</Button></div>
    </div> : <>
      <div className="flow-canvas">
        <FlowMap phase={phase} narrow={false} />
        <FlowMap phase={phase} narrow />
      </div>
      <ol className="visually-hidden" aria-label="Answer path steps">
        <li>The user request enters the conversation.</li>
        <li>The access boundary checks identity and thread scope.</li>
        <li>The Research agent plans the answer.</li>
        <li>Only approved tools are used.</li>
        <li>Relevant workspace context is gathered.</li>
        <li>Results are brought together.</li>
        <li>The answer is assembled with sources.</li>
      </ol>
      <div className="flow-controls" aria-label="Simulated diagram controls">
        <p>{reducedMotion && !complete ? 'Reduced motion is on. Use Step to reveal the path.' : complete ? 'The simulated answer is ready after the full path.' : `Step ${phase} of ${flowStages.length}: ${stageText}`}</p>
        <Button variant="outline" size="sm" disabled={!complete} onClick={() => toast('Design preview only', { description: 'This example has no live source trail or harness connection.' })}>Open source trail</Button>
      </div>
    </>}
    <p className="scene-after">The final answer can explain what happened without exposing hidden prompts or private tool input. The path above is a visual design proposal, not a live execution trace.</p>
  </section>
}

function statusIcon() {
  return <Check size={13} />
}

function App() {
  const [sceneId, setSceneId] = React.useState<SceneId>('flow')
  const [expanded, setExpanded] = React.useState(true)
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)
  const [scope, setScope] = React.useState<'personal' | 'workspace'>('workspace')
  const [dark, setDark] = React.useState(true)
  const [phase, setPhase] = React.useState(flowStages.length)
  const [playing, setPlaying] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [reducedMotion, setReducedMotion] = React.useState(false)
  const drawerNavigationRef = React.useRef<HTMLDivElement>(null)
  const drawerWasOpenRef = React.useRef(false)
  const activeScene = scenes.find(scene => scene.id === sceneId) ?? scenes[0]!

  React.useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  React.useEffect(() => {
    if (!sidebarOpen) {
      if (drawerWasOpenRef.current) document.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.focus()
      drawerWasOpenRef.current = false
      return
    }

    drawerWasOpenRef.current = true
    drawerNavigationRef.current?.querySelector<HTMLButtonElement>('[data-drawer-close]')?.focus()

    function trapDrawerFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSidebarOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const navigation = drawerNavigationRef.current
      if (!navigation) return
      const focusable = Array.from(navigation.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => element.getClientRects().length > 0)
      if (!focusable.length) {
        event.preventDefault()
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const activeElement = document.activeElement
      if (event.shiftKey && (activeElement === first || !navigation.contains(activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (activeElement === last || !navigation.contains(activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    function containDrawerFocus(event: FocusEvent) {
      const navigation = drawerNavigationRef.current
      if (navigation && !navigation.contains(event.target as Node)) navigation.querySelector<HTMLButtonElement>('[data-drawer-close]')?.focus()
    }

    document.addEventListener('keydown', trapDrawerFocus)
    document.addEventListener('focusin', containDrawerFocus)
    return () => {
      document.removeEventListener('keydown', trapDrawerFocus)
      document.removeEventListener('focusin', containDrawerFocus)
    }
  }, [sidebarOpen])

  React.useEffect(() => {
    if (reducedMotion) setPlaying(false)
  }, [reducedMotion])

  React.useEffect(() => {
    if (sceneId !== 'flow' || !playing || reducedMotion || failed || phase >= flowStages.length) return
    const timer = window.setTimeout(() => {
      setPhase(current => Math.min(current + 1, flowStages.length))
    }, 1550)
    return () => window.clearTimeout(timer)
  }, [sceneId, playing, reducedMotion, failed, phase])

  React.useEffect(() => {
    if (phase >= flowStages.length) setPlaying(false)
  }, [phase])

  function openScene(id: SceneId) {
    setSceneId(id)
    setSidebarOpen(false)
    setFailed(false)
    setPhase(flowStages.length)
    setPlaying(false)
    setDraft('')
  }

  function replay() {
    setFailed(false)
    setPhase(0)
    setPlaying(!reducedMotion)
  }

  function step() {
    setPlaying(false)
    setPhase(current => Math.min(current + 1, flowStages.length))
  }

  function toggleFailure() {
    setFailed(current => !current)
    setPlaying(false)
  }

  function submitDraft() {
    if (!draft.trim()) return
    toast('Design preview only', { description: 'This composer is not connected to a conversation.' })
    setDraft('')
  }

  function toggleSidebar() {
    if (window.innerWidth < 768) {
      setCollapsed(false)
      setSidebarOpen(current => !current)
    } else {
      setCollapsed(current => !current)
    }
  }

  const threadScenes = [...scenes]

  return <>
    <div className="preview-bar">
      <div className="preview-title"><strong>Design preview</strong><span>· simulated streaming</span></div>
      <div className="preview-actions">
        {sceneId === 'flow' && <>
          <Button variant="ghost" size="sm" aria-label="Replay simulated diagram" title="Replay" onClick={replay}><RotateCcw size={14} /><span>Replay</span></Button>
          <Button variant="ghost" size="sm" aria-label={playing ? 'Pause simulated diagram' : 'Resume simulated diagram'} title={playing ? 'Pause' : 'Resume'} disabled={failed || phase >= flowStages.length} onClick={() => setPlaying(current => !current)}>{playing ? <Pause size={14} /> : <Play size={14} />}<span>{playing ? 'Pause' : 'Resume'}</span></Button>
          <Button variant="ghost" size="sm" aria-label="Advance diagram one step" title="Step" disabled={failed || phase >= flowStages.length} onClick={step}><ArrowRight size={14} /><span>Step</span></Button>
          <Button variant="ghost" size="sm" aria-pressed={failed} aria-label={failed ? 'Hide failure preview' : 'Preview honest failure state'} title="Failure preview" onClick={toggleFailure}><TriangleAlert size={14} /><span>{failed ? 'Hide failure' : 'Failure preview'}</span></Button>
        </>}
        <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" title="Toggle theme" onClick={() => setDark(current => !current)}><Sun size={15} /></Button>
      </div>
    </div>
    <div data-app-shell className={`shell${sidebarOpen ? ' sidebar-open' : ''}`}>
      <div
        ref={drawerNavigationRef}
        id="workspace-navigation"
        className="workspace-navigation"
        role={sidebarOpen ? 'dialog' : undefined}
        aria-modal={sidebarOpen || undefined}
        aria-label={sidebarOpen ? 'Workspace navigation' : undefined}
      >
        <DoubleSidebar
          brand={<OverlayMark size={24} />}
          railBrand={<OverlayMark size={24} />}
          title="Agents"
          themePreset={dark ? 'default-dark' : 'default-light'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          resizable
          keyboardShortcut
          panelKind="agents"
          scope={scope}
          panelNav={{
            activeId: scope,
            activeChildId: `${scope}:agents`,
            onSelect: id => { if (id === 'personal' || id === 'workspace') setScope(id) },
            items: [
              { id: 'personal', label: 'Personal', children: [] },
              { id: 'workspace', label: 'Workspace', children: [{ id: 'workspace:agents', label: 'Agents', icon: Bot }] },
            ],
          }}
          onSearch={() => toast('Search is not connected in this preview')}
          panelAction={{ label: 'New agent', onClick: () => toast('Agent creation is not part of this design preview') }}
          items={[
            { id: 'work', label: 'Work', icon: ListChecks, onSelect: () => toast('Work navigation is unchanged') },
            { id: 'agents', label: 'Agents', icon: Bot, active: true, onSelect: () => undefined },
            { id: 'chats', label: 'Chats', icon: MessageSquare, onSelect: () => toast('Chats navigation is unchanged') },
            { id: 'files', label: 'Files', icon: Folder, onSelect: () => toast('Files navigation is unchanged') },
            { id: 'automations', label: 'Automations', icon: Workflow, onSelect: () => toast('Automations navigation is unchanged') },
          ]}
          footerItems={[
            { id: 'theme', label: 'Toggle theme', icon: Sun, onSelect: () => setDark(current => !current) },
            { id: 'help', label: 'Help', icon: CircleHelp, onSelect: () => toast('Design preview', { description: 'Choose a thread to explore a different answer format.' }) },
            { id: 'settings', label: 'Settings', icon: Settings, onSelect: () => toast('Settings are unchanged') },
          ]}
          account={<Button variant="ghost" size="icon" className="account-avatar" aria-label="Workspace and account">RD</Button>}
        >
          <div className="agent-row">
            <Button variant="ghost" className="agent-name" onClick={() => openScene('flow')}>
              <Avatar className="research-avatar"><AvatarFallback>R</AvatarFallback></Avatar>
              <span>Research<span className="agent-summary">4 visual answers</span></span>
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="New Research thread" title="New thread" onClick={() => toast('New thread is not part of this preview')}><Plus size={15} /></Button>
            <Button variant="ghost" size="icon-xs" aria-label={expanded ? 'Collapse Research threads' : 'Expand Research threads'} onClick={() => setExpanded(current => !current)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</Button>
          </div>
          {expanded && <SidebarMenu className="agent-thread-tree" aria-label="Research threads">
            {threadScenes.map(scene => <SidebarMenuSubItem key={scene.id}>
              <SidebarMenuSubButton
                className="expressive-thread"
                isActive={sceneId === scene.id}
                aria-current={sceneId === scene.id ? 'page' : undefined}
                aria-label={`${scene.title}, ${scene.status}`}
                onClick={() => openScene(scene.id)}
              >
                <span className="thread-status" aria-hidden="true">{statusIcon()}</span>
                <span className="thread-title">{scene.title}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>)}
          </SidebarMenu>}
          <div className="other-agent"><div className="mini-creature" aria-hidden="true"><span /><span /></div><span>Scout<span className="agent-summary">Ready</span></span></div>
        </DoubleSidebar>
        <Button data-drawer-close className="mobile-sidebar-close" variant="ghost" size="icon-sm" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={16} /></Button>
      </div>
      <main className="main app-main">
        <header className="header" data-slot="app-screen-header">
          <Button data-sidebar-toggle variant="ghost" size="icon-sm" aria-label="Toggle sidebar" aria-controls="workspace-navigation" onClick={toggleSidebar}><PanelLeft size={16} /></Button>
          <span className="crumb">{scope === 'workspace' ? 'Workspace' : 'Personal'}</span><ChevronRight size={13} />
          <span className="crumb">Agents</span><ChevronRight size={13} /><Bot size={17} aria-hidden="true" />
          <span className="breadcrumb-agent">Research</span><ChevronRight size={13} />
          <span className="breadcrumb-title">{activeScene.title}</span>
          <span className="grow" />
          <Button variant="ghost" size="icon-sm" aria-label="Thread members" title="Thread members" onClick={() => toast('Thread membership is unchanged')}><Users size={16} /></Button>
        </header>
        <section className="thread-surface" aria-label={`${activeScene.title} conversation`}>
          <div className="transcript">
            <div className="transcript-inner">
              <div className="conversation-heading">
                <h1>{activeScene.title}</h1>
                <div className="heading-meta"><span><Check size={13} aria-hidden="true" /> Completed</span><span className="meta-separator" aria-hidden="true">·</span><span>Research agent</span></div>
              </div>
              <div className="user-message">{activeScene.question}</div>
              <div className="assistant-label"><OverlayMark size={20} /><strong>Research</strong><span className="assistant-role">Assistant</span></div>
              {sceneId === 'flow' && <FlowScene
                phase={phase}
                reducedMotion={reducedMotion}
                failed={failed}
              />}
              {sceneId === 'timeline' && <DeliveryTimeline />}
              {sceneId === 'tradeoffs' && <TradeoffScene />}
              {sceneId === 'retries' && <RetryDiagram />}
            </div>
          </div>
          <div className="composer-wrap">
            <div className="composer">
              <Textarea
                className="composer-input"
                rows={1}
                aria-label="Ask a follow-up question"
                placeholder="Ask a follow-up"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitDraft() } }}
              />
              <div className="composer-actions"><span>This is a design preview. No message will be sent.</span><Button variant="primary" size="icon-sm" aria-label="Send follow-up" disabled={!draft.trim()} onClick={submitDraft}><Send size={15} /></Button></div>
            </div>
          </div>
        </section>
      </main>
    </div>
    <Toaster position="top-center" />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
