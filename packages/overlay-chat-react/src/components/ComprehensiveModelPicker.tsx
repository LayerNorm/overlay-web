'use client'

import { unstyledButton } from './control-reset'

import { useState, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger, Button } from '@overlay/ui/primitives'
import { BrainCircuit, Check, ChevronDown, Image as ImageIcon, KeyRound } from 'lucide-react'
import {
  type ChatModelPreferences,
  type ChatModel,
  type GenerationMode,
  type ImageModel,
  type VideoModel,
} from '@overlay/chat-core'

function isByokModel(model: ChatModel): boolean {
  return model.id.startsWith('byok/')
}

function ByokBadge({ pill }: { pill?: boolean }) {
  return (
    <span
      className={`inline-flex h-5 items-center bg-(--surface-subtle) text-[9px] font-semibold leading-none text-(--muted) ${
        pill ? 'rounded-full px-1.5 tracking-tight' : 'rounded-sm px-1'
      }`}
    >
      <KeyRound size={8} strokeWidth={2} className="mr-0.5" />
      BYOK
    </span>
  )
}

function CostBadge({ cost }: { cost: number }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-1.5 text-[9px] font-semibold leading-none tracking-tight ${
        cost === 0 ? '' : 'bg-(--surface-subtle) text-(--muted)'
      }`}
      style={
        cost === 0
          ? { background: 'var(--chat-badge-free-bg)', color: 'var(--chat-badge-free-fg)' }
          : undefined
      }
    >
      {cost === 0 ? 'Free' : '$'.repeat(cost)}
    </span>
  )
}

function CapabilityBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-(--surface-subtle) text-(--muted)">
      {children}
    </span>
  )
}

function ModelBadges({ m, isHovered }: { m: ChatModel; isHovered: boolean }) {
  const byok = isByokModel(m)
  if (isHovered) {
    return (
      <span className="flex h-5 shrink-0 items-center gap-1">
        {byok ? <ByokBadge pill /> : <CostBadge cost={m.cost ?? 1} />}
      </span>
    )
  }

  return (
    <span className="flex h-5 shrink-0 items-center gap-1">
      {byok ? <ByokBadge /> : null}
      {m.supportsVision ? (
        <CapabilityBadge>
          <ImageIcon size={10} strokeWidth={1.75} />
        </CapabilityBadge>
      ) : null}
      {m.supportsReasoning ? (
        <CapabilityBadge>
          <BrainCircuit size={10} strokeWidth={1.75} />
        </CapabilityBadge>
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
    imageId: imageModels.some((model) => model.id === imageId)
      ? imageId
      : imageModels[0]?.id || imageId,
    videoId: videoModels.some((model) => model.id === videoId)
      ? videoId
      : videoModels[0]?.id || videoId,
  }
}

interface ComprehensiveModelPickerProps<
  TPreferences extends ChatModelPreferences = ChatModelPreferences,
> {
  generationMode: GenerationMode
  preferences: TPreferences
  onPreferencesChange: (next: TPreferences) => void
  chatModels: ChatModel[]
  imageModels?: ImageModel[]
  videoModels?: VideoModel[]
  disabled?: boolean
  className?: string
}

export function ComprehensiveModelPicker<
  TPreferences extends ChatModelPreferences = ChatModelPreferences,
>({
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
  const ids = resolvePreferencesForDisplay(preferences, chatModels, imageModels, videoModels)

  const buttonLabel =
    generationMode === 'image'
      ? (imageModels.find((model) => model.id === ids.imageId)?.name ?? 'Image model')
      : generationMode === 'video'
        ? (videoModels.find((model) => model.id === ids.videoId)?.name ?? 'Video model')
        : (chatModels.find((model) => model.id === ids.chatId)?.name ?? ids.chatId ?? 'Model')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={`relative min-w-0 flex-1 ${className}`}>
        <PopoverTrigger asChild>
          <Button variant="ghost"
            type="button"
            disabled={disabled}
            aria-expanded={open}
            className={unstyledButton(`flex w-full min-w-0 items-center justify-between gap-2 rounded-md bg-(--surface-subtle) px-2.5 py-1.5 text-left text-xs md:max-w-52 ${
              disabled
                ? 'cursor-not-allowed text-(--muted-light)'
                : 'text-(--muted) hover:bg-(--border)'
            }`)}
          >
            <span className="min-w-0 truncate">{buttonLabel}</span>
            <ChevronDown
              size={11}
              className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label="Choose model"
          className="w-[var(--radix-popover-trigger-width)] rounded-lg md:w-64"
          onMouseLeave={() => setHoveredId(null)}
        >
          <div className="max-h-72 overflow-y-auto">
            {generationMode === 'image'
              ? imageModels.map((m) => {
                  const isSel = m.id === ids.imageId
                  return (
                    <Button variant="ghost"
                      key={m.id}
                      type="button"
                      aria-pressed={isSel}
                      className={unstyledButton(`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--surface-muted) ${
                        isSel ? 'font-medium text-(--foreground)' : 'text-(--muted)'
                      }`)}
                      onClick={() => {
                        onPreferencesChange({ ...preferences, imageModelId: m.id })
                        setOpen(false)
                      }}
                    >
                      <span className="flex items-center gap-2">
                        {isSel ? <Check size={10} /> : <span className="inline-block w-[10px]" />}
                        <span>{m.name}</span>
                      </span>
                    </Button>
                  )
                })
              : generationMode === 'video'
                ? videoModels.map((m) => {
                    const isSel = m.id === ids.videoId
                    return (
                      <Button variant="ghost"
                        key={m.id}
                        type="button"
                        aria-pressed={isSel}
                        className={unstyledButton(`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--surface-muted) ${
                          isSel ? 'font-medium text-(--foreground)' : 'text-(--muted)'
                        }`)}
                        onClick={() => {
                          onPreferencesChange({ ...preferences, videoModelId: m.id })
                          setOpen(false)
                        }}
                      >
                        <span className="flex items-center gap-2">
                          {isSel ? <Check size={10} /> : <span className="inline-block w-[10px]" />}
                          <span>{m.name}</span>
                        </span>
                      </Button>
                    )
                  })
                : chatModels.map((m) => {
                    const isSel = m.id === ids.chatId
                    const byok = isByokModel(m)
                    return (
                      <Button variant="ghost"
                        key={m.id}
                        type="button"
                        aria-pressed={isSel}
                        className={unstyledButton(`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--surface-muted) ${
                          isSel ? 'font-medium text-(--foreground)' : 'text-(--muted)'
                        }`)}
                        onMouseEnter={() => setHoveredId(m.id)}
                        onClick={() => {
                          onPreferencesChange({ ...preferences, modelId: m.id })
                          setOpen(false)
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {isSel ? (
                            <Check size={10} className="shrink-0" />
                          ) : (
                            <span className="inline-block w-[10px] shrink-0" />
                          )}
                          <span className="min-w-0 truncate">{m.name}</span>
                          {byok && m.provider ? (
                            <span className="shrink-0 truncate text-[10px] text-(--muted-light)">
                              {m.provider}
                            </span>
                          ) : null}
                        </span>
                        <ModelBadges m={m} isHovered={hoveredId === m.id} />
                      </Button>
                    )
                  })}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}
