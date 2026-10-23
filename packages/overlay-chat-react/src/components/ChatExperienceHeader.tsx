'use client'

import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'

import { Suspense, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Check,
  ChevronDown,
  FolderOpen,
  MessageSquare,
  Pencil,
  SlidersHorizontal,
} from 'lucide-react'
import { CrossfadeText } from './CrossfadeText'
import type {
  ChatModel,
  GenerationMode,
  ImageModel,
  ReasoningLevel,
  VideoModel,
  VideoSubMode,
} from '@overlay/chat-core'
import { VIDEO_SUB_MODES, VIDEO_SUB_MODE_LABELS } from '@overlay/chat-core'
import {
  GenerationModeToggle,
  PersonalChatModeToggle,
  type PersonalChatMode,
} from '@overlay/ui/chat'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger, Button, Input } from '@overlay/ui/primitives'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { AppScreenHeader } from '@overlay/modules-react/shell'
import type { ChatModelIndicatorModel } from './ModelIndicators'
import { ModelQualitiesPanel } from './ModelQualitiesPanel'
import { ModelSelector } from './ModelSelector'
import { useFavoriteModelIds } from './useFavoriteModelIds'

const TEMPORARY_CHAT_ICON_SRC = '/assets/icons/dashed-chat.png'

const AUTOMATION_DETAIL_TABS = [
  { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
  { id: 'edit' as const, label: 'Edit', icon: SlidersHorizontal },
]

export type AutomationDetailTabId = (typeof AUTOMATION_DETAIL_TABS)[number]['id']

export type ModelQualitiesPosition = { x: number; y: number }

function TemporaryChatButton({
  active,
  disabled,
  onClick,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <DelayedTooltip
      label={active ? 'Temporary chat is on. Messages are erased when you leave this page.' : 'Start a temporary chat'}
      side="bottom"
    >
      <Button variant="ghost"
        type="button"
        aria-pressed={active}
        aria-label={active ? 'Disable temporary chat' : 'Enable temporary chat'}
        disabled={disabled}
        onClick={onClick}
        className={unstyledButton(`flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,box-shadow,color] duration-300 ${
          active
            ? 'temporary-chat-inverse-surface border-dashed border-(--temporary-chat-border) shadow-xs'
            : 'border-transparent bg-(--surface-subtle) text-(--muted) hover:bg-(--border) hover:text-(--foreground)'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`)}
      >
        <span
          aria-hidden
          className="size-4 bg-current"
          style={{
            WebkitMask: `url(${TEMPORARY_CHAT_ICON_SRC}) center / contain no-repeat`,
            mask: `url(${TEMPORARY_CHAT_ICON_SRC}) center / contain no-repeat`,
          }}
        />
      </Button>
    </DelayedTooltip>
  )
}

function PremiumModelsLoadingRows({ divider = false }: { divider?: boolean }) {
  return (
    <div
      className={divider ? 'mt-1 border-t border-(--border)' : ''}
      role="status"
      aria-label="Loading premium models"
    >
      <div className="px-3 pb-1 pt-2 text-[9px] font-medium uppercase tracking-[0.08em] text-(--muted-light)">
        Premium
      </div>
      <div className="space-y-1 px-3 pb-2 pt-1" aria-hidden>
        {[72, 58, 66].map((width) => (
          <div key={width} className="flex h-7 items-center gap-2">
            <span className="ui-skeleton-line h-2.5 w-[10px] rounded-sm" />
            <span className="ui-skeleton-line h-3 rounded-sm" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export interface ChatExperienceHeaderProps {
  favoriteScope?: string | null
  modelRecommendations?: Partial<Record<GenerationMode, readonly string[]>>
  hideHeader?: boolean
  activeChatId: string | null
  editingChatId: string | null
  editingChatTitle: string
  onEditingChatTitleChange: (value: string) => void
  onCommitChatRename: (chatId: string) => void | Promise<void>
  onCancelChatRename: () => void
  headerTitleInputRef: RefObject<HTMLInputElement | null>
  showAutomationHeaderControls: boolean
  titleLabel: string
  onBeginHeaderChatRename?: () => void
  showRenameButton: boolean
  projectName?: string | null
  showAutomationChatTab: boolean
  appMode: 'chat' | 'automate'
  isTemporaryChat: boolean
  isActiveLoading: boolean
  onTemporaryChatToggle: () => void
  onGenerationModeChange: (mode: GenerationMode) => void
  generationMode: GenerationMode
  personalChatMode: PersonalChatMode
  onPersonalChatModeChange: (mode: PersonalChatMode) => void
  renderExportMenu: () => ReactNode
  modelPickerRef: RefObject<HTMLDivElement | null>
  videoSubModePickerRef: RefObject<HTMLDivElement | null>
  modelPickerListScrollRef: RefObject<HTMLDivElement | null>
  showModelPicker: boolean
  onToggleModelPicker: () => void
  onSetShowModelPicker: (value: boolean | ((prev: boolean) => boolean)) => void
  /** The composer renders the model controls, so the header leaves them out. */
  modelControlsInComposer?: boolean
  modelPickerLabel: string
  hoveredModelId: string | null
  modelQualitiesPos: ModelQualitiesPosition | null
  onHoveredModelChange: (modelId: string | null, position: ModelQualitiesPosition | null) => void
  resolveModel: (modelId: string) => ChatModel | undefined
  isFreeTier: boolean
  isFreeTierChatModelId: (modelId: string) => boolean
  automationHeaderModelId: string
  automationHeaderModels: ChatModel[]
  onSaveAutomationHeaderModel: (modelId: string) => void | Promise<void>
  getChatModelDisplayName: (modelId: string) => string
  automationDetailTab: AutomationDetailTabId
  onSelectAutomationDetailTab: (tab: AutomationDetailTabId) => void
  videoSubMode: VideoSubMode
  showVideoSubModePicker: boolean
  onToggleVideoSubModePicker: () => void
  onSetShowVideoSubModePicker: (value: boolean | ((prev: boolean) => boolean)) => void
  onVideoSubModeChange: (value: VideoSubMode) => void
  imageModels: ImageModel[]
  selectedImageModels: string[]
  onSelectImageModel: (modelId: string) => void
  videoModels: VideoModel[]
  selectedVideoModels: string[]
  onSelectVideoModel: (modelId: string) => void
  selectableTextModels: ChatModel[]
  textModelsLoading: boolean
  selectedActModel: string
  selectedModels: string[]
  onToggleTextModel: (modelId: string) => void
  hasAutomationContext: boolean
  reasoning?: ReasoningLevel
  onReasoningChange?: (level: ReasoningLevel | undefined) => void
}

function HeaderTitleSection({
  activeChatId,
  editingChatId,
  editingChatTitle,
  onEditingChatTitleChange,
  onCommitChatRename,
  onCancelChatRename,
  headerTitleInputRef,
  showAutomationHeaderControls,
  titleLabel,
  onBeginHeaderChatRename,
  showRenameButton,
  projectName,
}: Pick<ChatExperienceHeaderProps,
  | 'activeChatId'
  | 'editingChatId'
  | 'editingChatTitle'
  | 'onEditingChatTitleChange'
  | 'onCommitChatRename'
  | 'onCancelChatRename'
  | 'headerTitleInputRef'
  | 'showAutomationHeaderControls'
  | 'titleLabel'
  | 'onBeginHeaderChatRename'
  | 'showRenameButton'
  | 'projectName'
>) {
  return (
    <div
      className={`group/header-title min-w-0 items-center gap-2 md:min-w-0 md:flex-1 ${
        activeChatId && editingChatId === activeChatId
          ? 'flex w-full'
          : showAutomationHeaderControls
            ? 'flex w-full flex-wrap md:w-auto md:flex-nowrap'
            : 'flex w-full md:w-auto'
      }`}
    >
      {activeChatId && editingChatId === activeChatId ? (
        <Input
          ref={headerTitleInputRef}
          aria-label="Conversation title"
          className={unstyledInput(`min-w-0 flex-1 rounded-md border border-(--border) bg-(--background) px-2 py-1 text-sm font-medium text-(--foreground) outline-hidden focus:ring-1 focus:ring-(--foreground) md:max-w-[min(100%,20rem)] lg:max-w-[24rem]`)}
          value={editingChatTitle}
          onChange={(e) => onEditingChatTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void onCommitChatRename(activeChatId)
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancelChatRename()
            }
          }}
          onBlur={() => void onCommitChatRename(activeChatId)}
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <h2
            className="min-w-0 flex-1 text-sm font-medium leading-snug text-(--foreground) md:max-w-[20rem] md:truncate lg:max-w-[24rem]"
            title={titleLabel}
          >
            <CrossfadeText text={titleLabel} className="line-clamp-2 md:line-clamp-1 md:truncate" />
          </h2>
          {showRenameButton ? (
            <Button variant="ghost"
              type="button"
              onClick={onBeginHeaderChatRename}
              className={unstyledButton(`shrink-0 rounded-sm p-1 text-(--muted) opacity-0 transition-opacity hover:bg-(--border) hover:text-(--foreground) group-hover/header-title:opacity-100 focus-visible:opacity-100`)}
              aria-label="Rename chat"
            >
              <Pencil size={14} />
            </Button>
          ) : null}
        </div>
      )}
      {projectName ? (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-(--border) bg-(--surface-subtle) px-2 py-0.5 text-[10px] text-(--muted)">
          <FolderOpen size={9} />
          <span className="max-w-24 truncate sm:max-w-none">{projectName}</span>
        </span>
      ) : null}
    </div>
  )
}

function ModelQualitiesHoverCard({
  modelId,
  position,
  modelPickerRef,
  onClosePicker,
  resolveModel,
  reasoning,
  onReasoningChange,
  onHoveredModelChange,
}: {
  modelId: string
  position: ModelQualitiesPosition
  modelPickerRef: RefObject<HTMLDivElement | null>
  onClosePicker: () => void
  resolveModel: (modelId: string) => ChatModelIndicatorModel | undefined
  reasoning?: ReasoningLevel
  onReasoningChange?: (level: ReasoningLevel | undefined) => void
  onHoveredModelChange: (modelId: string | null, position: ModelQualitiesPosition | null) => void
}) {
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const picker = modelPickerRef.current?.getBoundingClientRect()
          const row = modelPickerRef.current?.querySelector(`[data-model-row="${CSS.escape(modelId)}"]`)?.getBoundingClientRect()
          return picker && row ? new DOMRect(picker.x, row.y, picker.width, row.height) : new DOMRect()
        },
        get contextElement() {
          // Floating UI must observe the row's scroll ancestors, including the
          // model list inside the outer popover, rather than only the panel.
          return modelPickerRef.current?.querySelector<HTMLElement>(`[data-model-row="${CSS.escape(modelId)}"]`) ?? undefined
        },
      },
    }),
    [modelId, modelPickerRef],
  )
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onHoveredModelChange(null, null)
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="right"
        align="start"
        updatePositionStrategy="always"
        aria-label="Model details"
        className="hidden w-64 overflow-visible rounded-lg px-4 py-3 shadow-md md:block"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          onClosePicker()
          onHoveredModelChange(null, null)
        }}
        onInteractOutside={(event) => {
          if (modelPickerRef.current?.contains(event.target as Node)) event.preventDefault()
        }}
        onMouseEnter={() => onHoveredModelChange(modelId, position)}
        onMouseLeave={(event) => {
          // Opening Radix Select suppresses outside pointer events, producing a
          // synthetic leave to Window. Keep the owning hover card mounted while
          // its reasoning control owns that interaction.
          if (event.currentTarget.querySelector('[data-slot="select-trigger"][data-state="open"]')) return
          onHoveredModelChange(null, null)
        }}
      >
        <Suspense fallback={null}>
          <ModelQualitiesPanel
            model={resolveModel(modelId)}
            reasoning={reasoning}
            onReasoningChange={onReasoningChange}
            reasoningPortal={false}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}

function AutomationModelPicker({
  modelPickerRef,
  getChatModelDisplayName,
  automationHeaderModelId,
  showModelPicker,
  hoveredModelId,
  modelQualitiesPos,
  onHoveredModelChange,
  resolveModel,
  reasoning,
  onReasoningChange,
  modelPickerListScrollRef,
  textModelsLoading,
  isFreeTier,
  automationHeaderModels,
  favoriteScope,
  modelRecommendations,
  isFreeTierChatModelId,
  onSaveAutomationHeaderModel,
  onSetShowModelPicker,
}: Pick<
  ChatExperienceHeaderProps,
  | 'modelPickerRef'
  | 'onToggleModelPicker'
  | 'getChatModelDisplayName'
  | 'automationHeaderModelId'
  | 'showModelPicker'
  | 'hoveredModelId'
  | 'modelQualitiesPos'
  | 'onHoveredModelChange'
  | 'resolveModel'
  | 'reasoning'
  | 'onReasoningChange'
  | 'modelPickerListScrollRef'
  | 'textModelsLoading'
  | 'isFreeTier'
  | 'automationHeaderModels'
  | 'favoriteScope'
  | 'modelRecommendations'
  | 'isFreeTierChatModelId'
  | 'onSaveAutomationHeaderModel'
  | 'onSetShowModelPicker'
>) {
  const { favoriteIds, toggleFavorite } = useFavoriteModelIds(favoriteScope)
  return (
    <Popover open={showModelPicker} onOpenChange={onSetShowModelPicker}>
      <div data-tour="model-picker" className="relative min-w-0 flex-1 md:w-auto md:flex-none">
        <DelayedTooltip label="Choose automation model" side="bottom">
          <PopoverTrigger asChild>
            <Button variant="ghost"
              type="button"
              className={unstyledButton(`flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-(--surface-subtle) px-2.5 py-0 text-left text-xs leading-none text-(--muted) hover:bg-(--border) disabled:cursor-default disabled:opacity-70 md:w-auto md:max-w-52`)}
              aria-label="Automation model"
            >
              <span className="min-w-0 truncate">
                {getChatModelDisplayName(automationHeaderModelId) || 'Select model'}
              </span>
              <ChevronDown size={11} className="shrink-0" />
            </Button>
          </PopoverTrigger>
        </DelayedTooltip>
        <PopoverContent
          ref={modelPickerRef}
          align="end"
          aria-label="Choose automation model"
          data-tour="model-picker"
          className="w-[min(24rem,calc(100vw-1rem))] rounded-lg p-0"
        >
          {hoveredModelId && modelQualitiesPos ? (
            <ModelQualitiesHoverCard
              onClosePicker={() => onSetShowModelPicker(false)}
              modelPickerRef={modelPickerRef}
              modelId={hoveredModelId}
              position={modelQualitiesPos}
              resolveModel={resolveModel}
              reasoning={reasoning}
              onReasoningChange={onReasoningChange}
              onHoveredModelChange={onHoveredModelChange}
            />
          ) : null}
          <ModelSelector
            models={automationHeaderModels}
            recommendedIds={modelRecommendations?.text}
            pinnedIds={isFreeTier ? automationHeaderModels.filter((m) => isFreeTierChatModelId(m.id)).map((m) => m.id) : []}
            favoriteIds={favoriteIds}
            onToggleFavorite={toggleFavorite}
          onListChange={() => onHoveredModelChange(null, null)}
            listRef={modelPickerListScrollRef}
            isSelected={(m) => m.id === automationHeaderModelId}
            onSelect={(m) => {
              void onSaveAutomationHeaderModel(m.id)
              onSetShowModelPicker(false)
            }}
            onRowHover={(m, row) => {
              const r = row.getBoundingClientRect()
              onHoveredModelChange(m.id, { x: r.right + 8, y: r.top })
            }}
            beforeList={textModelsLoading ? <PremiumModelsLoadingRows /> : null}
          />
        </PopoverContent>
      </div>
    </Popover>
  )
}

function AutomationDetailTabButtons({
  automationDetailTab,
  onSelectAutomationDetailTab,
}: Pick<ChatExperienceHeaderProps, 'automationDetailTab' | 'onSelectAutomationDetailTab'>) {
  return (
    <div className="flex h-8 shrink-0 items-center rounded-lg bg-(--surface-subtle) p-0.5">
      {AUTOMATION_DETAIL_TABS.map((tab) => {
        const active = automationDetailTab === tab.id
        const TabIcon = tab.icon
        return (
          <Button variant="ghost"
            key={tab.id}
            type="button"
            onClick={() => onSelectAutomationDetailTab(tab.id)}
            className={unstyledButton(`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
              active
                ? 'bg-(--surface-elevated) text-(--foreground) shadow-xs'
                : 'text-(--muted) hover:text-(--foreground)'
            }`)}
          >
            <TabIcon size={12} strokeWidth={1.75} />
            {tab.label}
          </Button>
        )
      })}
    </div>
  )
}

function AutomationHeaderControls(props: Pick<ChatExperienceHeaderProps,
  | 'modelPickerRef'
  | 'onToggleModelPicker'
  | 'getChatModelDisplayName'
  | 'automationHeaderModelId'
  | 'showModelPicker'
  | 'hoveredModelId'
  | 'modelQualitiesPos'
  | 'onHoveredModelChange'
  | 'resolveModel'
  | 'reasoning'
  | 'onReasoningChange'
  | 'modelPickerListScrollRef'
  | 'textModelsLoading'
  | 'isFreeTier'
  | 'automationHeaderModels'
  | 'favoriteScope'
  | 'modelRecommendations'
  | 'isFreeTierChatModelId'
  | 'onSaveAutomationHeaderModel'
  | 'onSetShowModelPicker'
  | 'automationDetailTab'
  | 'onSelectAutomationDetailTab'
>) {
  return (
    <div className="flex w-full shrink-0 items-center justify-end gap-2 md:w-auto">
      <AutomationModelPicker {...props} />
      <AutomationDetailTabButtons
        automationDetailTab={props.automationDetailTab}
        onSelectAutomationDetailTab={props.onSelectAutomationDetailTab}
      />
    </div>
  )
}

function VideoSubModePicker({
  videoSubModePickerRef,
  isActiveLoading,
  onToggleVideoSubModePicker,
  videoSubMode,
  showVideoSubModePicker,
  onVideoSubModeChange,
  onSetShowVideoSubModePicker,
}: Pick<ChatExperienceHeaderProps,
  | 'videoSubModePickerRef'
  | 'isActiveLoading'
  | 'onToggleVideoSubModePicker'
  | 'videoSubMode'
  | 'showVideoSubModePicker'
  | 'onVideoSubModeChange'
  | 'onSetShowVideoSubModePicker'
>) {
  return (
    <div ref={videoSubModePickerRef} className="relative min-w-0 md:w-auto">
      <Button variant="ghost"
        type="button"
        onClick={onToggleVideoSubModePicker}
        disabled={isActiveLoading}
        className={unstyledButton(`flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-(--surface-subtle) px-2.5 py-0 text-left text-xs leading-none md:w-auto md:max-w-52 ${
          isActiveLoading ? 'cursor-not-allowed text-(--muted-light)' : 'text-(--muted) hover:bg-(--border)'
        }`)}
      >
        <span className="min-w-0 truncate">{VIDEO_SUB_MODE_LABELS[videoSubMode]}</span>
        <ChevronDown size={11} className="shrink-0" />
      </Button>
      {showVideoSubModePicker ? (
        <div className="overlay-pop-in absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-(--border) bg-(--surface-elevated) py-1 shadow-lg md:left-auto md:right-0 md:w-52">
          {VIDEO_SUB_MODES.map(({ value, label }) => (
            <Button variant="ghost"
              key={value}
              type="button"
              onClick={() => {
                onVideoSubModeChange(value)
                onSetShowVideoSubModePicker(false)
              }}
              className={unstyledButton(`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-(--surface-muted) ${videoSubMode === value ? 'font-medium text-(--foreground)' : 'text-(--muted)'}`)}
            >
              {videoSubMode === value ? <Check size={10} /> : <span className="inline-block w-[10px]" />}
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ChatModelPickerDropdown({
  generationMode,
  lockedGenerationMode,
  onGenerationModeChange,
  isActiveLoading,
  modelPickerListScrollRef,
  textModelsLoading,
  isFreeTier,
  imageModels,
  selectedImageModels,
  onSelectImageModel,
  videoModels,
  selectedVideoModels,
  onSelectVideoModel,
  selectableTextModels,
  selectedActModel,
  onToggleTextModel,
  favoriteScope,
  modelRecommendations,
  isFreeTierChatModelId,
  onHoveredModelChange,
}: Pick<
  ChatExperienceHeaderProps,
  | 'generationMode'
  | 'onGenerationModeChange'
  | 'isActiveLoading'
  | 'modelPickerListScrollRef'
  | 'textModelsLoading'
  | 'isFreeTier'
  | 'imageModels'
  | 'selectedImageModels'
  | 'onSelectImageModel'
  | 'videoModels'
  | 'selectedVideoModels'
  | 'onSelectVideoModel'
  | 'selectableTextModels'
  | 'selectedActModel'
  | 'onToggleTextModel'
  | 'favoriteScope'
  | 'modelRecommendations'
  | 'isFreeTierChatModelId'
  | 'onHoveredModelChange'
> & { lockedGenerationMode?: GenerationMode }) {
  const { favoriteIds, toggleFavorite } = useFavoriteModelIds(favoriteScope)
  const mediaModels = generationMode === 'image' ? imageModels : videoModels
  const selectedMediaIds = generationMode === 'image' ? selectedImageModels : selectedVideoModels
  const onSelectMediaModel = generationMode === 'image' ? onSelectImageModel : onSelectVideoModel
  const modeToggle = (
    <DelayedTooltip label="Cycle text / image / video (⇧⌘.)" side="left" className="block w-full">
      <span data-tour="generation-mode-toggle" className="block w-full">
        <GenerationModeToggle
          mode={generationMode}
          onChange={onGenerationModeChange}
          disabled={isActiveLoading || Boolean(lockedGenerationMode)}
          layout="stretch"
        />
      </span>
    </DelayedTooltip>
  )
  return (
    <div data-tour="model-picker" className="min-w-0">
      <div className="px-1.5 pt-1.5">{modeToggle}</div>
      {generationMode === 'text' ? (
        <ModelSelector
          models={selectableTextModels}
          recommendedIds={modelRecommendations?.text}
          pinnedIds={isFreeTier ? selectableTextModels.filter((m) => isFreeTierChatModelId(m.id)).map((m) => m.id) : []}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          onListChange={() => onHoveredModelChange(null, null)}
          listRef={modelPickerListScrollRef}
          isSelected={(m) => m.id === selectedActModel}
          onSelect={(m) => onToggleTextModel(m.id)}
          onRowHover={(m, row) => {
            const r = row.getBoundingClientRect()
            onHoveredModelChange(m.id, { x: r.left - 8, y: r.top + r.height / 2 })
          }}
          beforeList={textModelsLoading ? <PremiumModelsLoadingRows /> : null}
        />
      ) : (
        <ModelSelector
          key={generationMode}
          models={mediaModels}
          recommendedIds={modelRecommendations?.[generationMode]}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          onListChange={() => onHoveredModelChange(null, null)}
          listRef={modelPickerListScrollRef}
          isSelected={(m) => m.id === selectedMediaIds[0]}
          onSelect={(m) => onSelectMediaModel(m.id)}
          onRowHover={(m, row) => {
            const r = row.getBoundingClientRect()
            onHoveredModelChange(m.id, { x: r.right + 8, y: r.top })
          }}
        />
      )}
    </div>
  )
}

export type ChatModelPickerProps = {
  placement?: 'header' | 'composer' | 'field'
  modelPickerRef?: RefObject<HTMLDivElement | null>
  modelPickerLabel: string
  showModelPicker?: boolean
  onSetShowModelPicker?: (value: boolean) => void
  generationMode?: GenerationMode
  lockedGenerationMode?: GenerationMode
  hoveredModelId?: string | null
  modelQualitiesPos?: ModelQualitiesPosition | null
  onHoveredModelChange?: (modelId: string | null, position: ModelQualitiesPosition | null) => void
  resolveModel?: (modelId: string) => ChatModel | undefined
  reasoning?: ReasoningLevel
  onReasoningChange?: (level: ReasoningLevel | undefined) => void
  onGenerationModeChange?: (mode: GenerationMode) => void
  isActiveLoading?: boolean
  modelPickerListScrollRef?: RefObject<HTMLDivElement | null>
  textModelsLoading?: boolean
  isFreeTier: boolean
  imageModels?: ImageModel[]
  selectedImageModels?: string[]
  onSelectImageModel?: (modelId: string) => void
  videoModels?: VideoModel[]
  selectedVideoModels?: string[]
  onSelectVideoModel?: (modelId: string) => void
  selectableTextModels: ChatModel[]
  selectedActModel: string
  onToggleTextModel: (modelId: string) => void
  favoriteScope?: string | null
  modelRecommendations?: Partial<Record<GenerationMode, readonly string[]>>
  isFreeTierChatModelId: (modelId: string) => boolean
}

function modelPickerPlacement(placement: ChatModelPickerProps['placement'] = 'header') {
  if (placement === 'field') {
    return {
      rootClass: 'relative w-full min-w-0',
      tooltipLabel: 'Choose agent model',
      tooltipSide: 'bottom' as const,
      triggerVariant: 'outline' as const,
      triggerClass: 'flex h-9 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
      popoverAlign: 'start' as const,
    }
  }
  if (placement === 'composer') {
    return {
      rootClass: 'relative min-w-0 shrink',
      tooltipLabel: 'Choose model (⇧⌘/)',
      tooltipSide: 'top' as const,
      triggerVariant: 'ghost' as const,
      triggerClass: unstyledButton('flex h-9 min-w-0 max-w-44 items-center gap-1.5 rounded-lg px-2.5 text-left text-xs leading-none text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground)'),
      popoverAlign: 'end' as const,
    }
  }
  return {
    rootClass: 'relative min-w-0 flex-1 md:w-auto md:flex-none',
    tooltipLabel: 'Choose model (⇧⌘/)',
    tooltipSide: 'bottom' as const,
    triggerVariant: 'ghost' as const,
    triggerClass: unstyledButton('flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-(--surface-subtle) px-2.5 py-0 text-left text-xs leading-none text-(--muted) hover:bg-(--border) md:w-auto md:max-w-52'),
    popoverAlign: 'end' as const,
  }
}

function resolvePickerModel(
  modelId: string,
  resolveModel: ChatModelPickerProps['resolveModel'],
  textModels: ChatModel[],
  imageModels: ImageModel[],
  videoModels: VideoModel[],
) {
  return resolveModel?.(modelId)
    ?? textModels.find((model) => model.id === modelId)
    ?? imageModels.find((model) => model.id === modelId)
    ?? videoModels.find((model) => model.id === modelId)
}

const EMPTY_IMAGE_MODELS: ImageModel[] = []
const EMPTY_VIDEO_MODELS: VideoModel[] = []
const EMPTY_SELECTED_MODELS: string[] = []
const IGNORE_MODEL_CHANGE = () => {}

export function ChatModelPicker({
  modelPickerRef,
  modelPickerLabel,
  showModelPicker,
  onSetShowModelPicker,
  generationMode,
  hoveredModelId,
  modelQualitiesPos,
  onHoveredModelChange,
  resolveModel,
  reasoning,
  onReasoningChange,
  onGenerationModeChange,
  isActiveLoading,
  modelPickerListScrollRef,
  textModelsLoading,
  isFreeTier,
  imageModels,
  selectedImageModels,
  onSelectImageModel,
  videoModels,
  selectedVideoModels,
  onSelectVideoModel,
  selectableTextModels,
  selectedActModel,
  onToggleTextModel,
  favoriteScope,
  modelRecommendations,
  isFreeTierChatModelId,
  placement = 'header',
  lockedGenerationMode,
}: ChatModelPickerProps) {
  const internalPickerRef = useRef<HTMLDivElement>(null)
  const internalListRef = useRef<HTMLDivElement>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const [internalHoveredModelId, setInternalHoveredModelId] = useState<string | null>(null)
  const [internalQualitiesPos, setInternalQualitiesPos] = useState<ModelQualitiesPosition | null>(null)
  const pickerRef = modelPickerRef ?? internalPickerRef
  const listRef = modelPickerListScrollRef ?? internalListRef
  const open = showModelPicker ?? internalOpen
  const activeGenerationMode = lockedGenerationMode ?? generationMode ?? 'text'
  const activeImageModels = imageModels ?? EMPTY_IMAGE_MODELS
  const activeVideoModels = videoModels ?? EMPTY_VIDEO_MODELS
  const activeSelectedImageModels = selectedImageModels ?? EMPTY_SELECTED_MODELS
  const activeSelectedVideoModels = selectedVideoModels ?? EMPTY_SELECTED_MODELS
  const activeHoveredModelId = hoveredModelId === undefined ? internalHoveredModelId : hoveredModelId
  const activeQualitiesPos = modelQualitiesPos === undefined ? internalQualitiesPos : modelQualitiesPos
  const placementConfig = modelPickerPlacement(placement)
  const handleOpenChange = (value: boolean) => {
    if (showModelPicker === undefined) setInternalOpen(value)
    onSetShowModelPicker?.(value)
  }
  const handleHoveredModelChange = (modelId: string | null, position: ModelQualitiesPosition | null) => {
    if (hoveredModelId === undefined) {
      setInternalHoveredModelId(modelId)
      setInternalQualitiesPos(position)
    }
    onHoveredModelChange?.(modelId, position)
  }
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div
        data-tour="model-picker"
        className={placementConfig.rootClass}
      >
        <DelayedTooltip
          label={placementConfig.tooltipLabel}
          side={placementConfig.tooltipSide}
        >
          <PopoverTrigger asChild>
            <Button variant={placementConfig.triggerVariant}
              type="button"
              className={placementConfig.triggerClass}
            >
              <span className="min-w-0 truncate">{modelPickerLabel}</span>
              <ChevronDown size={11} className="shrink-0" />
            </Button>
          </PopoverTrigger>
        </DelayedTooltip>
        <PopoverContent
          ref={pickerRef}
          align={placementConfig.popoverAlign}
          aria-label="Choose model"
          data-tour="model-picker"
          className="w-[min(24rem,calc(100vw-1rem))] rounded-lg p-0"
        >
          {activeHoveredModelId && activeQualitiesPos ? (
            <ModelQualitiesHoverCard
              onClosePicker={() => handleOpenChange(false)}
              modelPickerRef={pickerRef}
              modelId={activeHoveredModelId}
              position={activeQualitiesPos}
              resolveModel={(id) => resolvePickerModel(id, resolveModel, selectableTextModels, activeImageModels, activeVideoModels)}
              reasoning={reasoning}
              onReasoningChange={onReasoningChange}
              onHoveredModelChange={handleHoveredModelChange}
            />
          ) : null}
          <ChatModelPickerDropdown
            favoriteScope={favoriteScope}
            modelRecommendations={modelRecommendations}
            generationMode={activeGenerationMode}
            lockedGenerationMode={lockedGenerationMode}
            onGenerationModeChange={lockedGenerationMode ? IGNORE_MODEL_CHANGE : onGenerationModeChange ?? IGNORE_MODEL_CHANGE}
            isActiveLoading={isActiveLoading ?? false}
            modelPickerListScrollRef={listRef}
            textModelsLoading={textModelsLoading ?? false}
            isFreeTier={isFreeTier}
            imageModels={activeImageModels}
            selectedImageModels={activeSelectedImageModels}
            onSelectImageModel={onSelectImageModel ?? IGNORE_MODEL_CHANGE}
            videoModels={activeVideoModels}
            selectedVideoModels={activeSelectedVideoModels}
            onSelectVideoModel={onSelectVideoModel ?? IGNORE_MODEL_CHANGE}
            selectableTextModels={selectableTextModels}
            selectedActModel={selectedActModel}
            onToggleTextModel={onToggleTextModel}
            isFreeTierChatModelId={isFreeTierChatModelId}
            onHoveredModelChange={handleHoveredModelChange}
          />
        </PopoverContent>
      </div>
    </Popover>
  )
}

/** Video sub-mode and model picker, placed in the header or in the composer footer. */
export function ChatModelControls({
  placement = 'header',
  ...props
}: ChatExperienceHeaderProps & { placement?: 'header' | 'composer' }) {
  return (
    <>
      {props.generationMode === 'video' ? <VideoSubModePicker {...props} /> : null}
      <ChatModelPicker {...props} placement={placement} />
    </>
  )
}

function ChatHeaderControls(props: ChatExperienceHeaderProps) {
  const {
    hasAutomationContext,
    personalChatMode,
    onPersonalChatModeChange,
    appMode,
    isTemporaryChat,
    isActiveLoading,
    onTemporaryChatToggle,
    renderExportMenu,
  } = props
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto md:min-w-0 md:shrink-0 md:flex-row md:items-center md:justify-end md:gap-2">
      <div className="flex w-full min-w-0 items-center justify-between gap-2 md:contents">
        {!hasAutomationContext ? (
          <PersonalChatModeToggle
            mode={personalChatMode}
            onChange={onPersonalChatModeChange}
          />
        ) : null}
        {props.modelControlsInComposer ? null : <ChatModelControls {...props} />}
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">
          {appMode === 'chat' ? (
            <TemporaryChatButton
              active={isTemporaryChat}
              disabled={isActiveLoading}
              onClick={onTemporaryChatToggle}
            />
          ) : null}
          {renderExportMenu()}
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 md:flex">
        {appMode === 'chat' ? (
          <TemporaryChatButton
            active={isTemporaryChat}
            disabled={isActiveLoading}
            onClick={onTemporaryChatToggle}
          />
        ) : null}
        {renderExportMenu()}
      </div>
    </div>
  )
}

export function ChatExperienceHeader(props: ChatExperienceHeaderProps) {
  const {
    hideHeader = false,
    showAutomationHeaderControls,
    appMode,
    showAutomationChatTab,
  } = props
  return (
    <AppScreenHeader className={`px-3 py-2.5 md:flex-row md:items-center md:justify-between md:gap-3 md:overflow-visible md:px-4 md:py-0 ${hideHeader ? 'hidden' : ''}`}>
      <HeaderTitleSection
        activeChatId={props.activeChatId}
        editingChatId={props.editingChatId}
        editingChatTitle={props.editingChatTitle}
        onEditingChatTitleChange={props.onEditingChatTitleChange}
        onCommitChatRename={props.onCommitChatRename}
        onCancelChatRename={props.onCancelChatRename}
        headerTitleInputRef={props.headerTitleInputRef}
        showAutomationHeaderControls={props.showAutomationHeaderControls}
        titleLabel={props.titleLabel}
        onBeginHeaderChatRename={props.onBeginHeaderChatRename}
        showRenameButton={props.showRenameButton}
        projectName={props.projectName}
      />

      {showAutomationHeaderControls ? (
        <AutomationHeaderControls {...props} />
      ) : null}

      {appMode !== 'automate' && showAutomationChatTab ? (
        <ChatHeaderControls {...props} />
      ) : null}
    </AppScreenHeader>
  )
}
