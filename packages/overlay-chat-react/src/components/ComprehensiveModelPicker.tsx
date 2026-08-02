import { useEffect, useRef, useState } from 'react'
import { BrainCircuit, Check, ChevronDown, Image as ImageIcon } from 'lucide-react'
import {
  type ChatModelPreferences,
  type ChatModel,
  type GenerationMode,
  type ImageModel,
  type VideoModel,
} from '@overlay/chat-core'

function ModelBadges({ m, isHovered }: { m: ChatModel; isHovered: boolean }) {
  const cost = m.cost ?? 1
  if (isHovered) {
    return (
      <span className="flex h-5 shrink-0 items-center gap-1">
        <span
          className={`inline-flex h-5 items-center rounded-full px-1.5 text-[9px] font-semibold leading-none tracking-tight ${
            cost === 0 ? '' : 'bg-[var(--surface-subtle)] text-[var(--muted)]'
          }`}
          style={cost === 0 ? { background: 'var(--chat-badge-free-bg)', color: 'var(--chat-badge-free-fg)' } : undefined}
        >
          {cost === 0 ? 'Free' : '$'.repeat(cost)}
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

function resolvePreferencesForDisplay(
  prefs: ChatModelPreferences,
  chatModels: ChatModel[],
  imageModels: ImageModel[],
  videoModels: VideoModel[],
) {
  const chatId = prefs.modelId?.trim() || chatModels[0]?.id || ''
  const imageId = prefs.imageModelId?.trim() || imageModels[0]?.id || ''
  const videoId = prefs.videoModelId?.trim() || videoModels[0]?.id || ''
  return {
    chatId: chatModels.some((model) => model.id === chatId) ? chatId : chatModels[0]?.id || chatId,
    imageId: imageModels.some((model) => model.id === imageId) ? imageId : imageModels[0]?.id || imageId,
    videoId: videoModels.some((model) => model.id === videoId) ? videoId : videoModels[0]?.id || videoId,
  }
}

interface ComprehensiveModelPickerProps<TPreferences extends ChatModelPreferences = ChatModelPreferences> {
  generationMode: GenerationMode
  preferences: TPreferences
  onPreferencesChange: (next: TPreferences) => void
  chatModels: ChatModel[]
  imageModels?: ImageModel[]
  videoModels?: VideoModel[]
  disabled?: boolean
  className?: string
}

export function ComprehensiveModelPicker<TPreferences extends ChatModelPreferences = ChatModelPreferences>({
  generationMode,
  preferences,
  onPreferencesChange,
  chatModels,
  imageModels = [],
  videoModels = [],
  disabled,
  className = '',
}: ComprehensiveModelPickerProps<TPreferences>) {
  const [open, setOpen] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const ids = resolvePreferencesForDisplay(preferences, chatModels, imageModels, videoModels)

  const buttonLabel =
    generationMode === 'image'
      ? imageModels.find((model) => model.id === ids.imageId)?.name ?? 'Image model'
      : generationMode === 'video'
        ? videoModels.find((model) => model.id === ids.videoId)?.name ?? 'Video model'
        : chatModels.find((model) => model.id === ids.chatId)?.name ?? ids.chatId ?? 'Model'

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
          className="overlay-pop-in absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg md:left-auto md:right-0 md:w-64"
          onMouseLeave={() => setHoveredId(null)}
        >
          <div className="max-h-72 overflow-y-auto">
            {generationMode === 'image'
              ? imageModels.map((m) => {
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
                ? videoModels.map((m) => {
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
                : chatModels.map((m) => {
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
