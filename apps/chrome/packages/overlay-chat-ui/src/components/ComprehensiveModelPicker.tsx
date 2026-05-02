import { useEffect, useRef, useState } from 'react'
import { BrainCircuit, Check, ChevronDown, Image as ImageIcon } from 'lucide-react'
import type { ExtensionPreferences, GenerationMode } from '@overlay/extension-contracts'
import {
  type ChatModel,
  getChatModelDisplayName,
  getImageModel,
  getModelsByIntelligence,
  getVideoModel,
  IMAGE_MODELS,
  resolveChatModelId,
  resolveImageModelId,
  resolveVideoModelId,
  VIDEO_MODELS,
} from '@overlay/extension-contracts'

function ModelBadges({ m, isHovered }: { m: ChatModel; isHovered: boolean }) {
  if (isHovered) {
    return (
      <span className="flex h-5 shrink-0 items-center gap-1">
        <span
          className={`inline-flex h-5 items-center rounded-full px-1.5 text-[9px] font-semibold leading-none tracking-tight ${
            m.cost === 0 ? '' : 'bg-[var(--surface-subtle)] text-[var(--muted)]'
          }`}
          style={m.cost === 0 ? { background: 'var(--chat-badge-free-bg)', color: 'var(--chat-badge-free-fg)' } : undefined}
        >
          {m.cost === 0 ? 'Free' : '$'.repeat(m.cost)}
        </span>
      </span>
    )
  }

  return (
    <span className="flex h-5 shrink-0 items-center gap-1">
      {m.supportsVision ? (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
          <ImageIcon size={10} strokeWidth={1.75} />
        </span>
      ) : null}
      {m.supportsReasoning ? (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--surface-subtle)] text-[var(--muted)]">
          <BrainCircuit size={10} strokeWidth={1.75} />
        </span>
      ) : null}
    </span>
  )
}

function resolvePreferencesForDisplay(prefs: ExtensionPreferences) {
  return {
    chatId: resolveChatModelId(prefs),
    imageId: resolveImageModelId(prefs),
    videoId: resolveVideoModelId(prefs),
  }
}

interface ComprehensiveModelPickerProps {
  generationMode: GenerationMode
  preferences: ExtensionPreferences
  onPreferencesChange: (next: ExtensionPreferences) => void
  disabled?: boolean
  isFreeTier?: boolean
  className?: string
}

export function ComprehensiveModelPicker({
  generationMode,
  preferences,
  onPreferencesChange,
  disabled,
  isFreeTier = false,
  className = '',
}: ComprehensiveModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const ids = resolvePreferencesForDisplay(preferences)

  const buttonLabel =
    generationMode === 'image'
      ? getImageModel(ids.imageId)?.name ?? 'Image model'
      : generationMode === 'video'
        ? getVideoModel(ids.videoId)?.name ?? 'Video model'
        : getChatModelDisplayName(ids.chatId)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative min-w-0 flex-1 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 py-1.5 text-left text-xs md:max-w-[13rem] ${
          disabled ? 'cursor-not-allowed text-[var(--muted-light)]' : 'text-[var(--muted)] hover:bg-[var(--border)]'
        }`}
      >
        <span className="min-w-0 truncate">{buttonLabel}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg md:left-auto md:right-0 md:w-64"
          onMouseLeave={() => setHoveredId(null)}
        >
          <div className="max-h-72 overflow-y-auto">
            {generationMode === 'image'
              ? IMAGE_MODELS.map((m) => {
                  const isSel = m.id === ids.imageId
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-muted)] ${
                        isSel ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]'
                      }`}
                      onClick={() => {
                        onPreferencesChange({ ...preferences, imageModelId: m.id })
                        setOpen(false)
                      }}
                    >
                      <span className="flex items-center gap-2">
                        {isSel ? <Check size={10} /> : <span className="inline-block w-[10px]" />}
                        <span>{m.name}</span>
                      </span>
                    </button>
                  )
                })
              : generationMode === 'video'
                ? VIDEO_MODELS.map((m) => {
                    const isSel = m.id === ids.videoId
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-muted)] ${
                          isSel ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]'
                        }`}
                        onClick={() => {
                          onPreferencesChange({ ...preferences, videoModelId: m.id })
                          setOpen(false)
                        }}
                      >
                        <span className="flex items-center gap-2">
                          {isSel ? <Check size={10} /> : <span className="inline-block w-[10px]" />}
                          <span>{m.name}</span>
                        </span>
                      </button>
                    )
                  })
                : getModelsByIntelligence(isFreeTier).map((m) => {
                    const isSel = m.id === ids.chatId
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-muted)] ${
                          isSel ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]'
                        }`}
                        onMouseEnter={() => setHoveredId(m.id)}
                        onClick={() => {
                          onPreferencesChange({ ...preferences, modelId: m.id })
                          setOpen(false)
                        }}
                      >
                        <span className="flex items-center gap-2">
                          {isSel ? <Check size={10} /> : <span className="inline-block w-[10px]" />}
                          {m.name}
                        </span>
                        <ModelBadges m={m} isHovered={hoveredId === m.id} />
                      </button>
                    )
                  })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
