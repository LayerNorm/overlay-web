import { BrainCircuit, Check, DollarSign, ShieldCheck, X, Zap } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { ReasoningLevel } from '@overlay/chat-core'
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
    <div className="flex items-center justify-between gap-3">
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
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--muted-light)]">Reasoning</span>
          <select
            aria-label="Reasoning effort"
            value={selectedLevel}
            onChange={(event) => {
              const next = event.target.value as ReasoningLevel
              onReasoningChange(next === 'provider-default' ? undefined : next)
            }}
            className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
          >
            {reasoningLevels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}
