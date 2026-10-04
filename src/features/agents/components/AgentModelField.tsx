'use client'

import { ListboxSelect } from '@overlay/ui/primitives'
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
export function AgentModelField({ adapterId, model, onChange, disabled }: {
  adapterId: string
  model: string
  onChange(model: string): void
  disabled?: boolean
}) {
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
