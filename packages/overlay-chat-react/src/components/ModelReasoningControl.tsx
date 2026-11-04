import type { ReasoningLevel } from '@overlay/chat-core'
import { getEffectiveReasoningForModel } from '@overlay/chat-core'
import { ListboxSelect } from '@overlay/ui/primitives'

export type ModelReasoningProps = {
  reasoningByModel?: Readonly<Record<string, ReasoningLevel | undefined>>
  onModelReasoningChange?: (modelId: string, level: ReasoningLevel | undefined) => void
}

type ReasoningModel = {
  id: string
  name: string
  reasoningLevels?: readonly { value: ReasoningLevel; label: string }[]
}

export function modelReasoningLabel(model: ReasoningModel, value?: ReasoningLevel): string {
  if (!model.reasoningLevels?.some((level) => level.value !== 'provider-default')) return 'Provider managed'
  const effective = getEffectiveReasoningForModel(model, value)
  return model.reasoningLevels.find((level) => level.value === effective)?.label ?? 'Default'
}

export function ModelReasoningControl({ model, value, onChange, disabled }: {
  model: ReasoningModel
  value?: ReasoningLevel
  onChange?: (level: ReasoningLevel | undefined) => void
  disabled?: boolean
}) {
  const configurable = model.reasoningLevels?.filter((level) => level.value !== 'provider-default') ?? []
  if (!configurable.length) return (
    <span data-slot="model-reasoning" title="This provider manages reasoning for this model" className="w-14 shrink-0 text-right text-[10px] leading-tight text-(--muted-light)">
      Provider managed
    </span>
  )
  const options = [{ value: 'provider-default' as const, label: 'Default' }, ...configurable]
  const selected = getEffectiveReasoningForModel(model, value) ?? 'provider-default'
  return (
    <span data-slot="model-reasoning" className="w-16 shrink-0" onPointerDown={(event) => event.stopPropagation()}>
      <ListboxSelect
        aria-label={`Reasoning for ${model.name}`}
        value={selected}
        options={options}
        disabled={disabled || !onChange}
        onChange={(level) => onChange?.(level === 'provider-default' ? undefined : level)}
        portal
        className="w-full"
        buttonClassName="h-7 min-h-0 w-full justify-end gap-1 rounded-md border-transparent bg-transparent px-1 py-0 text-[11px] font-normal text-(--muted) shadow-none hover:bg-(--surface-muted) hover:text-(--foreground)"
        menuClassName="min-w-32 rounded-lg"
      />
    </span>
  )
}
