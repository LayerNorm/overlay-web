'use client'

/* eslint-disable react-hooks/refs */

import {
  AtSign,
  Brain,
  Check,
  FileText,
  Globe2,
  Image as ImageIcon,
  MousePointerClick,
  Plus,
  Reply,
  Send,
  SquareTerminal,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { DelayedTooltip } from './DelayedTooltip'
import { MentionInput } from './chat-interface/MentionInput'
import { AgentSlashMenu } from './chat-interface/AgentSlashMenu'
import { ChatEmptyHero, ChatEmptyState } from './ChatEmptyState'
import { AttachmentPreviewTray, ComposerAlerts } from './ChatComposerAttachments'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import type { RemoteAgentCommand } from './collaboration/room-message-view'
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
    label: 'Browser Use',
    description: 'Drive a real browser',
    Icon: MousePointerClick,
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    description: 'Run code or commands',
    Icon: SquareTerminal,
  },
]

const TOOL_REQUEST_BY_ID = new Map(TOOL_REQUEST_OPTIONS.map((tool) => [tool.id, tool]))

export function ChatComposer(props: ChatComposerProps) {
  const viewProps = toComposerViewProps(props)
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
          className={`mx-auto w-full min-w-0 shrink-0 transition-[max-width] duration-[780ms] ease-[cubic-bezier(0.16,1,0.3,1)] max-md:order-3 ${
            viewProps.showCenteredEmptyChat ? 'max-w-[36rem]' : 'max-w-[56rem]'
          }`}
        >
          {viewProps.mode === 'chat' && !viewProps.showCenteredEmptyChat ? null : null}
          <ComposerAlerts attachmentError={viewProps.attachmentError} composerNotice={viewProps.composerNotice} />
          {viewProps.beforeComposerContent}
          {viewProps.billingPromptContent}
          {viewProps.isSendBlocked && !viewProps.isActiveLoading && viewProps.blockedComposerContent ? (
            viewProps.blockedComposerContent
          ) : (
            <ComposerInputCard {...viewProps} disabledSend={disabledSend} />
          )}
          {viewProps.mode === 'chat' && !viewProps.showCenteredEmptyChat ? (
            <p className="mt-2 text-center text-[11px] text-[var(--muted-light)]">
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
  const slashToken = props.input.startsWith('/') && !/\s/.test(props.input)
    ? props.input.slice(1).toLowerCase()
    : null
  const slashCommands = useMemo(() => {
    if (slashToken === null) return []
    const advertised = props.agentCommands ?? []
    const matched = advertised.filter((command) => command.name.toLowerCase().startsWith(slashToken))
    if (matched.length > 0) return matched
    return slashToken.length === 0 ? advertised : []
  }, [props.agentCommands, slashToken])
  const [slash, setSlash] = useState({ index: 0, dismissedFor: null as string | null })
  const slashIndex = Math.min(slash.index, Math.max(slashCommands.length - 1, 0))
  const slashOpen = slashToken !== null && slashCommands.length > 0 && slash.dismissedFor !== props.input

  const selectSlashCommand = (command: RemoteAgentCommand) => {
    props.onInputChange(`/${command.name} `)
    setSlash({ index: 0, dismissedFor: null })
  }

  const handleComposerKeyDown = (event: ReactKeyboardEvent) => {
    if (slashOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlash((current) => ({ ...current, index: Math.min(current.index + 1, slashCommands.length - 1) }))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlash((current) => ({ ...current, index: Math.max(current.index - 1, 0) }))
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const command = slashCommands[slashIndex]
        if (command) selectSlashCommand(command)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlash({ index: 0, dismissedFor: props.input })
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void props.onSend()
    }
  }

  return (
    <div className="overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[background-color,border-color,box-shadow,color] duration-300">
      {props.replyContext && <ReplyContextBar replyContext={props.replyContext} setReplyContext={props.setReplyContext} />}
      <div className="relative p-2.5 sm:p-3">
        {slashOpen ? (
          <AgentSlashMenu
            commands={slashCommands}
            highlightedIndex={slashIndex}
            onSelect={selectSlashCommand}
          />
        ) : null}
        <AttachmentPreviewTray {...props} />
        <input ref={props.fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => event.target.files && props.onAddImages(event.target.files)} />
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
      </div>
    </div>
  )
}

function ReplyContextBar({ replyContext, setReplyContext }: Pick<ComposerViewProps, 'replyContext' | 'setReplyContext'>) {
  if (!replyContext) return null
  return (
    <div className="flex items-start gap-2 rounded-t-2xl border-b border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5 text-xs text-[var(--muted)]">
      <Reply size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--foreground)]">Replying to prior response</p>
        <p className="mt-0.5 line-clamp-2 text-[var(--muted)]">{replyContext.snippet}</p>
      </div>
      <button type="button" onClick={() => setReplyContext(null)} className="shrink-0 rounded-md p-1 text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]" aria-label="Cancel reply">
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  )
}

type ComposerControlsProps = ComposerViewProps & {
  disabledSend: boolean
  mixedFileInputRef: RefObject<HTMLInputElement | null>
}

function ComposerControls(props: ComposerControlsProps) {
  const mentionTooltip = mentionReferenceLabel(props)
  return (
    <div className={`mt-2 grid min-h-9 items-center gap-2 ${
      props.isTemporaryChat
        ? 'grid-cols-[auto_auto_minmax(0,1fr)_auto]'
        : 'grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]'
    }`}>
      <AttachMenu {...props} />
      <DelayedTooltip label={mentionTooltip} side="top">
        <button type="button" onClick={() => props.textareaRef.current?.openMentionPopup()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]" aria-label="Insert mention">
          <AtSign size={16} strokeWidth={1.75} />
        </button>
      </DelayedTooltip>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      </div>
      {props.isActiveLoading ? (
        <DelayedTooltip label="Stop generating" side="top">
          <button
            type="button"
            onClick={() => void props.onStop()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-colors hover:opacity-80"
          >
            <div className="h-3.5 w-3.5 rounded-sm bg-current" />
          </button>
        </DelayedTooltip>
      ) : (
        <DelayedTooltip label="Send (↵) · new line (⇧↵)" side="top">
          <button
            type="button"
            aria-label="Send message"
            onClick={() => void props.onSend()}
            disabled={props.disabledSend}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-colors hover:opacity-80 disabled:opacity-40"
          >
            <Send size={17} strokeWidth={1.75} />
          </button>
        </DelayedTooltip>
      )}
    </div>
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
  if (props.mode === 'automate') {
    return 'Describe an automation, use @ to reference available context...'
  }
  const referenceLabel = mentionReferenceLabel(props)
  return `Ask anything, use @ to ${referenceLabel.charAt(0).toLowerCase()}${referenceLabel.slice(1)}...`
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

  return (
    <div ref={props.attachMenuRef} className="relative shrink-0">
      <DelayedTooltip label="Attach files or choose tools" side="top">
        <button type="button" onClick={handleToggle} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]" aria-label="Open attachment and tools menu">
          <Plus size={18} strokeWidth={1.75} />
        </button>
      </DelayedTooltip>
      {props.showAttachMenu && (
        <div className={`absolute left-0 z-20 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg ${menuDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
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
            const active = props.selectedToolIds.includes(tool.id)
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
          <AttachMenuButton onClick={() => { props.onModeChange('image'); props.setShowAttachMenu(false) }} icon={<ImageIcon size={13} className="text-[var(--foreground)]" />} label="Generate images" />
          <AttachMenuButton onClick={() => { props.onModeChange('video'); props.setShowAttachMenu(false) }} icon={<Video size={13} className="text-[var(--foreground)]" />} label="Generate videos" />
          {props.capabilities.memory && props.capabilities.vectorSearch && (
            <>
              <div className="my-1 border-t border-[var(--border)]" />
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
  if (toolId === 'browser') return props.capabilities.browserUse
  if (toolId === 'sandbox') return props.capabilities.sandboxes
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
    ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
    : 'text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]'

  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={active} className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors ${disabled ? 'cursor-not-allowed text-[#bbb]' : activeClass}`}>
      {icon}
      <span>{label}</span>
      {showSwitch ? (
        <span className={`ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${active ? 'bg-[var(--muted)]' : 'bg-[var(--border)]'}`}>
          <span className={`h-3 w-3 rounded-full bg-[var(--surface-elevated)] transition-transform ${active ? 'translate-x-3' : ''}`} />
        </span>
      ) : checked ? (
        <Check size={11} strokeWidth={1.8} className="ml-auto shrink-0 text-[var(--foreground)]" />
      ) : suffix ? (
        <span className="ml-auto max-w-[6.75rem] truncate text-[10px] text-[var(--muted-light)]">{suffix}</span>
      ) : null}
    </button>
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
    <div className="group flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-xs font-medium text-[var(--foreground)]">
      <button
        type="button"
        onClick={onClear}
        className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
        aria-label={`Remove ${label}`}
      >
        <Icon size={11} strokeWidth={1.75} className="absolute opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
        <X size={10} strokeWidth={1.8} className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
      </button>
      <span>{label}</span>
    </div>
  )
}

function GenerationChip({ chip, onClear }: { chip: 'image' | 'video'; onClear: () => void }) {
  return (
    <div className="group flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[var(--foreground)] px-2 text-xs font-medium text-[var(--background)]">
      <button
        type="button"
        onClick={onClear}
        className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-75"
        aria-label={`Remove ${chip === 'image' ? 'image' : 'video'} mode`}
      >
        {chip === 'image' ? (
          <ImageIcon size={10} className="absolute opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
        ) : (
          <Video size={10} className="absolute opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
        )}
        <X size={9} className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
      </button>
      {chip === 'image' ? 'Image' : 'Video'}
    </div>
  )
}
