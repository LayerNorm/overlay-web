import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '@overlay/ui/ai'
import type { ToolGroupItem, ToolVisualBlock } from '@overlay/chat-core'
import {
TOOL_UI_DONE_STATES,
isOverlayGatedToolOutput
} from '@overlay/chat-core'
import { useState } from 'react'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'

import { ReasoningBlock } from './reasoning-block'
import { TraceOrb } from './tool-rail'

export function ToolCallRowWithReasoning({
  block,
  variant = 'default',
}: {
  block: ToolVisualBlock
  variant?: 'default' | 'nested'
  connectTop?: boolean
  connectBottom?: boolean
}) {
  const toolDone = TOOL_UI_DONE_STATES.has(block.state)
  const err = block.state === 'input-error' || block.state === 'output-error' || block.state === 'output-denied'
  const running = !toolDone && !err
  const label = getDescriptiveToolLabel(
    block.name,
    block.toolInput,
    block.state === 'output-denied'
      ? 'denied'
      : block.state === 'output-error' || block.state === 'input-error'
        ? 'error'
        : toolDone
          ? 'complete'
          : 'running',
  )

  return (
    <div className="w-full max-w-[min(100%,36rem)]">
      <TraceLine
        status={running ? 'running' : err ? 'error' : undefined}
        className={`${variant === 'nested' ? 'py-0.5' : 'py-1'} text-[13px] leading-snug`}
      >
        <TraceOrb running={running} />
        <TraceTitle className="whitespace-normal">{label}</TraceTitle>
      </TraceLine>
    </div>
  )
}

const upgradeLink = (
  // Internal nav without Link — this package has no next/ dependency.
  // react-doctor-disable-next-line react-doctor/nextjs-no-a-element
  <a
    href='/pricing'
    className='whitespace-nowrap font-medium text-(--foreground) underline underline-offset-2 hover:opacity-80'
  >
    Upgrade
  </a>
)

export function GatedPaidFeatureCallout({
  block,
}: {
  block: ToolVisualBlock
  connectTop?: boolean
  connectBottom?: boolean
}) {
  const out = block.toolOutput as { message?: unknown }
  const line =
    typeof out.message === 'string' && out.message.trim() ? out.message.trim() : 'This requires a paid plan.'
  return (
    <div className="w-full px-1 py-0.5">
      <div className="flex w-full max-w-full items-start justify-start gap-2 [&>[data-slot=trace-icon]]:mt-1.5">
        <TraceOrb />
        <p className="w-fit max-w-[min(100%,22rem)] rounded-lg bg-(--surface-subtle) px-2.5 py-1.5 text-[11px] leading-relaxed text-(--muted)">
          {line} {upgradeLink}
        </p>
      </div>
    </div>
  )
}

export function SingleToolCallRow({
  block,
}: {
  block: ToolVisualBlock
  connectTop?: boolean
  connectBottom?: boolean
}) {
  return (
    <div className="w-full px-1 py-0.5">
      <ToolCallRowWithReasoning block={block} />
    </div>
  )
}

export function ToolCallsCollapsedGroup({
  items,
}: {
  items: ToolGroupItem[]
  connectTop?: boolean
  connectBottom?: boolean
}) {
  const [open, setOpen] = useState(false)
  const tools = items.filter((it): it is ToolVisualBlock => it.kind === 'tool')
  // Terminal details and their action share a call key; count the action once.
  const n = new Set(tools.map(tool => tool.key)).size
  const running = new Set(tools.filter(tool => !TOOL_UI_DONE_STATES.has(tool.state)).map(tool => tool.key)).size
  const anyRunning =
    running > 0 ||
    items.some((it) => it.kind === 'reasoning' && it.state !== 'done')
  const anyErr = tools.some(
    (t) => t.state === 'input-error' || t.state === 'output-error' || t.state === 'output-denied',
  )
  const summary =
    running > 0
      ? running < n ? `${n} tools · ${running} running`
        : n === 1 ? '1 tool in progress' : `${n} tools in progress`
      : n === 0 && anyRunning ? 'Working' : n === 1 ? '1 tool called' : `${n} tools called`

  return (
    <Trace className="px-1 py-0.5">
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger className="py-1 text-[13px] leading-snug">
          <TraceLine status={anyErr ? 'error' : anyRunning ? 'running' : undefined}>
            <TraceOrb running={anyRunning && !anyErr} />
            <TraceTitle>{summary}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="ml-0 pl-0">
          <Trace className="gap-1">
            {items.map((it) => {
              if (it.kind === 'reasoning') {
                return (
                  <ReasoningBlock
                    key={`r-${it.key}`}
                    text={it.text}
                    streaming={it.state === 'streaming'}
                  />
                )
              }
              return isOverlayGatedToolOutput(it.toolOutput) ? (
                <GatedPaidFeatureCallout key={`${it.name}:${it.key}`} block={it} />
              ) : (
                <ToolCallRowWithReasoning key={`${it.name}:${it.key}`} block={it} variant="nested" />
              )
            })}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
