'use client'

import type { ReactNode } from 'react'
import type {
  AutomationSaveState,
  AutomationSchedule,
  AutomationTestState,
  AutomationTimeZoneOption,
} from '@overlay/app-core'
import { MIN_AUTOMATION_INTERVAL_MINUTES, WEEKDAY_LABELS } from '@overlay/app-core/automations'
import { SettingsCard, SettingsToggle } from '@overlay/modules-react/settings'
import { AutomationGraphCanvas } from './graph-canvas'

export interface AutomationModelOption {
  id: string
  name: string
}

export interface AutomationEditorFormProps {
  name: string
  description: string
  instructions: string
  enabled: boolean
  scheduleKind: AutomationSchedule['kind']
  intervalMinutes: number
  timezone: string
  time: string
  dayOfWeek: number
  dayOfMonth: number
  graphSource: string
  modelId: string
  timeZoneOptions: readonly AutomationTimeZoneOption[]
  modelOptions: readonly AutomationModelOption[]
  saveState: AutomationSaveState
  testState: AutomationTestState
  testMessage?: string | null
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onInstructionsChange: (value: string) => void
  onEnabledChange: (value: boolean) => void
  onScheduleKindChange: (value: AutomationSchedule['kind']) => void
  onIntervalMinutesChange: (value: number) => void
  onTimezoneChange: (value: string) => void
  onTimeChange: (value: string) => void
  onDayOfWeekChange: (value: number) => void
  onDayOfMonthChange: (value: number) => void
  onGraphSourceChange?: (value: string) => void
  onModelIdChange: (value: string) => void
  onSave: () => void
  onTest: () => void
  renderInstructionsEditor: (props: { value: string; onChange: (value: string) => void }) => ReactNode
}

export function AutomationEditorForm({
  name,
  description,
  instructions,
  enabled,
  scheduleKind,
  intervalMinutes,
  timezone,
  time,
  dayOfWeek,
  dayOfMonth,
  graphSource,
  modelId,
  timeZoneOptions,
  modelOptions,
  saveState,
  testState,
  testMessage,
  onNameChange,
  onDescriptionChange,
  onInstructionsChange,
  onEnabledChange,
  onScheduleKindChange,
  onIntervalMinutesChange,
  onTimezoneChange,
  onTimeChange,
  onDayOfWeekChange,
  onDayOfMonthChange,
  onModelIdChange,
  onSave,
  onTest,
  renderInstructionsEditor,
}: AutomationEditorFormProps) {
  const scheduleKindOptions: readonly { value: AutomationSchedule['kind']; label: string }[] = [
    { value: 'interval', label: 'Interval' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">Automation editor</p>
            <p className="text-xs text-[var(--muted)]">Configure and test this automation.</p>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={saveState === 'saving' || !name.trim() || !instructions.trim()}
            className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : 'Save changes'}
          </button>
        </div>

        <SettingsCard title="Configuration">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Name
                <input
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                />
              </label>
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Description
                <input
                  value={description}
                  onChange={(event) => onDescriptionChange(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Enabled</p>
                <p className="text-xs text-[var(--muted)]">Run this automation on its schedule.</p>
              </div>
              <SettingsToggle checked={enabled} onChange={() => onEnabledChange(!enabled)} />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-4">
            {saveState === 'error' ? (
              <p className="text-xs text-red-500">Could not save automation. Please try again.</p>
            ) : (
              <span className="text-xs text-[var(--muted)]">Changes are saved manually.</span>
            )}
          </div>
        </SettingsCard>

        <SettingsCard title="Schedule">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm font-medium text-[var(--foreground)]">
              Frequency
              <select
                value={scheduleKind}
                onChange={(event) => onScheduleKindChange(event.target.value as AutomationSchedule['kind'])}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-12 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              >
                {scheduleKindOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {scheduleKind === 'interval' ? (
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Every N minutes
                <input
                  type="number"
                  min={MIN_AUTOMATION_INTERVAL_MINUTES}
                  value={intervalMinutes}
                  onChange={(event) => onIntervalMinutesChange(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
                />
              </label>
            ) : (
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Time
                <input
                  type="time"
                  value={time}
                  onChange={(event) => onTimeChange(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-8 text-sm text-[var(--foreground)] outline-none"
                />
              </label>
            )}
            {scheduleKind === 'weekly' && (
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Day of week
                <select
                  value={dayOfWeek}
                  onChange={(event) => onDayOfWeekChange(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-12 text-sm text-[var(--foreground)] outline-none"
                >
                  {WEEKDAY_LABELS.map((day, index) => (
                    <option key={day} value={index}>{day}</option>
                  ))}
                </select>
              </label>
            )}
            {scheduleKind === 'monthly' && (
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Day of month
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(event) => onDayOfMonthChange(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-8 text-sm text-[var(--foreground)] outline-none"
                />
              </label>
            )}
            <label className="block text-sm font-medium text-[var(--foreground)]">
              Time zone
              <select
                value={timezone}
                onChange={(event) => onTimezoneChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-12 text-sm text-[var(--foreground)] outline-none"
              >
                {timeZoneOptions.map((zone) => (
                  <option key={zone.value} value={zone.value}>{zone.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-[var(--foreground)]">
              Model
              <select
                value={modelId}
                onChange={(event) => onModelIdChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 pr-12 text-sm text-[var(--foreground)] outline-none"
              >
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </label>
          </div>
        </SettingsCard>

        <SettingsCard title="Instructions">
          <div className="text-[var(--foreground)]">
            {renderInstructionsEditor({ value: instructions, onChange: onInstructionsChange })}
          </div>
        </SettingsCard>

        <SettingsCard title="Flow">
          <AutomationGraphCanvas source={graphSource} />
        </SettingsCard>

        <SettingsCard title="Test">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Run once</p>
              <p className="text-xs text-[var(--muted)]">Executes the automation now and writes the result to the automation chat.</p>
            </div>
            <button
              type="button"
              onClick={onTest}
              disabled={testState === 'running' || !instructions.trim()}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
            >
              {testState === 'running' ? 'Running...' : 'Test automation'}
            </button>
          </div>
          {testMessage ? (
            <p className={`mt-3 text-xs ${testState === 'error' ? 'text-red-500' : 'text-[var(--muted)]'}`}>
              {testMessage}
            </p>
          ) : null}
        </SettingsCard>
      </div>
    </div>
  )
}
