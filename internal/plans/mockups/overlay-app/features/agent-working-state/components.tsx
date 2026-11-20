'use client'

// The working line: one orb for the kind of step and a sentence saying what the agent is doing right now, at the
// bottom of a live response, in place of the 24px Overlay mark.
// Orbs adapted from AICSS (https://github.com/kvnkld/aicss, packages/react/src/orbs), MIT licensed. Lattice family
// only: S1 Thinking, S2 Processing, S3 Working, S4 Searching.
import { useEffect, useState } from 'react'
import { TOOL_UI_DONE_STATES, describeToolCall, getDescriptiveToolLabel, redactCommand, type AssistantVisualBlock } from '@overlay/chat-core'
import type { ExchangeLoadingPresentation } from '@overlay/chat-react/transcript'

type OrbKind = 'thinking' | 'asking' | 'tooling' | 'searching'
type Step = { orb: OrbKind; lead: string; rest?: string }

const AGENT_TOOLS = new Set(['ask_agent', 'read_agent_reply', 'post_message'])
const SEARCH_TOOLS = /search|fetch|read|open_url|list|find|grep|browse|screenshot/

function stringInput(block: Extract<AssistantVisualBlock, { kind: 'tool' }>, key: string) {
  const value = block.toolInput?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** What the agent is doing now, read from the live response's last step. */
export function currentStep(blocks: readonly AssistantVisualBlock[]): Step {
  const running = [...blocks].reverse().find((block): block is Extract<AssistantVisualBlock, { kind: 'tool' }> =>
    block.kind === 'tool' && !TOOL_UI_DONE_STATES.has(block.state))
  if (running) {
    if (running.name === 'ask_agent') {
      const agent = stringInput(running, 'agent')
      const ask = stringInput(running, 'message')
      return { orb: 'asking', lead: agent ? `Asking ${agent}` : 'Asking an agent', rest: ask ? clip(ask.replace(/\s+/g, ' '), 64) : undefined }
    }
    if (running.name === 'read_agent_reply') return { orb: 'asking', lead: 'Waiting for the reply' }
    if (running.name === 'list_agents') return { orb: 'searching', lead: 'Looking up agents', rest: 'in this workspace' }
    const orb: OrbKind = AGENT_TOOLS.has(running.name) ? 'asking' : SEARCH_TOOLS.test(running.name) ? 'searching' : 'tooling'
    // The same words the transcript's tool rows use: "Running python analyze.py", "Opening example.com/pricing".
    const described = describeToolCall(running.name, running.toolInput, undefined, 'running')
    const object = described?.code ? redactCommand(described.code) : described?.target
    if (described?.verb && object) return { orb, lead: `${described.verb} ${clip(object, 72)}` }
    return { orb, lead: getDescriptiveToolLabel(running.name, running.toolInput, 'running') }
  }
  const last = blocks.at(-1)
  if (last?.kind === 'text' && last.text.trim()) return { orb: 'thinking', lead: 'Writing the reply' }
  return { orb: 'thinking', lead: 'Thinking' }
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value)

const CSS = `
.wl-orb { --k:.8571; position:relative; display:inline-block; width:24px; height:24px; flex:none; color:var(--foreground); --rest:.16; }
[data-theme="dark"] .wl-orb { --rest:.22; }
.wl-orb .wl-stage { position:absolute; left:0; top:0; width:28px; height:28px; transform-origin:0 0; transform:scale(var(--k)) translate(6.5px, 6.5px); }
.wl-orb i { position:absolute; left:calc(var(--x) * 6px); top:calc(var(--y) * 6px); width:3px; height:3px; border-radius:50%; background:currentColor; opacity:var(--rest); }
.wl-orb.thinking i { animation:wl-wave 1.7s cubic-bezier(.66,0,.34,1) infinite both; }
.wl-orb.thinking .c { animation-delay:990ms; } .wl-orb.thinking .e { animation-delay:700ms; } .wl-orb.thinking .m { animation-delay:-180ms; }
.wl-orb.asking i { animation:wl-wave 1.7s cubic-bezier(.66,0,.34,1) infinite both; animation-delay:calc((var(--x) + var(--y)) * 200ms); }
.wl-orb.searching i { animation:wl-wave 1.6s cubic-bezier(.66,0,.34,1) infinite both; animation-delay:calc(var(--x) * 260ms); }
.wl-orb.tooling i { animation:wl-comet 1.7s linear infinite both; animation-delay:calc(var(--p) * -212ms); }
.wl-orb.tooling .m { animation:none; }
@keyframes wl-wave { 0% { opacity:var(--rest); transform:scale(1); } 28% { opacity:1; transform:scale(1.18); } 56%,100% { opacity:var(--rest); transform:scale(1); } }
@keyframes wl-comet { 0% { opacity:1; transform:scale(1.15); } 30% { opacity:.45; transform:scale(1); } 60%,100% { opacity:var(--rest); transform:scale(1); } }
@media (prefers-reduced-motion: reduce) { .wl-orb i { animation:none !important; } .wl-orb .m { opacity:1; } }
`

const RING: Record<string, number> = { '0,0': 0, '1,0': 1, '2,0': 2, '2,1': 3, '2,2': 4, '1,2': 5, '0,2': 6, '0,1': 7 }

export function WorkingOrb({ kind }: { kind: OrbKind }) {
  const dots = []
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const cell = x === 1 && y === 1 ? 'm' : (x + y) % 2 === 0 ? 'c' : 'e'
    dots.push(<i key={`${x}${y}`} className={cell} style={{ '--x': x, '--y': y, '--p': RING[`${x},${y}`] ?? 0 } as React.CSSProperties} />)
  }
  return (
    <span className={`wl-orb ${kind}`} aria-hidden>
      <style>{CSS}</style>
      <span className="wl-stage">{dots}</span>
    </span>
  )
}

/** Whole seconds this step has been running. Keyed by the step, so a new step starts again from zero. */
function StepSeconds() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return seconds > 0 ? <span className="shrink-0 tabular-nums text-(--muted-light)">{seconds}s</span> : null
}

/** Replaces `ExchangeLoadingState` at the bottom of a live response. */
export function WorkingLine({ presentation, blocks }: { presentation: ExchangeLoadingPresentation; blocks: readonly AssistantVisualBlock[] }) {
  const step = currentStep(blocks)
  if (!presentation.active || presentation.marker === 'none') return null
  return (
    <div className="flex min-w-0 items-center gap-2 py-1 text-[13px] leading-5 text-(--muted)" role="status" aria-live="polite" data-working-line>
      <WorkingOrb kind={step.orb} />
      <span className="min-w-0 truncate">
        <span className="font-medium text-(--foreground)">{step.lead}</span>
        {step.rest ? <span>: {step.rest}</span> : null}
      </span>
      <StepSeconds key={step.lead} />
    </div>
  )
}
