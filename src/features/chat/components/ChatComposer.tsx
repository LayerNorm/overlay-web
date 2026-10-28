'use client'

/* eslint-disable react-hooks/refs */

import { ContextMeter, PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputSubmit, PromptInputTools } from '@overlay/chat-react'
import {
  AtSign,
  Brain,
  Check,
  FileText,
  Globe2,
  Image as ImageIcon,
  MousePointerClick,
  Plus,
  Slash,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { DelayedTooltip } from './DelayedTooltip'
import { MentionInput } from './chat-interface/MentionInput'
import { AgentSlashMenu } from './chat-interface/AgentSlashMenu'
import { useAgentSlashMenu } from './chat-interface/useAgentSlashMenu'
import { ReplyContextBar } from './chat-interface/ReplyContextBar'
import { ChatEmptyHero, ChatEmptyState } from './ChatEmptyState'
import { AttachmentPreviewTray, useComposerAlertToasts } from './ChatComposerAttachments'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import { toComposerViewProps, type ChatComposerProps, type ComposerViewProps } from './ChatComposerTypes'

const DOCUMENT_FILE_ACCEPT = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.html',
  '.htm',
  '.xml',
  '.log',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.yaml',
  '.yml',
  '.toml',
  '.py',
  '.go',
  '.rs',
  'text/*',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',')

const IMAGE_FILE_ACCEPT = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
].join(',')

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(avif|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(file.name)
}

const TOOL_REQUEST_OPTIONS: Array<{
  id: ChatToolRequestId
  label: string
  description: string
  Icon: LucideIcon
}> = [
  {
    id: 'web_search',
    label: 'Web Search',
    description: 'Use live web results',
    Icon: Globe2,
  },
  {
    id: 'browser',
    label: 'Computer browser',
    description: 'Browse inside your Computer',
    Icon: MousePointerClick,
  },
]

const TOOL_REQUEST_BY_ID = new Map(TOOL_REQUEST_OPTIONS.map((tool) => [tool.id, tool]))

export function ChatComposer(props: ChatComposerProps) {
  const viewProps = toComposerViewProps(props)
  useComposerAlertToasts(viewProps.composerNotice ?? null, viewProps.attachmentError ?? null)
  const disabledSend =
    !viewProps.hasComposerText &&
    viewProps.attachedImages.length === 0 &&
    !viewProps.pendingChatDocuments.some((doc) => doc.status === 'ready')

  return (
    <>
      <div
        className={`flex min-h-0 flex-col ${
          viewProps.showCenteredEmptyChat ? 'min-h-0 flex-1 md:justify-center' : 'shrink-0'
        } ${!viewProps.showCenteredEmptyChat ? 'px-3 pb-3 sm:px-4 sm:pb-4' : 'px-4 pb-4 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]'}`}
      >
        <ChatEmptyHero visible={viewProps.showCenteredEmptyChat} greetingLine={viewProps.greetingLine} />
        <div
          className={`mx-auto w-full min-w-0 shrink-0 transition-[max-width] duration-780 ease-[cubic-bezier(0.16,1,0.3,1)] max-md:order-3 ${
            viewProps.showCenteredEmptyChat ? 'max-w-xl' : 'max-w-4xl'
          }`}
        >
          {viewProps.mode === 'chat' && !viewProps.showCenteredEmptyChat ? null : null}
          {viewProps.beforeComposerContent}
          {viewProps.billingPromptContent}
          {viewProps.isSendBlocked && !viewProps.isActiveLoading && viewProps.blockedComposerContent ? (
            viewProps.blockedComposerContent
          ) : (
            <ComposerInputCard {...viewProps} disabledSend={disabledSend} />
          )}
          {viewProps.mode === 'chat' && !viewProps.showCenteredEmptyChat ? (
            <p className="mt-2 text-center text-[11px] text-(--muted-light)">
              Overlay can make mistakes. Check important info.
            </p>
          ) : null}
        </div>
        <ChatEmptyState
          visible={viewProps.showCenteredEmptyChat}
          mode={viewProps.mode}
          belowComposer={viewProps.belowEmptyComposer}
          onEmptySuggestion={viewProps.onEmptySuggestion}
          onAutomateSuggestion={viewProps.onAutomateSuggestion}
        />
      </div>
    </>
  )
}

function ComposerInputCard(props: ComposerViewProps & { disabledSend: boolean }) {
  const mixedFileInputRef = useRef<HTMLInputElement | null>(null)
  const mixedFileAccept = `${IMAGE_FILE_ACCEPT},${DOCUMENT_FILE_ACCEPT}`
  const slash = useAgentSlashMenu(props.input, props.onInputChange, props.agentCommands)

  const handleComposerKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (slash.handleKeyDown(event)) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!props.isSendBlocked && props.hasComposerText) void props.onSend()
    }
  }

  return (
    <PromptInput>
      {props.replyContext && <ReplyContextBar replyContext={props.replyContext} setReplyContext={props.setReplyContext} />}
      <PromptInputBody>
        {slash.open ? (
          <AgentSlashMenu
            commands={slash.commands}
            highlightedIndex={slash.index}
            onSelect={slash.select}
          />
        ) : null}
        <AttachmentPreviewTray {...props} />
        {/* eslint-disable-next-line no-restricted-syntax -- overlay:raw-control: Native file picker exposes the browser FileList. */}
        <input ref={props.fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => event.target.files && props.onAddImages(event.target.files)} />
        {/* eslint-disable-next-line no-restricted-syntax -- overlay:raw-control: Native file picker exposes the browser FileList. */}
        <input
          ref={mixedFileInputRef}
          type="file"
          accept={mixedFileAccept}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            const imageFiles = files.filter(isImageFile)
            const documentFiles = files.filter((file) => !isImageFile(file))
            if (imageFiles.length > 0) props.onAddImages(imageFiles)
            if (documentFiles.length > 0) props.onAddDocumentsFromPicker(documentFiles)
            event.target.value = ''
          }}
        />
        {/* eslint-disable-next-line no-restricted-syntax -- overlay:raw-control: Native file picker exposes the browser FileList. */}
        <input
          ref={props.docInputRef}
          type="file"
          accept={DOCUMENT_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            props.onAddDocumentsFromPicker(event.target.files)
            event.target.value = ''
          }}
        />
        <MentionInput
          ref={props.textareaRef}
          value={props.input}
          valueRevision={props.inputRevision}
          onChange={props.onInputChange}
          onMentionsChange={props.onMentionsChange}
          onPaste={props.onPaste}
          onUploadFile={() => props.docInputRef.current?.click()}
          mentionCategories={props.mentionCategories}
          placeholder={composerPlaceholder(props)}
          className={undefined}
          onKeyDown={handleComposerKeyDown}
        />
        <ComposerControls
          {...props}
          mixedFileInputRef={mixedFileInputRef}
        />
      </PromptInputBody>
    </PromptInput>
  )
}


type ComposerControlsProps = ComposerViewProps & {
  disabledSend: boolean
  mixedFileInputRef: RefObject<HTMLInputElement | null>
}

function ComposerControls(props: ComposerControlsProps) {
  const mentionTooltip = mentionReferenceLabel(props)
  const hasAgentCommands = Boolean(props.agentCommands?.length)
  return (
    <PromptInputFooter>
      {props.textOnly ? null : <AttachMenu {...props} />}
      {props.textOnly ? null : <DelayedTooltip label={mentionTooltip} side="top">
        <PromptInputButton onClick={() => props.textareaRef.current?.openMentionPopup()} aria-label="Insert mention">
          <AtSign size={16} strokeWidth={1.75} />
        </PromptInputButton>
      </DelayedTooltip>}
      {hasAgentCommands ? (
        <DelayedTooltip label="Agent slash commands" side="top">
          <PromptInputButton
            onClick={() => {
              if (!props.hasComposerText) props.onInputChange('/')
              props.textareaRef.current?.focus()
            }}
            aria-label="Agent slash commands"
          >
            <Slash size={16} strokeWidth={1.75} />
          </PromptInputButton>
        </DelayedTooltip>
      ) : null}
      <PromptInputTools>
        {props.capabilities.memory && props.capabilities.vectorSearch && !props.memoryEnabled && (
          <DelayedTooltip label="Memory is off for this message." side="top">
            <div className="shrink-0">
              <ToolRequestChip
                label="Memory: OFF"
                Icon={Brain}
                onClear={props.onToggleMemory}
              />
            </div>
          </DelayedTooltip>
        )}
        {props.selectedToolIds.filter((toolId) => isToolRequestEnabled(toolId, props)).map((toolId) => {
          const tool = TOOL_REQUEST_BY_ID.get(toolId)
          if (!tool) return null
          return (
            <ToolRequestChip
              key={toolId}
              label={tool.label}
              Icon={tool.Icon}
              onClear={() => props.onRemoveTool(toolId)}
            />
          )
        })}
        {props.generationChip && <GenerationChip chip={props.generationChip} onClear={() => props.setGenerationChip(null)} />}
      </PromptInputTools>
      {props.contextUsage ? <ContextMeter {...props.contextUsage} /> : null}
      {props.modelControl}
      <DelayedTooltip label={props.isActiveLoading ? 'Stop generating' : 'Send (↵) · new line (⇧↵)'} side="top">
        <PromptInputSubmit
          status={props.isActiveLoading ? 'streaming' : 'ready'}
          onStop={() => void props.onStop()}
          onClick={() => void props.onSend()}
          disabled={props.disabledSend || props.isSendBlocked}
        />
      </DelayedTooltip>
    </PromptInputFooter>
  )
}

function mentionReferenceLabel(props: Pick<ComposerViewProps, 'capabilities' | 'mentionCategories'>): string {
  const { capabilities, mentionCategories } = props
  const targets = [
    mentionCategories?.some((category) => category.type === 'person') ? 'members' : null,
    capabilities.files ? 'files' : null,
    capabilities.knowledge ? 'knowledge bases' : null,
    capabilities.skills ? 'skills' : null,
    capabilities.automations ? 'automations' : null,
    capabilities.mcpServers ? 'MCP servers' : null,
    capabilities.integrations ? 'connectors' : null,
    capabilities.chat ? 'chats' : null,
  ].filter(Boolean)
  return `Reference ${targets.length > 0 ? targets.join(', ') : 'context'}`
}

function composerPlaceholder(props: ComposerViewProps): string {
  if (props.placeholder) return props.placeholder
  return 'What do you want to get done?'
}

function AttachMenu(props: ComposerViewProps & { mixedFileInputRef: RefObject<HTMLInputElement | null> }) {
  const [menuDirection, setMenuDirection] = useState<'up' | 'down'>('up')

  function handleToggle(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    setMenuDirection(spaceBelow < 340 && spaceAbove > spaceBelow ? 'up' : 'down')
    props.setShowAttachMenu((value) => !value)
  }

  const selectedToolIdSet = new Set(props.selectedToolIds)

  return (
    <div ref={props.attachMenuRef} className="relative shrink-0">
      <DelayedTooltip label="Attach files or choose tools" side="top">
        <PromptInputButton onClick={handleToggle} aria-label="Open attachment and tools menu">
          <Plus size={18} strokeWidth={1.75} />
        </PromptInputButton>
      </DelayedTooltip>
      {props.showAttachMenu && (
        <div className={`absolute left-0 z-20 w-64 rounded-xl border border-(--border) bg-(--surface-elevated) py-1 shadow-lg ${menuDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
          {props.capabilities.files && (
            <AttachMenuButton
              onClick={() => {
                props.mixedFileInputRef.current?.click()
                props.setShowAttachMenu(false)
              }}
              icon={<FileText size={13} strokeWidth={1.75} />}
              label="Attach photos and files"
              suffix="Images, docs"
            />
          )}
          {TOOL_REQUEST_OPTIONS.filter((tool) => isToolRequestEnabled(tool.id, props)).map((tool) => {
            const active = selectedToolIdSet.has(tool.id)
            const Icon = tool.Icon
            return (
              <AttachMenuButton
                key={tool.id}
                active={active}
                onClick={() => {
                  props.onToggleTool(tool.id)
                  props.setShowAttachMenu(false)
                }}
                icon={<Icon size={13} strokeWidth={1.75} />}
                label={tool.label}
                suffix={active ? undefined : tool.description}
                checked={active}
              />
            )
          })}
          <AttachMenuButton onClick={() => { props.onModeChange('image'); props.setShowAttachMenu(false) }} icon={<ImageIcon size={13} className="text-(--foreground)" />} label="Generate images" />
          <AttachMenuButton onClick={() => { props.onModeChange('video'); props.setShowAttachMenu(false) }} icon={<Video size={13} className="text-(--foreground)" />} label="Generate videos" />
          {props.capabilities.memory && props.capabilities.vectorSearch && (
            <>
              <div className="my-1 border-t border-(--border)" />
              <AttachMenuButton
                active={props.memoryEnabled}
                onClick={() => {
                  props.onToggleMemory()
                  props.setShowAttachMenu(false)
                }}
                icon={<Brain size={13} strokeWidth={1.75} />}
                label="Memory"
                showSwitch
                neutralWhenActive
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function isToolRequestEnabled(
  toolId: ChatToolRequestId,
  props: Pick<ComposerViewProps, 'capabilities'>,
): boolean {
  if (toolId === 'web_search') return props.capabilities.webSearch
  if (toolId === 'browser') return props.capabilities.computers
  if (toolId === 'memory') return props.capabilities.memory && props.capabilities.vectorSearch
  return true
}

function AttachMenuButton({
  active,
  disabled,
  title,
  onClick,
  icon,
  label,
  suffix,
  showSwitch,
  checked,
  neutralWhenActive,
}: {
  active?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  icon: ReactNode
  label: string
  suffix?: string
  showSwitch?: boolean
  checked?: boolean
  neutralWhenActive?: boolean
}) {
  const activeClass = active && !neutralWhenActive
    ? 'bg-(--surface-muted) text-(--foreground)'
    : 'text-(--muted) hover:bg-(--surface-muted) hover:text-(--foreground)'

  return (
    <Button variant="ghost" type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={active} className={`h-auto w-full justify-start gap-2.5 px-3 py-2 text-xs font-normal transition-colors ${disabled ? 'cursor-not-allowed text-[#bbb]' : activeClass}`}>
      {icon}
      <span>{label}</span>
      {showSwitch ? (
        <span className={`ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${active ? 'bg-(--muted)' : 'bg-(--border)'}`}>
          <span className={`h-3 w-3 rounded-full bg-(--surface-elevated) transition-transform ${active ? 'translate-x-3' : ''}`} />
        </span>
      ) : checked ? (
        <Check size={11} strokeWidth={1.8} className="ml-auto shrink-0 text-(--foreground)" />
      ) : suffix ? (
        <span className="ml-auto max-w-27 truncate text-[10px] text-(--muted-light)">{suffix}</span>
      ) : null}
    </Button>
  )
}

function ToolRequestChip({
  label,
  Icon,
  onClear,
}: {
  label: string
  Icon: LucideIcon
  onClear: () => void
}) {
  return (
    <div className="group flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--surface-subtle) px-2 text-xs font-medium text-(--foreground)">
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onClear}
        className="relative h-4 w-4 shrink-0 rounded-full p-0 text-(--muted) transition-colors hover:bg-(--border) hover:text-(--foreground)"
        aria-label={`Remove ${label}`}
      >
        <Icon size={11} strokeWidth={1.75} className="absolute opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
        <X size={10} strokeWidth={1.8} className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
      </Button>
      <span>{label}</span>
    </div>
  )
}

function GenerationChip({ chip, onClear }: { chip: 'image' | 'video'; onClear: () => void }) {
  return (
    <div className="group flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-(--foreground) px-2 text-xs font-medium text-(--background)">
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onClear}
        className="relative h-4 w-4 shrink-0 rounded-full p-0 text-current transition-opacity hover:bg-transparent hover:text-current hover:opacity-75"
        aria-label={`Remove ${chip === 'image' ? 'image' : 'video'} mode`}
      >
        {chip === 'image' ? (
          <ImageIcon size={10} className="absolute opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
        ) : (
          <Video size={10} className="absolute opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
        )}
        <X size={9} className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
      </Button>
      {chip === 'image' ? 'Image' : 'Video'}
    </div>
  )
}
