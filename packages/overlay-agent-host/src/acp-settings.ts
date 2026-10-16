import type { ClientContext } from '@agentclientprotocol/sdk'
import { z } from 'zod'
import type { AdapterOptions } from '@layernorm/overlay-agent-bridge-protocol'
import { parseAgentOptions } from './agent-options.js'

export const agentSettingsSchema = z.object({
  model: z.string().trim().min(1).optional(),
  permissionMode: z.string().trim().min(1).optional(),
  effort: z.string().trim().min(1).optional(),
  permissionContext: z.enum(['cloud', 'local']).optional(),
})
export type AgentSettings = z.infer<typeof agentSettingsSchema>

/** Apply choices through the session's own config IDs; legacy agents retain their protocol controls. */
export async function applyAcpSettings(context: ClientContext, sessionId: string, metadata: Record<string, unknown>, initial: AdapterOptions): Promise<AdapterOptions> {
  return applyAgentSettings({
    setConfig: (configId, value) => context.request('session/set_config_option', { sessionId, configId, value }),
    setMode: modeId => context.request('session/set_mode', { sessionId, modeId }),
    setModel: modelId => context.request('session/set_model', { sessionId, modelId }),
  }, metadata, initial)
}

export type AgentSettingControls = {
  setConfig(configId: string, value: string): Promise<unknown>
  setMode(modeId: string): Promise<unknown>
  setModel(modelId: string): Promise<unknown>
}

export async function applyAgentSettings(controls: AgentSettingControls, metadata: Record<string, unknown>, initial: AdapterOptions): Promise<AdapterOptions> {
  const selected = agentSettingsSchema.parse(metadata)
  let options = initial
  const choose = async (kind: 'model' | 'mode' | 'effort', value: string | undefined) => {
    if (!value) return
    const configId = options[kind]?.configId
    if (configId) {
      const response = await controls.setConfig(configId, value)
      options = { ...options, ...parseAgentOptions(response) }
    } else if (kind === 'mode') await controls.setMode(value)
    else if (kind === 'model') await controls.setModel(value)
    else {
      // A missing effort control must fail visibly; never silently run at another effort level.
      const response = await controls.setConfig('reasoning_effort', value)
      options = { ...options, ...parseAgentOptions(response) }
    }
  }
  const composite = selected.model && /^(.+)\[([^\]]+)\]$/.exec(selected.model)
  const splitModel = composite && !options.model?.values.some(value => value.id === selected.model)
    && options.model?.values.some(value => value.id === composite[1]) ? composite : undefined
  await choose('model', splitModel?.[1] ?? selected.model)
  await choose('effort', selected.effort ?? splitModel?.[2])
  const defaults = selected.permissionContext === 'cloud' ? ['auto'] : ['acceptEdits']
  const defaultMode = selected.permissionContext ? defaults.find(id => options.mode?.values.some(value => value.id === id)) : undefined
  await choose('mode', selected.permissionMode ?? defaultMode)
  return options
}
