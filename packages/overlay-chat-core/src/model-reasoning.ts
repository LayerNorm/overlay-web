import type { ReasoningLevel } from './types'

export type ReasoningModelCapabilities = {
  id: string
  reasoningLevels?: readonly { value: ReasoningLevel }[]
}

export function getEffectiveReasoningForModel(
  model: Pick<ReasoningModelCapabilities, 'reasoningLevels'> | undefined,
  saved?: ReasoningLevel,
): ReasoningLevel | undefined {
  if (!saved || saved === 'provider-default') return undefined
  return model?.reasoningLevels?.some((option) => option.value === saved) ? saved : undefined
}

export function getEffectiveReasoningByModel(
  models: readonly ReasoningModelCapabilities[],
  saved: Readonly<Record<string, ReasoningLevel | undefined>>,
): Record<string, ReasoningLevel> {
  const modelsById = new Map(models.map((model) => [model.id, model]))
  const effective: Record<string, ReasoningLevel> = {}
  for (const [modelId, level] of Object.entries(saved)) {
    const supported = getEffectiveReasoningForModel(modelsById.get(modelId), level)
    if (supported) effective[modelId] = supported
  }
  return effective
}
