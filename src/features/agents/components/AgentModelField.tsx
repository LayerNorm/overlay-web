'use client'

import { ListboxSelect } from '@overlay/ui/primitives'
import type { AdapterOptions } from '@layernorm/overlay-agent-bridge-protocol'
import { orderedAgentModels, resolvedAgentModelChoice } from '@/shared/agents/agent-options'
import {
  AGENT_MODEL_CHOICES,
  CODEX_MODEL_CHOICES,
  agentOffersModelChoice,
  codexModelId,
  parseCodexModel,
} from '@/shared/agents/agent-model'
import { FieldLabel } from './InfoTip'

const DEFAULT_VALUE = ''

/**
 * Which model a Claude Code or Codex agent uses on its subscription. Empty is the agent's own default.
 * Codex also takes a reasoning effort, which is part of its model id (`gpt-6-sol[high]`).
 */
export function AgentModelField({ adapterId, model, onChange, disabled, options }: {
  adapterId: string
  model: string
  onChange(model: string): void
  disabled?: boolean
  options?: AdapterOptions
}) {
  if (options) {
    const values = orderedAgentModels(options.model?.values ?? [])
    const choice = resolvedAgentModelChoice(options, model)
    const selected = choice.model || 'default'
    return <div>
      <FieldLabel info={options.model
        ? 'Models reported by this agent. A saved choice that is no longer offered will fail visibly when the agent starts.'
        : 'This agent has not reported model choices. Default uses its own model; a saved choice is shown without assuming support.'}>Model</FieldLabel>
      <ListboxSelect aria-label="Model" value={selected} disabled={disabled}
        options={[
          ...(values.some(value => value.id === 'default') ? [] : [{ value: 'default', label: 'Default · Agent chooses' }]),
          ...values.map(value => ({ value: value.id, label: value.label })),
          ...(choice.model && !values.some(value => value.id === choice.model) ? [{ value: choice.model,
            label: `${choice.model} · ${options.model ? 'No longer offered' : 'Not reported by agent'}` }] : []),
        ]}
        onChange={value => onChange(value === 'default' ? DEFAULT_VALUE : choice.effort ? `${value}[${choice.effort}]` : value)} portal />
    </div>
  }
  if (!agentOffersModelChoice(adapterId)) return null

  if (adapterId === 'claude-code') {
    const choices = AGENT_MODEL_CHOICES['claude-code'] ?? []
    return (
      <div>
        <FieldLabel info="The model Claude Code uses. Default lets Claude Code choose; the others are the models your Claude account offers.">Model</FieldLabel>
        <ListboxSelect
          aria-label="Model"
          value={model || 'default'}
          disabled={disabled}
          options={choices.map((choice) => ({ value: choice.value, label: choice.hint ? `${choice.label} · ${choice.hint}` : choice.label }))}
          onChange={(value) => onChange(value === 'default' ? DEFAULT_VALUE : value)}
          portal
        />
      </div>
    )
  }

  const parsed = parseCodexModel(model)
  const choice = CODEX_MODEL_CHOICES.find((entry) => entry.slug === parsed?.slug)
  return (
    <>
      <div>
        <FieldLabel info="The model Codex uses. Default lets Codex choose.">Model</FieldLabel>
        <ListboxSelect
          aria-label="Model"
          value={choice?.slug ?? DEFAULT_VALUE}
          disabled={disabled}
          options={[
            { value: DEFAULT_VALUE, label: 'Default · Codex picks (recommended)' },
            ...CODEX_MODEL_CHOICES.map((entry) => ({ value: entry.slug, label: entry.label })),
          ]}
          onChange={(slug) => {
            if (!slug) return onChange(DEFAULT_VALUE)
            const next = CODEX_MODEL_CHOICES.find((entry) => entry.slug === slug)
            onChange(codexModelId(slug, next?.defaultEffort ?? 'medium'))
          }}
          portal
        />
      </div>
      {choice ? (
        <div>
          <FieldLabel info="How much the model reasons before answering. Higher is slower and uses more of your plan.">Reasoning</FieldLabel>
          <ListboxSelect
            aria-label="Reasoning"
            value={parsed?.effort ?? choice.defaultEffort}
            disabled={disabled}
            options={choice.efforts.map((effort) => ({ value: effort, label: effort }))}
            onChange={(effort) => onChange(codexModelId(choice.slug, effort))}
            portal
          />
        </div>
      ) : null}
    </>
  )
}
