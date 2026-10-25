'use client'

import type { AdapterOptions } from '@layernorm/overlay-agent-bridge-protocol'
import { ListboxSelect } from '@overlay/ui/primitives'
import { FieldLabel } from './InfoTip'
import { AgentModelField } from './AgentModelField'

const MODE_LABELS: Record<string, string> = {
  default: 'Manual', acceptEdits: 'Accept edits', plan: 'Plan', auto: 'Auto',
  dontAsk: 'Do not ask', bypassPermissions: 'Bypass permissions', 'full-access': 'Full access',
}

function selectOptions(control: AdapterOptions['effort'], selected: string, labels: Record<string, string> = {}) {
  return [
    ...(control?.values.map(value => ({ value: value.id, label: labels[value.id] ?? value.label })) ?? []),
    ...(selected && !control?.values.some(value => value.id === selected)
      ? [{ value: selected, label: `${labels[selected] ?? selected} · ${control ? 'No longer offered' : 'Not reported by agent'}` }] : []),
    ...(!selected ? [{ value: '', label: control ? 'Agent default' : 'Not reported' }] : []),
  ]
}

export function AgentRuntimeSettingsFields({ adapterId, model, effort, mode, options, disabled, onModel, onEffort, onMode }: {
  adapterId: string; model: string; effort: string; mode: string; options?: AdapterOptions; disabled: boolean
  onModel(model: string): void; onEffort(effort: string): void; onMode(mode: string): void
}) {
  return <>
    <AgentModelField adapterId={adapterId} model={model} options={options ?? { discoveredAt: 0 }}
      disabled={disabled || !options?.model} onChange={onModel} />
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <FieldLabel info="Reasoning levels reported by this agent. Availability can depend on the selected model.">Reasoning effort</FieldLabel>
        <ListboxSelect aria-label="Reasoning effort" value={effort} disabled={disabled || !options?.effort}
          options={selectOptions(options?.effort, effort)} onChange={value => { if (value) onEffort(value) }} portal />
      </div>
      <div>
        <FieldLabel info="Controls permission prompts for commands and file changes on the agent's machine.">Permissions</FieldLabel>
        <ListboxSelect aria-label="Permissions" value={mode} disabled={disabled || !options?.mode}
          options={selectOptions(options?.mode, mode, MODE_LABELS)} onChange={value => { if (value) onMode(value) }} portal />
      </div>
    </div>
  </>
}
