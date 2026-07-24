'use client'

import type { ReactNode } from 'react'
import type { ThemePresetId } from '@overlay/app-core'

export interface SettingsToggleProps {
  checked: boolean
  disabled?: boolean
  onChange: () => void
}

export function SettingsToggle({ checked, disabled, onChange }: SettingsToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'border-[var(--foreground)] bg-[var(--foreground)]'
          : 'border-[var(--border)] bg-[var(--surface-subtle)]'
      } ${disabled ? 'cursor-wait opacity-70' : ''}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-[var(--surface-elevated)] transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export interface SettingRowProps {
  icon: ReactNode
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}

export function SettingRow({ icon, title, description, checked, disabled, onChange }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-[var(--surface-muted)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[var(--muted)]">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--foreground)]">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{description}</p>
        </div>
      </div>
      <SettingsToggle checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}

export interface SettingsActionRowProps {
  icon: ReactNode
  title: string
  description: string
  action: ReactNode
}

export function SettingsActionRow({ icon, title, description, action }: SettingsActionRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-[var(--surface-muted)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[var(--muted)]">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--foreground)]">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{description}</p>
        </div>
      </div>
      {action}
    </div>
  )
}

export interface ThemePresetOption {
  id: ThemePresetId
  name: string
  previewColors: { background: string; accent: string }
}

export interface ThemePresetRowProps {
  label: string
  description: string
  presets: readonly ThemePresetOption[]
  value: ThemePresetId
  disabled?: boolean
  icon: ReactNode
  onChange: (id: ThemePresetId) => void
}

export function ThemePresetRow({
  label,
  description,
  presets,
  value,
  disabled,
  icon,
  onChange,
}: ThemePresetRowProps) {
  const active = presets.find((preset) => preset.id === value)
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-[var(--surface-muted)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[var(--muted)]">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-[var(--foreground)]">{label}</h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {active ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1.5">
            <span
              className="inline-block h-3.5 w-3.5 rounded-full border border-[var(--border)]"
              style={{ backgroundColor: active.previewColors.background }}
            />
            <span
              className="inline-block h-3.5 w-3.5 rounded-full border border-[var(--border)]"
              style={{ backgroundColor: active.previewColors.accent }}
            />
          </div>
        ) : null}
        <select
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value as ThemePresetId)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)] disabled:opacity-60"
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
