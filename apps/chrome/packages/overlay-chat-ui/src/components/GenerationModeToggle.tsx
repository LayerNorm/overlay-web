import { useEffect, useRef, useState, type ComponentType } from 'react'
import { ChevronDown, MessageSquare, ImageIcon, Video, Bot } from 'lucide-react'
import type { GenerationMode } from '@overlay/extension-contracts'

interface GenerationModeToggleProps {
  mode: GenerationMode
  onChange: (mode: GenerationMode) => void
  disabled?: boolean
  className?: string
  /** Equal-width segments for narrow layouts (no horizontal overflow). */
  layout?: 'default' | 'stretch'
}

const MODES: { value: GenerationMode; label: string; Icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { value: 'text', label: 'Text', Icon: MessageSquare },
  { value: 'image', label: 'Image', Icon: ImageIcon },
  { value: 'video', label: 'Video', Icon: Video },
]

export function GenerationModeToggle({
  mode,
  onChange,
  disabled,
  className = '',
  layout = 'default',
}: GenerationModeToggleProps) {
  const stretch = layout === 'stretch'
  return (
    <div
      className={`flex items-center rounded-lg bg-[var(--surface-subtle)] p-0.5 shrink-0 ${stretch ? 'w-full min-w-0' : ''} ${className}`}
    >
      {MODES.map(({ value, label, Icon }) => {
        const active = mode === value
        return (
          <button
            key={value}
            onClick={() => !disabled && onChange(value)}
            disabled={disabled}
            title={label}
            type="button"
            className={`flex items-center justify-center rounded-md text-xs transition-colors ${
              stretch
                ? 'min-w-0 flex-1 flex-col gap-0.5 px-0.5 py-1.5 sm:flex-row sm:gap-1 sm:px-2 sm:py-1'
                : 'gap-1 px-2.5 py-1'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${
              active
                ? 'bg-[var(--surface-elevated)] font-medium text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]'
            }`}
          >
            <Icon size={stretch ? 13 : 11} className="shrink-0" />
            <span className={stretch ? 'max-w-full truncate text-center text-[10px] leading-none sm:text-xs' : ''}>
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const MODE_META: Record<GenerationMode, { label: string; Icon: ComponentType<{ size?: number; className?: string }> }> =
  {
    text: { label: 'Text', Icon: MessageSquare },
    image: { label: 'Image', Icon: ImageIcon },
    video: { label: 'Video', Icon: Video },
  }

interface CollapsibleGenerationModeProps {
  mode: GenerationMode
  onChange: (mode: GenerationMode) => void
  disabled?: boolean
  className?: string
}

/** Chip that expands to the full three-segment toggle (composer toolbar). */
export function CollapsibleGenerationMode({
  mode,
  onChange,
  disabled,
  className = '',
}: CollapsibleGenerationModeProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { label, Icon } = MODE_META[mode]

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        title={`Output: ${label}`}
        className={`inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-xs text-[var(--muted)] transition-colors ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]'
        }`}
      >
        <Icon size={14} className="shrink-0" />
        <span className="max-w-[4.5rem] truncate sm:max-w-none">{label}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <GenerationModeToggle
            mode={mode}
            onChange={(next) => {
              onChange(next)
              setOpen(false)
            }}
            disabled={disabled}
            layout="stretch"
            className="min-w-[11rem]"
          />
        </div>
      ) : null}
    </div>
  )
}

const ASK_ACT_MODES: {
  value: 'ask' | 'act'
  label: string
  Icon: ComponentType<{ size?: number; className?: string }>
}[] = [
  { value: 'act', label: 'Act', Icon: Bot },
  { value: 'ask', label: 'Ask', Icon: MessageSquare },
]

interface AskActModeToggleProps {
  mode: 'ask' | 'act'
  onChange: (mode: 'ask' | 'act') => void
  disabled?: boolean
  className?: string
}

/** Same chrome as {@link GenerationModeToggle} — for the composer only. */
export function AskActModeToggle({ mode, onChange, disabled, className = '' }: AskActModeToggleProps) {
  return (
    <div className={`flex items-center bg-[var(--surface-subtle)] rounded-lg p-0.5 shrink-0 ${className}`}>
      {ASK_ACT_MODES.map(({ value, label, Icon }) => {
        const active = mode === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => !disabled && onChange(value)}
            disabled={disabled}
            title={label}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            } ${
              active
                ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm font-medium'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]'
            }`}
          >
            <Icon size={11} />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
