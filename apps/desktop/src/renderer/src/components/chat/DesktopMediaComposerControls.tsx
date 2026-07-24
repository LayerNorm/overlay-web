import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { ImageModel, VideoModel } from '@overlay/app-core'
import type { AskModelSelectionMode, GenerationMode, VideoSubMode } from '@overlay/chat-core'
import { VIDEO_SUB_MODE_LABELS } from '@overlay/chat-core'
import { CollapsibleGenerationMode } from '@overlay/chat-react'

const DESKTOP_VIDEO_SUB_MODES: readonly VideoSubMode[] = ['text-to-video', 'image-to-video']

interface DesktopMediaComposerControlsProps {
  generationMode: GenerationMode
  onGenerationModeChange: (mode: GenerationMode) => void
  imageModels: readonly ImageModel[]
  videoModels: readonly VideoModel[]
  selectedImageModelIds: readonly string[]
  selectedVideoModelIds: readonly string[]
  imageModelSelectionMode: AskModelSelectionMode
  videoModelSelectionMode: AskModelSelectionMode
  onImageModelSelectionModeChange: (mode: AskModelSelectionMode) => void
  onVideoModelSelectionModeChange: (mode: AskModelSelectionMode) => void
  onToggleImageModel: (modelId: string) => void
  onToggleVideoModel: (modelId: string) => void
  videoSubMode: VideoSubMode
  onVideoSubModeChange: (mode: VideoSubMode) => void
  isFreeTier: boolean
  disabled?: boolean
}

export function DesktopMediaComposerControls({
  generationMode,
  onGenerationModeChange,
  imageModels,
  videoModels,
  selectedImageModelIds,
  selectedVideoModelIds,
  imageModelSelectionMode,
  videoModelSelectionMode,
  onImageModelSelectionModeChange,
  onVideoModelSelectionModeChange,
  onToggleImageModel,
  onToggleVideoModel,
  videoSubMode,
  onVideoSubModeChange,
  isFreeTier,
  disabled = false
}: DesktopMediaComposerControlsProps): React.ReactElement {
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [videoModePickerOpen, setVideoModePickerOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!modelPickerOpen && !videoModePickerOpen) return
    const close = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setModelPickerOpen(false)
        setVideoModePickerOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setModelPickerOpen(false)
      setVideoModePickerOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [modelPickerOpen, videoModePickerOpen])

  const mediaModels = generationMode === 'image' ? imageModels : videoModels
  const selectedIds = generationMode === 'image' ? selectedImageModelIds : selectedVideoModelIds
  const selectionMode =
    generationMode === 'image' ? imageModelSelectionMode : videoModelSelectionMode
  const modelLabel =
    selectedIds.length === 1
      ? (mediaModels.find((model) => model.id === selectedIds[0])?.name ?? 'Select model')
      : selectedIds.length > 1
        ? `${selectedIds.length} models`
        : mediaModels.length
          ? 'Select model'
          : `No ${generationMode} models`

  const setSelectionMode = (mode: AskModelSelectionMode): void => {
    if (generationMode === 'image') onImageModelSelectionModeChange(mode)
    if (generationMode === 'video') onVideoModelSelectionModeChange(mode)
  }
  const toggleModel = (modelId: string): void => {
    if (generationMode === 'image') onToggleImageModel(modelId)
    if (generationMode === 'video') onToggleVideoModel(modelId)
    if (selectionMode === 'single') setModelPickerOpen(false)
  }

  return (
    <div ref={rootRef} className="flex shrink-0 items-center gap-1.5">
      <CollapsibleGenerationMode
        mode={generationMode}
        onChange={(nextMode) => {
          onGenerationModeChange(nextMode)
          setModelPickerOpen(false)
          setVideoModePickerOpen(false)
        }}
        disabled={disabled}
      />

      {generationMode === 'video' ? (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setVideoModePickerOpen((open) => !open)
              setModelPickerOpen(false)
            }}
            disabled={disabled}
            className="flex h-8 max-w-36 items-center gap-1.5 rounded-lg bg-[var(--surface-subtle)] px-2 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-expanded={videoModePickerOpen}
            aria-haspopup="listbox"
            aria-label="Choose video input mode"
          >
            <span className="truncate">{VIDEO_SUB_MODE_LABELS[videoSubMode]}</span>
            <ChevronDown size={12} className="shrink-0" />
          </button>
          {videoModePickerOpen ? (
            <div
              role="listbox"
              aria-label="Video input mode"
              className="absolute bottom-full right-0 z-40 mb-2 w-44 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg"
            >
              {DESKTOP_VIDEO_SUB_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="option"
                  aria-selected={videoSubMode === mode}
                  onClick={() => {
                    onVideoSubModeChange(mode)
                    setVideoModePickerOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--surface-muted)] ${
                    videoSubMode === mode
                      ? 'font-medium text-[var(--foreground)]'
                      : 'text-[var(--muted)]'
                  }`}
                >
                  {videoSubMode === mode ? (
                    <Check size={11} />
                  ) : (
                    <span className="inline-block w-[11px]" />
                  )}
                  {VIDEO_SUB_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {generationMode !== 'text' ? (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setModelPickerOpen((open) => !open)
              setVideoModePickerOpen(false)
            }}
            disabled={disabled || mediaModels.length === 0}
            className="flex h-8 max-w-44 items-center gap-1.5 rounded-lg bg-[var(--surface-subtle)] px-2 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-expanded={modelPickerOpen}
            aria-haspopup="listbox"
            aria-label={`Choose ${generationMode} models`}
          >
            <span className="truncate">{modelLabel}</span>
            <ChevronDown size={12} className="shrink-0" />
          </button>
          {modelPickerOpen ? (
            <div className="absolute bottom-full right-0 z-40 mb-2 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
              <div
                role="listbox"
                aria-label={`${generationMode} models`}
                className="max-h-64 overflow-y-auto"
              >
                {mediaModels.map((model) => {
                  const selected = selectedIds.includes(model.id)
                  const atLimit = selectionMode === 'multiple' && selectedIds.length >= 4
                  const modelDisabled = !selected && atLimit
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={modelDisabled}
                      onClick={() => toggleModel(model.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                        modelDisabled
                          ? 'cursor-not-allowed text-[var(--muted-light)] opacity-50'
                          : 'text-[var(--foreground)] hover:bg-[var(--surface-muted)]'
                      }`}
                    >
                      <span className="flex h-4 w-4 items-center justify-center">
                        {selected ? <Check size={11} /> : null}
                      </span>
                      <span className="truncate">{model.name}</span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-[var(--border)] px-2 py-2">
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface-subtle)] p-0.5">
                  {(['single', 'multiple'] as const).map((mode) => {
                    const active = selectionMode === mode
                    const modeDisabled = disabled || (isFreeTier && mode === 'multiple')
                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={modeDisabled}
                        aria-pressed={active}
                        onClick={() => setSelectionMode(mode)}
                        className={`rounded-md px-2 py-1 text-[10px] font-medium capitalize transition-colors ${
                          active
                            ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm'
                            : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                        title={
                          isFreeTier && mode === 'multiple'
                            ? 'Multiple media models require an upgrade'
                            : undefined
                        }
                      >
                        {mode}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
