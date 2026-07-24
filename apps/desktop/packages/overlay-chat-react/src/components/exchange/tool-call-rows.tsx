import type { ToolGroupItem,ToolVisualBlock } from '@overlay/chat-core'
import {
TOOL_UI_DONE_STATES,
isOverlayGatedToolOutput
} from '@overlay/chat-core'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { getDescriptiveToolLabel } from '../../lib/tool-labels'

import { ReasoningBlock } from './reasoning-block'
import { ToolLogoColumn } from './tool-rail'

export function ToolCallRowWithReasoning({
  block,
  variant = 'default',
  connectTop = false,
  connectBottom = false,
}: {
  block: ToolVisualBlock
  variant?: 'default' | 'nested'
  connectTop?: boolean
  connectBottom?: boolean
}) {
  const toolDone = TOOL_UI_DONE_STATES.has(block.state)
  const err = block.state === 'output-error' || block.state === 'output-denied'
  const running = !toolDone && !err
  const label = getDescriptiveToolLabel(block.name, block.toolInput)

  const pad = variant === 'nested' ? 'py-0.5' : 'py-1'

  return (
    <div className="w-full max-w-[min(100%,36rem)]">
      <div className={`flex items-stretch gap-2.5 ${pad} text-[13px] leading-snug`}>
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

export function GatedPaidFeatureCallout({
  block,
  connectTop,
  connectBottom,
}: {
  block: ToolVisualBlock
  connectTop: boolean
  connectBottom: boolean
}) {
  const out = block.toolOutput as { message?: unknown }
  const line =
    typeof out.message === 'string' && out.message.trim() ? out.message.trim() : 'This requires a paid plan.'
  return (
    <div className="w-full px-1 py-0.5">
      <div className="flex w-full max-w-full items-start justify-start gap-2.5">
        <ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />
        <p className="w-fit max-w-[min(100%,22rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
          {line}{' '}
          <a
            href="/pricing"
            className="whitespace-nowrap font-medium text-[var(--foreground)] underline underline-offset-2 hover:opacity-80"
          >
            Upgrade
          </a>
        </p>
      </div>
    </div>
  )
}

export function SingleToolCallRow({
  block,
  connectTop,
  connectBottom,
}: {
  block: ToolVisualBlock
  connectTop: boolean
  connectBottom: boolean
}) {
  return (
    <div className="w-full px-1 py-0.5">
      <ToolCallRowWithReasoning block={block} connectTop={connectTop} connectBottom={connectBottom} />
    </div>
  )
}

export function ToolCallsCollapsedGroup({
  items,
  connectTop,
  connectBottom,
}: {
  items: ToolGroupItem[]
  connectTop: boolean
  connectBottom: boolean
}) {
  const [open, setOpen] = useState(false)
  const tools = items.filter((it): it is ToolVisualBlock => it.kind === 'tool')
  const n = tools.length
  const anyRunning =
    tools.some((t) => !TOOL_UI_DONE_STATES.has(t.state)) ||
    items.some((it) => it.kind === 'reasoning' && it.state !== 'done')
  const anyErr = tools.some((t) => t.state === 'output-error' || t.state === 'output-denied')
  const summary =
    anyErr
      ? `${n} tools called`
      : anyRunning
        ? n === 1 ? '1 tool in progress' : `${n} tools in progress`
        : n === 1 ? '1 tool called' : `${n} tools called`

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
      {open && (
        <div className="mt-2 space-y-2">
          {items.map((it, idx) => {
            const top = idx > 0
            const bot = idx < items.length - 1
            if (it.kind === 'reasoning') {
              return (
                <ReasoningBlock
                  key={`r-${it.key}`}
                  text={it.text}
                  streaming={it.state === 'streaming'}
                  connectTop={top}
                  connectBottom={bot}
                />
              )
            }
            return isOverlayGatedToolOutput(it.toolOutput) ? (
              <GatedPaidFeatureCallout
                key={it.key}
                block={it}
                connectTop={top}
                connectBottom={bot}
              />
            ) : (
              <ToolCallRowWithReasoning
                key={it.key}
                block={it}
                variant="nested"
                connectTop={top}
                connectBottom={bot}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
