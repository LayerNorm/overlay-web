import { adapterCapabilitySchema, type AdapterOptions } from '@layernorm/overlay-agent-bridge-protocol'
import { CHAT_MODEL_QUALITY_PRIORITY } from '@/shared/ai/gateway/model-data'
import { CODEX_MODEL_CHOICES } from './agent-model'

export function environmentAgentOptions(capabilities: Record<string, unknown>, adapterId: string): AdapterOptions | undefined {
  if (!Array.isArray(capabilities.adapters)) return undefined
  for (const value of capabilities.adapters) {
    const parsed = adapterCapabilitySchema.safeParse(value)
    if (parsed.success && parsed.data.id === adapterId) return parsed.data.options
  }
  return undefined
}

export function defaultAgentPermissionMode(options: AdapterOptions | undefined, cloud: boolean): string {
  const preferred = cloud ? 'auto' : 'acceptEdits'
  return options?.mode?.values.some(value => value.id === preferred)
    ? preferred : options?.mode?.currentValue ?? ''
}

export function agentModeNeedsConfirmation(mode: string): boolean {
  return ['bypassPermissions', 'full-access', 'danger-full-access'].includes(mode)
}

/** Older Codex choices combine model and effort; live catalogs can advertise them separately. */
export function resolvedAgentModelChoice(options: AdapterOptions | undefined, model: string, effort?: string) {
  const combined = /^(.+)\[([^\]]+)\]$/.exec(model)
  const split = combined && !options?.model?.values.some(value => value.id === model)
    && options?.model?.values.some(value => value.id === combined[1])
    && options.effort?.values.some(value => value.id === combined[2]) ? combined : undefined
  return {model: split?.[1] ?? model, effort: effort ?? split?.[2]}
}

/** Default first, then known quality order; new vendor choices retain their relative order. */
export function orderedAgentModels(values: NonNullable<AdapterOptions['model']>['values']) {
  const rank = (value: typeof values[number]) => {
    if (value.id === 'default') return -1
    const codex = CODEX_MODEL_CHOICES.findIndex(choice => value.id === choice.slug)
    if (codex >= 0) return codex
    const family = /opus|sonnet|haiku/i.exec(`${value.id} ${value.label}`)?.[0]?.toLowerCase()
    const index = CHAT_MODEL_QUALITY_PRIORITY.findIndex(id => id === value.id || Boolean(family && id.includes(family)))
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  return values.toSorted((left, right) => rank(left) - rank(right))
}
