import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MessageToolPart } from '@overlay/extension-contracts'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'
import { ToolLogoColumn } from './OverlayLogo'

function isToolRunning(part: MessageToolPart): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available'
}

const TOOL_UI_DONE_STATES = new Set(['output-available', 'output-error', 'output-denied', 'input-error'])

export function SingleToolCallRow({
  part,
  connectTop,
  connectBottom,
}: {
  part: MessageToolPart
  connectTop: boolean
  connectBottom: boolean
}) {
  return (
    <div className="w-full px-1 py-0.5">
      <ToolCallRowNested part={part} connectTop={connectTop} connectBottom={connectBottom} />
    </div>
  )
}

function ToolCallRowNested({
  part,
  connectTop,
  connectBottom,
}: {
  part: MessageToolPart
  connectTop: boolean
  connectBottom: boolean
}) {
  const toolDone = TOOL_UI_DONE_STATES.has(part.state)
  const err =
    part.state === 'input-error' || part.state === 'output-error' || part.state === 'output-denied'
  const running = !toolDone && !err
  const input = part.input && typeof part.input === 'object' ? (part.input as Record<string, unknown>) : undefined
  const label = getDescriptiveToolLabel(part.toolName, input)

  return (
    <div className="w-full max-w-[min(100%,36rem)]">
      <div className={`flex items-stretch gap-2.5 py-0.5 text-[13px] leading-snug`}>
        <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
        <span
          className={`min-w-0 ${
            running && !err ? 'tool-line-shimmer' : err ? 'text-red-600' : 'text-[var(--tool-line-label)]'
          }`}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

export function ToolCallsCollapsedGroup({
  tools,
  connectTop,
  connectBottom,
}: {
  tools: MessageToolPart[]
  connectTop: boolean
  connectBottom: boolean
}) {
  const [open, setOpen] = useState(false)
  const n = tools.length
  const anyRunning = tools.some(isToolRunning)
  const anyErr = tools.some(
    (t) => t.state === 'input-error' || t.state === 'output-error' || t.state === 'output-denied',
  )
  const summary = anyErr ? `${n} tools called` : anyRunning ? `${n} tools in progress` : `${n} tools called`

  return (
    <div className="w-full px-1 py-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-auto w-fit max-w-full items-stretch gap-2.5 rounded-md px-0 py-1 text-left text-[13px] leading-snug text-[var(--tool-line-label)] hover:bg-transparent"
      >
        <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className={`min-w-0 ${anyRunning && !anyErr ? 'tool-line-shimmer' : ''}`}>{summary}</span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={`shrink-0 text-[var(--tool-line-chevron)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {tools.map((t, idx) => (
            <ToolCallRowNested
              key={t.id}
              part={t}
              connectTop={idx > 0}
              connectBottom={idx < tools.length - 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
