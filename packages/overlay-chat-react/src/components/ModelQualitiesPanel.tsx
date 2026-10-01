import { BrainCircuit, Check, DollarSign, Server, ShieldCheck, X, Zap } from 'lucide-react'
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
      <span className="whitespace-nowrap text-[11px] font-normal tabular-nums text-[var(--muted)]">
        {value}
      </span>
    </div>
  )
}

function resolveReasoningLevels(
  model: ChatModelIndicatorModel,
): { value: ReasoningLevel; label: string }[] {
  if (!model.supportsReasoning) return []
  return (model.reasoningLevels ?? PROVIDER_DEFAULT_REASONING).map((level) => ({
    value: level.value as ReasoningLevel,
    label: level.label,
  }))
}

function costLabel(model: ChatModelIndicatorModel): string {
  return model.cost === 0 ? 'Free' : `$${(model.pricePer1mTokens ?? model.cost ?? 0).toFixed(2)}/M`
}

function speedLabel(model: ChatModelIndicatorModel): string {
  return model.medianOutputTokensPerSecond
    ? `${Math.round(model.medianOutputTokensPerSecond)} t/s`
    : 'N/A'
}

function ZdrValue({ supported }: { supported?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {supported ? <Check size={11} strokeWidth={2} /> : <X size={11} strokeWidth={2} />}
    </span>
  )
}

function ReasoningRow({
  levels,
  reasoning,
  onChange,
}: {
  levels: { value: ReasoningLevel; label: string }[]
  reasoning?: ReasoningLevel
  onChange?: (level: ReasoningLevel | undefined) => void
}) {
  if (levels.length === 0 || !onChange) return null
  // The reasoning control takes whatever width the label leaves rather than a fixed
  // 8.25rem: the hover panel is w-56 (200px of content), so a shrink-0 control plus
  // the label added up to ~219px and spilled past the panel's right edge.
  const selectedReasoning = reasoning ?? 'provider-default'
  const selectedLevel = levels.some(({ value }) => value === selectedReasoning)
    ? selectedReasoning
    : levels[0]?.value ?? 'provider-default'

  return (
    <div className="flex min-h-6 min-w-0 items-center justify-between gap-2 py-0.5">
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--muted)]">
        <BrainCircuit size={11} strokeWidth={1.75} className="shrink-0 text-[var(--muted-light)]" />
        <span>Reasoning</span>
      </div>
      <ListboxSelect
        aria-label="Reasoning effort"
        value={selectedLevel}
        options={levels}
        onChange={(next) => onChange(next === 'provider-default' ? undefined : next)}
        portal
        className="min-w-0 max-w-[8.25rem] flex-1"
        // Reads like the metric values above it — no box, no fill, same
        // 11px muted text, right-aligned with a small chevron. The
        // border/background come from the ListboxSelect default; override
        // them to transparent so the control blends into the panel.
        buttonClassName="h-6 min-h-0 w-full justify-end gap-1 rounded-none border-transparent bg-transparent px-0 py-0 text-[11px] font-normal text-[var(--muted)] hover:bg-transparent hover:text-[var(--foreground)]"
        menuClassName="min-w-[8.25rem] rounded-lg py-0.5"
      />
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
  const reasoningLevels = resolveReasoningLevels(model)

  return (
    <div className="flex flex-col gap-1">
      <MetricRow
        icon={BrainCircuit}
        label="Intelligence"
        value={Math.round(model.intelligence ?? 0)}
      />
      <MetricRow
        icon={Server}
        label="Provider"
        value={<span className="block max-w-[6.75rem] truncate">{model.provider ?? 'Unknown'}</span>}
      />
      <MetricRow
        icon={DollarSign}
        label="Cost"
        value={costLabel(model)}
      />
      <MetricRow
        icon={Zap}
        label="Speed"
        value={speedLabel(model)}
      />
      <MetricRow
        icon={ShieldCheck}
        label="ZDR"
        value={<ZdrValue supported={model.supportsZeroDataRetention} />}
      />
      <ReasoningRow levels={reasoningLevels} reasoning={reasoning} onChange={onReasoningChange} />
    </div>
  )
}
