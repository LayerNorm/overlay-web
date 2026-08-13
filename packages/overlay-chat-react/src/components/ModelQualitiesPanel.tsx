import { BrainCircuit, Check, DollarSign, ShieldCheck, X, Zap } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { ReasoningLevel } from '@overlay/chat-core'
import { ListboxSelect } from '@overlay/ui/primitives'
import type { ChatModelIndicatorModel } from './ModelIndicators'

const PROVIDER_DEFAULT_REASONING: readonly { value: ReasoningLevel; label: string }[] = [
  { value: 'provider-default', label: 'Default' },
]

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3 py-0.5">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
        <Icon size={11} strokeWidth={1.75} className="shrink-0 text-[var(--muted-light)]" />
        <span>{label}</span>
      </div>
      <span className="whitespace-nowrap text-[11px] font-medium tabular-nums text-[var(--foreground)]">
        {value}
      </span>
    </div>
  )
}

export function ModelQualitiesPanel({
  model,
  reasoning,
  onReasoningChange,
}: {
  model: ChatModelIndicatorModel | null | undefined
  reasoning?: ReasoningLevel
  onReasoningChange?: (level: ReasoningLevel | undefined) => void
}) {
  if (!model) return null
  const reasoningLevels = model.supportsReasoning
    ? (model.reasoningLevels ?? PROVIDER_DEFAULT_REASONING).map((level) => ({
        value: level.value as ReasoningLevel,
        label: level.label,
      }))
    : []
  // The reasoning control takes whatever width the label leaves rather than a fixed
  // 8.25rem: the hover panel is w-56 (200px of content), so a shrink-0 control plus
  // the label added up to ~219px and spilled past the panel's right edge.
  const selectedReasoning = reasoning ?? 'provider-default'
  const selectedLevel = reasoningLevels.some(({ value }) => value === selectedReasoning)
    ? selectedReasoning
    : reasoningLevels[0]?.value ?? 'provider-default'

  return (
    <div className="flex flex-col gap-1">
      <MetricRow
        icon={BrainCircuit}
        label="Intelligence"
        value={Math.round(model.intelligence ?? 0)}
      />
      <MetricRow
        icon={DollarSign}
        label="Cost"
        value={model.cost === 0 ? 'Free' : `$${(model.pricePer1mTokens ?? model.cost ?? 0).toFixed(2)}/M`}
      />
      <MetricRow
        icon={Zap}
        label="Speed"
        value={model.medianOutputTokensPerSecond ? `${Math.round(model.medianOutputTokensPerSecond)} t/s` : 'N/A'}
      />
      <MetricRow
        icon={ShieldCheck}
        label="ZDR"
        value={
          <span className="inline-flex items-center gap-1 text-[var(--foreground)]">
            {model.supportsZeroDataRetention ? <Check size={11} strokeWidth={2} /> : <X size={11} strokeWidth={2} />}
          </span>
        }
      />
      {reasoningLevels.length > 0 && onReasoningChange ? (
        <div className="flex min-h-6 min-w-0 items-center justify-between gap-2 py-0.5">
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <BrainCircuit size={11} strokeWidth={1.75} className="shrink-0 text-[var(--muted-light)]" />
            <span>Reasoning</span>
          </div>
          <ListboxSelect
            aria-label="Reasoning effort"
            value={selectedLevel}
            options={reasoningLevels}
            onChange={(next) => onReasoningChange(next === 'provider-default' ? undefined : next)}
            portal
            className="min-w-0 max-w-[8.25rem] flex-1"
            // Reads like the metric values above it — no box, no fill, same
            // 11px foreground text, right-aligned with a small chevron. The
            // border/background come from the ListboxSelect default; override
            // them to transparent so the control blends into the panel.
            buttonClassName="h-6 w-full justify-end gap-1 rounded-md border-transparent bg-transparent px-1 py-0 text-[11px] font-medium text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
            menuClassName="min-w-[8.25rem] rounded-lg py-0.5"
          />
        </div>
      ) : null}
    </div>
  )
}
