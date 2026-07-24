import { BrainCircuit, Check, DollarSign, ShieldCheck, X, Zap } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { ChatModelIndicatorModel } from './ModelIndicators'

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
}: {
  model: ChatModelIndicatorModel | null | undefined
}) {
  if (!model) return null
  return (
    <div className="pointer-events-none flex flex-col gap-1">
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
    </div>
  )
}
