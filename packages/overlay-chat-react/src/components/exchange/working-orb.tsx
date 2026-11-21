'use client'

// The working state of a live response: one small dot-lattice orb for the kind of step, on the running tool's row
// or, between tools, on a line at the bottom saying what the agent is doing.
// Orbs adapted from AICSS (https://github.com/kvnkld/aicss, packages/react/src/orbs), MIT licensed. Lattice family
// only: S1 Thinking, S2 Processing, S3 Working, S4 Searching. Styles live in chat-surface.css (`.working-orb`).
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { TOOL_UI_DONE_STATES, describeToolCall, redactCommand, type AssistantVisualBlock, type ToolVisualBlock } from '@overlay/chat-core'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'

export type WorkingOrbKind = 'thinking' | 'asking' | 'tooling' | 'searching'
export type WorkingStep = { orb: WorkingOrbKind; lead: string; rest?: string }

const AGENT_TOOLS = new Set(['ask_agent', 'read_agent_reply', 'post_message'])
const SEARCH_TOOLS = /search|fetch|read|open_url|list|find|grep|browse|screenshot/

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value)

function stringInput(block: ToolVisualBlock, key: string) {
  const value = block.toolInput?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const isRunningTool = (block: AssistantVisualBlock): block is ToolVisualBlock =>
  block.kind === 'tool' && !TOOL_UI_DONE_STATES.has(block.state)

/** The orb for one kind of tool call. */
export function orbForTool(name: string): WorkingOrbKind {
  return AGENT_TOOLS.has(name) ? 'asking' : SEARCH_TOOLS.test(name) ? 'searching' : 'tooling'
}

/** What the agent is doing now, read from the live response's last running tool or last block. */
export function currentWorkingStep(blocks: readonly AssistantVisualBlock[]): WorkingStep {
  const running = [...blocks].reverse().find(isRunningTool)
  if (running) {
    if (running.name === 'ask_agent') {
      const agent = stringInput(running, 'agent')
      const ask = stringInput(running, 'message')
      return { orb: 'asking', lead: agent ? `Asking ${agent}` : 'Asking an agent', rest: ask ? clip(ask.replace(/\s+/g, ' '), 64) : undefined }
    }
    if (running.name === 'read_agent_reply') return { orb: 'asking', lead: 'Waiting for the reply' }
    if (running.name === 'list_agents') return { orb: 'searching', lead: 'Looking up agents', rest: 'in this workspace' }
    const orb = orbForTool(running.name)
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

/** Whether a response has a tool call in progress (its row carries the orb, so the bottom line stays hidden). */
export function hasRunningTool(blocks: readonly AssistantVisualBlock[]): boolean {
  return blocks.some(isRunningTool)
}

/**
 * A running agent tool's row says who is asked and what ("Asking Quill: …") instead of the bare tool name.
 * Returns null for every other tool, which keeps the transcript's own description.
 */
export function RunningAgentToolTitle({ block }: { block: ToolVisualBlock }) {
  if (!AGENT_TOOLS.has(block.name) && block.name !== 'list_agents') return null
  const step = currentWorkingStep([block])
  return (
    <span className="min-w-0 truncate">
      <span className="text-(--foreground)">{step.lead}</span>
      {step.rest ? <span className="text-(--muted)">: {step.rest}</span> : null}
    </span>
  )
}

export const runningToolHasAgentTitle = (block: ToolVisualBlock) => AGENT_TOOLS.has(block.name) || block.name === 'list_agents'

/** Ring position of each outer dot, for the comet that circles the lattice. */
const RING: Record<string, number> = { '0,0': 0, '1,0': 1, '2,0': 2, '2,1': 3, '2,2': 4, '1,2': 5, '0,2': 6, '0,1': 7 }

export function WorkingOrb({ kind, small = false }: { kind: WorkingOrbKind; small?: boolean }) {
  const dots = []
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const cell = x === 1 && y === 1 ? 'm' : (x + y) % 2 === 0 ? 'c' : 'e'
    dots.push(<i key={`${x}${y}`} className={cell} style={{ '--x': x, '--y': y, '--p': RING[`${x},${y}`] ?? 0 } as CSSProperties} />)
  }
  return (
    <span className={`working-orb ${kind}${small ? ' small' : ''}`} aria-hidden data-working-orb={kind}>
      <span className="working-orb-stage">{dots}</span>
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

/** The line at the bottom of a live response between tool calls: "Thinking" or "Writing the reply", and for how long. */
export function WorkingLine({ blocks }: { blocks: readonly AssistantVisualBlock[] }) {
  const step = currentWorkingStep(blocks)
  return (
    <div
      className="flex min-w-0 items-center gap-2 py-1 pr-1 text-[13px] leading-5 text-(--muted)"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-loading-presentation="standalone"
      data-working-line
    >
      {/* The lattice sits 5.5px inside its box; pull it back so its first dots line up with the agent's name. */}
      <span className="-ml-[5.5px] inline-flex">
        <WorkingOrb kind={step.orb} />
      </span>
      <span className="min-w-0 truncate">
        <span className="font-medium text-(--foreground)">{step.lead}</span>
        {step.rest ? <span>: {step.rest}</span> : null}
      </span>
      <StepSeconds key={step.lead} />
    </div>
  )
}
