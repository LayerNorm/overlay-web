import { z } from 'zod'
import { adapterOptionsSchema, type AdapterOptions } from '@layernorm/overlay-agent-bridge-protocol'

const namedValue = z.object({ value: z.string(), name: z.string(), description: z.string().nullish() })
const configSelect = z.object({
  type: z.literal('select'), id: z.string(), name: z.string(), category: z.string().nullish(),
  currentValue: z.string(),
  options: z.array(z.union([namedValue, z.object({ group: z.string(), name: z.string(), options: z.array(namedValue) })])),
})
const legacyMode = z.object({ id: z.string(), name: z.string(), description: z.string().nullish() })
const legacyModel = z.object({ modelId: z.string(), name: z.string(), description: z.string().nullish() })
const responseSchema = z.object({
  configOptions: z.array(z.unknown()).nullish(),
  modes: z.object({ currentModeId: z.string(), availableModes: z.array(legacyMode) }).nullish(),
  models: z.object({ currentModelId: z.string(), availableModels: z.array(legacyModel) }).nullish(),
})

/** Vendor session responses are parsed here; unknown future option kinds cannot become selectable values. */
export function parseAgentOptions(response: unknown, discoveredAt = Date.now()): AdapterOptions {
  const session = responseSchema.parse(response)
  const options: AdapterOptions = { discoveredAt }
  for (const candidate of session.configOptions ?? []) {
    const parsed = configSelect.safeParse(candidate)
    if (!parsed.success) continue
    const config = parsed.data
    const category = config.category ?? config.id
    const key = category === 'model' || config.id === 'model' ? 'model' : category === 'mode' || config.id === 'mode' ? 'mode'
      : ['thought_level', 'effort', 'reasoning_effort'].includes(category)
        || ['effort', 'reasoning_effort'].includes(config.id) ? 'effort' : undefined
    if (!key || options[key]) continue
    const values = config.options.flatMap(option => 'options' in option ? option.options : [option])
      .map(value => ({ id: value.value, label: value.name, ...(value.description ? { description: value.description } : {}) }))
    if (values.length) options[key] = { configId: config.id, currentValue: config.currentValue,
      values: [...new Map(values.map(value => [value.id, value])).values()] }
  }
  if (!options.model && session.models?.availableModels.length) options.model = {
    currentValue: session.models.currentModelId,
    values: session.models.availableModels.map(model => ({ id: model.modelId, label: model.name, ...(model.description ? { description: model.description } : {}) })),
  }
  if (!options.mode && session.modes?.availableModes.length) options.mode = {
    currentValue: session.modes.currentModeId,
    values: session.modes.availableModes.map(mode => ({ id: mode.id, label: mode.name, ...(mode.description ? { description: mode.description } : {}) })),
  }
  return adapterOptionsSchema.parse(options)
}
