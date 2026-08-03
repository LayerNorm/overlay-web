import { BrainCircuit, ImageIcon } from 'lucide-react'

export interface ChatModelIndicatorModel {
  provider?: string
  cost?: number
  supportsVision?: boolean
  supportsReasoning?: boolean
  supportsZeroDataRetention?: boolean
  intelligence?: number
  pricePer1mTokens?: number
  medianOutputTokensPerSecond?: number
}

export function ModelBadges({
  model,
}: {
  model: ChatModelIndicatorModel
}) {
  return (
    <span className="flex h-5 shrink-0 items-center gap-1">
      {model.supportsVision && (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
          <ImageIcon size={10} strokeWidth={1.75} />
        </span>
      )}
      {model.supportsReasoning && (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
          <BrainCircuit size={10} strokeWidth={1.75} />
        </span>
      )}
    </span>
  )
}
