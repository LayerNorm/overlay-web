'use client'

import {
  Suspense,
  type MouseEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
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
import { DelayedTooltip } from '@overlay/ui/overlays'
import { AppScreenHeader } from '@overlay/modules-react/shell'
import { ModelBadges } from './ModelIndicators'
import { ModelQualitiesPanel } from './ModelQualitiesPanel'

const TEMPORARY_CHAT_ICON_SRC = '/assets/icons/dashed-chat.png'

const AUTOMATION_DETAIL_TABS = [
  { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
  { id: 'edit' as const, label: 'Edit', icon: SlidersHorizontal },
]

export type AutomationDetailTabId = (typeof AUTOMATION_DETAIL_TABS)[number]['id']

export type AskModelSelectionMode = 'single' | 'multiple'

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
      <button
        type="button"
        aria-pressed={active}
        aria-label={active ? 'Disable temporary chat' : 'Enable temporary chat'}
        disabled={disabled}
        onClick={onClick}
        className={`flex h-8 min-h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,box-shadow,color] duration-300 ${
          active
            ? 'temporary-chat-inverse-surface border-dashed border-[var(--temporary-chat-border)] shadow-sm'
            : 'border-transparent bg-[var(--surface-subtle)] text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)]'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span
          aria-hidden
          className="size-4 bg-current"
          style={{
            WebkitMask: `url(${TEMPORARY_CHAT_ICON_SRC}) center / contain no-repeat`,
            mask: `url(${TEMPORARY_CHAT_ICON_SRC}) center / contain no-repeat`,
          }}
        />
      </button>
    </DelayedTooltip>
  )
}

function PremiumModelsLoadingRows({ divider = false }: { divider?: boolean }) {
  return (
    <div
      className={divider ? 'mt-1 border-t border-[var(--border)]' : ''}
      role="status"
      aria-label="Loading premium models"
    >
      <div className="px-3 pb-1 pt-2 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--muted-light)]">
        Premium
      </div>
      <div className="space-y-1 px-3 pb-2 pt-1" aria-hidden>
        {[72, 58, 66].map((width) => (
          <div key={width} className="flex h-7 items-center gap-2">
            <span className="ui-skeleton-line h-2.5 w-[10px] rounded" />
            <span className="ui-skeleton-line h-3 rounded" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export interface ChatExperienceHeaderProps {
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
  imageModelSelectionMode: AskModelSelectionMode
  onToggleImageModel: (modelId: string) => void
  onImageModelSelectionModeChange: (mode: AskModelSelectionMode) => void
  videoModels: VideoModel[]
  selectedVideoModels: string[]
  videoModelSelectionMode: AskModelSelectionMode
  onToggleVideoModel: (modelId: string) => void
  onVideoModelSelectionModeChange: (mode: AskModelSelectionMode) => void
  selectableTextModels: ChatModel[]
  textModelsLoading: boolean
  askModelSelectionMode: AskModelSelectionMode
  selectedActModel: string
  selectedModels: string[]
  onToggleTextModel: (modelId: string) => void
  onTextModelSelectionModeChange: (mode: AskModelSelectionMode) => void
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
        <input
          ref={headerTitleInputRef}
          aria-label="Conversation title"
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm font-medium text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)] md:max-w-[min(100%,20rem)] lg:max-w-[24rem]"
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
            className="min-w-0 flex-1 text-sm font-medium leading-snug text-[var(--foreground)] md:max-w-[20rem] md:truncate lg:max-w-[24rem]"
            title={titleLabel}
          >
            <CrossfadeText text={titleLabel} className="line-clamp-2 md:line-clamp-1 md:truncate" />
          </h2>
          {showRenameButton ? (
            <button
              type="button"
              onClick={onBeginHeaderChatRename}
              className="shrink-0 rounded p-1 text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--border)] hover:text-[var(--foreground)] group-hover/header-title:opacity-100 focus-visible:opacity-100"
              aria-label="Rename chat"
            >
              <Pencil size={14} />
            </button>
          ) : null}
        </div>
      )}
      {projectName ? (
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          <FolderOpen size={9} />
          <span className="max-w-[6rem] truncate sm:max-w-none">{projectName}</span>
        </span>
      ) : null}
    </div>
  )
}

function ModelQualitiesHoverCard({
  modelId,
  position,
  resolveModel,
  reasoning,
  onReasoningChange,
  onHoveredModelChange,
}: {
  modelId: string
  position: ModelQualitiesPosition
  resolveModel: (modelId: string) => ChatModel | undefined
  reasoning?: ReasoningLevel
  onReasoningChange?: (level: ReasoningLevel | undefined) => void
  onHoveredModelChange: (modelId: string | null, position: ModelQualitiesPosition | null) => void
}) {
  return (
    <div
      className="fixed z-[100] hidden w-56 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 shadow-md md:block"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(calc(-100% - 8px), -50%)',
      }}
      onMouseEnter={() => onHoveredModelChange(modelId, position)}
      onMouseLeave={() => onHoveredModelChange(null, null)}
    >
      <Suspense fallback={null}>
        <ModelQualitiesPanel
          model={resolveModel(modelId)}
          reasoning={reasoning}
          onReasoningChange={onReasoningChange}
        />
      </Suspense>
    </div>
  )
}

function ModelGroupDivider({ label }: { label: string }) {
  return (
    <div className="mt-1 border-t border-[var(--border)] px-3 pb-1 pt-2 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--muted-light)]">
      {label}
    </div>
  )
}

function modelGroupDividerLabel({
  isFreeTier,
  isFreeModelRow,
  previousIsFreeModelRow,
  textModelsLoading,
  index,
}: {
  isFreeTier: boolean
  isFreeModelRow: boolean
  previousIsFreeModelRow: boolean
  textModelsLoading: boolean
  index: number
}): 'Premium' | 'Free' | null {
  const showFreeTierGroupDivider = isFreeTier && !isFreeModelRow && previousIsFreeModelRow
  const showFreeGroupDivider =
    !isFreeTier &&
    isFreeModelRow &&
    (!previousIsFreeModelRow || (textModelsLoading && index === 0))
  if (showFreeTierGroupDivider) return 'Premium'
  if (showFreeGroupDivider) return 'Free'
  return null
}

function ModelPickerRow({
  modelId,
  name,
  selected,
  disabled = false,
  onSelect,
  onHoverStart,
  badges,
}: {
  modelId: string
  name: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  onHoverStart?: MouseEventHandler<HTMLButtonElement>
  badges?: ReactNode
}) {
  return (
    <button
      type="button"
      data-model-row={onHoverStart ? modelId : undefined}
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={onHoverStart}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-[var(--surface-muted)]'
      } ${selected ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
    >
      <span className="flex items-center gap-2">
        {selected ? <Check size={10} /> : <span className="inline-block w-[10px]" />}
        {name}
      </span>
      {badges}
    </button>
  )
}

function MediaModelList({
  models,
  selectedModelIds,
  selectionMode,
  onToggleModel,
}: {
  models: { id: string; name: string }[]
  selectedModelIds: string[]
  selectionMode: AskModelSelectionMode
  onToggleModel: (modelId: string) => void
}) {
  return (
    <>
      {models.map((m) => {
        const isSel = selectedModelIds.includes(m.id)
        const isDisabled =
          selectionMode === 'multiple' && !isSel && selectedModelIds.length >= 4
        return (
          <ModelPickerRow
            key={m.id}
            modelId={m.id}
            name={m.name}
            selected={isSel}
            disabled={isDisabled}
            onSelect={() => onToggleModel(m.id)}
          />
        )
      })}
    </>
  )
}

function TextModelRows({
  models,
  isFreeTier,
  isFreeTierChatModelId,
  textModelsLoading,
  onHoveredModelChange,
  isSelected,
  isDisabled,
  onSelect,
}: {
  models: ChatModel[]
  isFreeTier: boolean
  isFreeTierChatModelId: (modelId: string) => boolean
  textModelsLoading: boolean
  onHoveredModelChange: (modelId: string | null, position: ModelQualitiesPosition | null) => void
  isSelected: (model: ChatModel) => boolean
  isDisabled: (model: ChatModel, selected: boolean) => boolean
  onSelect: (model: ChatModel) => void
}) {
  return (
    <>
      {models.map((m, index, allModels) => {
        const isSel = isSelected(m)
        const dividerLabel = modelGroupDividerLabel({
          isFreeTier,
          isFreeModelRow: isFreeTierChatModelId(m.id),
          previousIsFreeModelRow: index > 0 ? isFreeTierChatModelId(allModels[index - 1].id) : false,
          textModelsLoading,
          index,
        })
        return (
          <div key={m.id}>
            {dividerLabel ? <ModelGroupDivider label={dividerLabel} /> : null}
            <ModelPickerRow
              modelId={m.id}
              name={m.name}
              selected={isSel}
              disabled={isDisabled(m, isSel)}
              onSelect={() => onSelect(m)}
              onHoverStart={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                onHoveredModelChange(m.id, { x: r.left - 8, y: r.top + r.height / 2 })
              }}
              badges={<ModelBadges model={m} />}
            />
          </div>
        )
      })}
    </>
  )
}

function ModelSelectionModeButtons({
  selectionMode,
  onSelectionModeChange,
  isModeDisabled,
}: {
  selectionMode: AskModelSelectionMode
  onSelectionModeChange: (mode: AskModelSelectionMode) => void
  isModeDisabled: (mode: AskModelSelectionMode) => boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface-subtle)] p-0.5">
      {(['single', 'multiple'] as const).map((selMode) => {
        const isActive = selectionMode === selMode
        const disabled = isModeDisabled(selMode)
        return (
          <button
            key={selMode}
            type="button"
            onClick={() => onSelectionModeChange(selMode)}
            disabled={disabled}
            className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
              isActive
                ? 'bg-[var(--surface-elevated)] font-medium text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {selMode}
          </button>
        )
      })}
    </div>
  )
}

function AutomationModelPicker({
  modelPickerRef,
  onToggleModelPicker,
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
  isFreeTierChatModelId,
  onSaveAutomationHeaderModel,
  onSetShowModelPicker,
}: Pick<ChatExperienceHeaderProps,
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
  | 'isFreeTierChatModelId'
  | 'onSaveAutomationHeaderModel'
  | 'onSetShowModelPicker'
>) {
  return (
    <div ref={modelPickerRef} data-tour="model-picker" className="relative min-w-0 flex-1 md:w-auto md:flex-none">
      <DelayedTooltip label="Choose automation model" side="bottom">
        <button
          type="button"
          onClick={onToggleModelPicker}
          className="flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 py-0 text-left text-xs leading-none text-[var(--muted)] hover:bg-[var(--border)] disabled:cursor-default disabled:opacity-70 md:w-auto md:max-w-[13rem]"
          aria-label="Automation model"
        >
          <span className="min-w-0 truncate">{getChatModelDisplayName(automationHeaderModelId) || 'Select model'}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
      </DelayedTooltip>
      {showModelPicker ? (
        <>
          {hoveredModelId && modelQualitiesPos ? (
            <ModelQualitiesHoverCard
              modelId={hoveredModelId}
              position={modelQualitiesPos}
              resolveModel={resolveModel}
              reasoning={reasoning}
              onReasoningChange={onReasoningChange}
              onHoveredModelChange={onHoveredModelChange}
            />
          ) : null}
          <div
            data-tour="model-picker"
            className="overlay-pop-in absolute left-0 right-0 top-full z-20 mt-1 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg md:left-auto md:right-0 md:w-64 md:max-w-none"
          >
            <div ref={modelPickerListScrollRef} className="max-h-72 overflow-y-auto">
              {textModelsLoading && !isFreeTier ? <PremiumModelsLoadingRows /> : null}
              <TextModelRows
                models={automationHeaderModels}
                isFreeTier={isFreeTier}
                isFreeTierChatModelId={isFreeTierChatModelId}
                textModelsLoading={textModelsLoading}
                onHoveredModelChange={onHoveredModelChange}
                isSelected={(m) => m.id === automationHeaderModelId}
                isDisabled={() => false}
                onSelect={(m) => {
                  void onSaveAutomationHeaderModel(m.id)
                  onSetShowModelPicker(false)
                }}
              />
              {textModelsLoading && isFreeTier ? <PremiumModelsLoadingRows divider /> : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function AutomationDetailTabButtons({
  automationDetailTab,
  onSelectAutomationDetailTab,
}: Pick<ChatExperienceHeaderProps, 'automationDetailTab' | 'onSelectAutomationDetailTab'>) {
  return (
    <div className="flex h-8 shrink-0 items-center rounded-lg bg-[var(--surface-subtle)] p-0.5">
      {AUTOMATION_DETAIL_TABS.map((tab) => {
        const active = automationDetailTab === tab.id
        const TabIcon = tab.icon
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectAutomationDetailTab(tab.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
              active
                ? 'bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]'
            }`}
          >
            <TabIcon size={12} strokeWidth={1.75} />
            {tab.label}
          </button>
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
      <button
        type="button"
        onClick={onToggleVideoSubModePicker}
        disabled={isActiveLoading}
        className={`flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 py-0 text-left text-xs leading-none md:w-auto md:max-w-[13rem] ${
          isActiveLoading ? 'cursor-not-allowed text-[var(--muted-light)]' : 'text-[var(--muted)] hover:bg-[var(--border)]'
        }`}
      >
        <span className="min-w-0 truncate">{VIDEO_SUB_MODE_LABELS[videoSubMode]}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      {showVideoSubModePicker ? (
        <div className="overlay-pop-in absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg md:left-auto md:right-0 md:w-52">
          {VIDEO_SUB_MODES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                onVideoSubModeChange(value)
                onSetShowVideoSubModePicker(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-muted)] ${videoSubMode === value ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
            >
              {videoSubMode === value ? <Check size={10} /> : <span className="inline-block w-[10px]" />}
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ChatModelPickerDropdown({
  generationMode,
  onGenerationModeChange,
  isActiveLoading,
  modelPickerListScrollRef,
  textModelsLoading,
  isFreeTier,
  imageModels,
  selectedImageModels,
  imageModelSelectionMode,
  onToggleImageModel,
  onImageModelSelectionModeChange,
  videoModels,
  selectedVideoModels,
  videoModelSelectionMode,
  onToggleVideoModel,
  onVideoModelSelectionModeChange,
  selectableTextModels,
  askModelSelectionMode,
  selectedActModel,
  selectedModels,
  onToggleTextModel,
  onTextModelSelectionModeChange,
  isFreeTierChatModelId,
  onHoveredModelChange,
  hasAutomationContext,
}: Pick<ChatExperienceHeaderProps,
  | 'generationMode'
  | 'onGenerationModeChange'
  | 'isActiveLoading'
  | 'modelPickerListScrollRef'
  | 'textModelsLoading'
  | 'isFreeTier'
  | 'imageModels'
  | 'selectedImageModels'
  | 'imageModelSelectionMode'
  | 'onToggleImageModel'
  | 'onImageModelSelectionModeChange'
  | 'videoModels'
  | 'selectedVideoModels'
  | 'videoModelSelectionMode'
  | 'onToggleVideoModel'
  | 'onVideoModelSelectionModeChange'
  | 'selectableTextModels'
  | 'askModelSelectionMode'
  | 'selectedActModel'
  | 'selectedModels'
  | 'onToggleTextModel'
  | 'onTextModelSelectionModeChange'
  | 'isFreeTierChatModelId'
  | 'onHoveredModelChange'
  | 'hasAutomationContext'
>) {
  return (
    <div
      data-tour="model-picker"
      className="overlay-pop-in absolute left-0 right-0 top-full z-20 mt-1 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg md:left-auto md:right-0 md:w-64 md:max-w-none"
    >
      <div className="border-b border-[var(--border)] px-2 pb-2 pt-1">
        <DelayedTooltip
          label="Cycle text / image / video (⇧⌘.)"
          side="left"
          className="block w-full"
        >
          <span data-tour="generation-mode-toggle" className="block w-full">
            <GenerationModeToggle
              mode={generationMode}
              onChange={onGenerationModeChange}
              disabled={isActiveLoading}
              layout="stretch"
            />
          </span>
        </DelayedTooltip>
      </div>
      <div ref={modelPickerListScrollRef} className="max-h-72 overflow-y-auto">
        {generationMode === 'text' && textModelsLoading && !isFreeTier ? (
          <PremiumModelsLoadingRows />
        ) : null}
        {generationMode === 'image' ? (
          <MediaModelList
            models={imageModels}
            selectedModelIds={selectedImageModels}
            selectionMode={imageModelSelectionMode}
            onToggleModel={onToggleImageModel}
          />
        ) : generationMode === 'video' ? (
          <MediaModelList
            models={videoModels}
            selectedModelIds={selectedVideoModels}
            selectionMode={videoModelSelectionMode}
            onToggleModel={onToggleVideoModel}
          />
        ) : (
          <TextModelRows
            models={selectableTextModels}
            isFreeTier={isFreeTier}
            isFreeTierChatModelId={isFreeTierChatModelId}
            textModelsLoading={textModelsLoading}
            onHoveredModelChange={onHoveredModelChange}
            isSelected={(m) =>
              askModelSelectionMode === 'single'
                ? m.id === selectedActModel
                : selectedModels.includes(m.id)
            }
            isDisabled={(m, isSel) =>
              askModelSelectionMode === 'multiple' && !isSel && selectedModels.length >= 4
            }
            onSelect={(m) => onToggleTextModel(m.id)}
          />
        )}
        {generationMode === 'text' && textModelsLoading && isFreeTier ? (
          <PremiumModelsLoadingRows divider />
        ) : null}
      </div>
      {generationMode === 'image' ? (
        <div className="border-t border-[var(--border)] px-2 py-2">
          <ModelSelectionModeButtons
            selectionMode={imageModelSelectionMode}
            onSelectionModeChange={onImageModelSelectionModeChange}
            isModeDisabled={(mode) => isActiveLoading || (isFreeTier && mode === 'multiple')}
          />
        </div>
      ) : null}
      {generationMode === 'video' ? (
        <div className="border-t border-[var(--border)] px-2 py-2">
          <ModelSelectionModeButtons
            selectionMode={videoModelSelectionMode}
            onSelectionModeChange={onVideoModelSelectionModeChange}
            isModeDisabled={(mode) => isActiveLoading || (isFreeTier && mode === 'multiple')}
          />
        </div>
      ) : null}
      {generationMode === 'text' && !hasAutomationContext ? (
        <div className="border-t border-[var(--border)] px-2 py-2">
          <ModelSelectionModeButtons
            selectionMode={askModelSelectionMode}
            onSelectionModeChange={onTextModelSelectionModeChange}
            isModeDisabled={(mode) => isFreeTier && mode === 'multiple'}
          />
        </div>
      ) : null}

    </div>
  )
}

function ChatModelPicker({
  modelPickerRef,
  onToggleModelPicker,
  modelPickerLabel,
  showModelPicker,
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
  imageModelSelectionMode,
  onToggleImageModel,
  onImageModelSelectionModeChange,
  videoModels,
  selectedVideoModels,
  videoModelSelectionMode,
  onToggleVideoModel,
  onVideoModelSelectionModeChange,
  selectableTextModels,
  askModelSelectionMode,
  selectedActModel,
  selectedModels,
  onToggleTextModel,
  onTextModelSelectionModeChange,
  isFreeTierChatModelId,
  hasAutomationContext,
}: Pick<ChatExperienceHeaderProps,
  | 'modelPickerRef'
  | 'onToggleModelPicker'
  | 'modelPickerLabel'
  | 'showModelPicker'
  | 'generationMode'
  | 'hoveredModelId'
  | 'modelQualitiesPos'
  | 'onHoveredModelChange'
  | 'resolveModel'
  | 'reasoning'
  | 'onReasoningChange'
  | 'onGenerationModeChange'
  | 'isActiveLoading'
  | 'modelPickerListScrollRef'
  | 'textModelsLoading'
  | 'isFreeTier'
  | 'imageModels'
  | 'selectedImageModels'
  | 'imageModelSelectionMode'
  | 'onToggleImageModel'
  | 'onImageModelSelectionModeChange'
  | 'videoModels'
  | 'selectedVideoModels'
  | 'videoModelSelectionMode'
  | 'onToggleVideoModel'
  | 'onVideoModelSelectionModeChange'
  | 'selectableTextModels'
  | 'askModelSelectionMode'
  | 'selectedActModel'
  | 'selectedModels'
  | 'onToggleTextModel'
  | 'onTextModelSelectionModeChange'
  | 'isFreeTierChatModelId'
  | 'hasAutomationContext'
>) {
  return (
    <div ref={modelPickerRef} data-tour="model-picker" className="relative min-w-0 flex-1 md:w-auto md:flex-none">
      <DelayedTooltip label="Choose model (⇧⌘/)" side="bottom">
        <button
          type="button"
          onClick={onToggleModelPicker}
          className="flex h-8 min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] px-2.5 py-0 text-left text-xs leading-none text-[var(--muted)] hover:bg-[var(--border)] md:w-auto md:max-w-[13rem]"
        >
          <span className="min-w-0 truncate">{modelPickerLabel}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
      </DelayedTooltip>
      {showModelPicker ? (
        <>
          {generationMode === 'text' && hoveredModelId && modelQualitiesPos ? (
            <ModelQualitiesHoverCard
              modelId={hoveredModelId}
              position={modelQualitiesPos}
              resolveModel={resolveModel}
              reasoning={reasoning}
              onReasoningChange={onReasoningChange}
              onHoveredModelChange={onHoveredModelChange}
            />
          ) : null}
          <ChatModelPickerDropdown
            generationMode={generationMode}
            onGenerationModeChange={onGenerationModeChange}
            isActiveLoading={isActiveLoading}
            modelPickerListScrollRef={modelPickerListScrollRef}
            textModelsLoading={textModelsLoading}
            isFreeTier={isFreeTier}
            imageModels={imageModels}
            selectedImageModels={selectedImageModels}
            imageModelSelectionMode={imageModelSelectionMode}
            onToggleImageModel={onToggleImageModel}
            onImageModelSelectionModeChange={onImageModelSelectionModeChange}
            videoModels={videoModels}
            selectedVideoModels={selectedVideoModels}
            videoModelSelectionMode={videoModelSelectionMode}
            onToggleVideoModel={onToggleVideoModel}
            onVideoModelSelectionModeChange={onVideoModelSelectionModeChange}
            selectableTextModels={selectableTextModels}
            askModelSelectionMode={askModelSelectionMode}
            selectedActModel={selectedActModel}
            selectedModels={selectedModels}
            onToggleTextModel={onToggleTextModel}
            onTextModelSelectionModeChange={onTextModelSelectionModeChange}
            isFreeTierChatModelId={isFreeTierChatModelId}
            onHoveredModelChange={onHoveredModelChange}
            hasAutomationContext={hasAutomationContext}
          />
        </>
      ) : null}
    </div>
  )
}

function ChatHeaderControls(props: ChatExperienceHeaderProps) {
  const {
    hasAutomationContext,
    personalChatMode,
    onPersonalChatModeChange,
    generationMode,
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
        {generationMode === 'video' ? (
          <VideoSubModePicker {...props} />
        ) : null}
        <ChatModelPicker {...props} />
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
