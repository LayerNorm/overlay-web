'use client'

/* eslint-disable react-hooks/refs */

import {
  AtSign,
  Brain,
  Check,
  ChevronDown,
  FileText,
  Globe2,
  Image as ImageIcon,
  MessageSquare,
  MousePointerClick,
  Plus,
  Reply,
  Send,
  SquareTerminal,
  Video,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { DelayedTooltip } from './DelayedTooltip'
import { MentionInput } from './chat-interface/MentionInput'
import { ChatEmptyHero, ChatEmptyState } from './ChatEmptyState'
import { AttachmentPreviewTray, ComposerAlerts } from './ChatComposerAttachments'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import { toComposerViewProps, type ChatComposerProps, type ComposerViewProps } from './ChatComposerTypes'
import { useAuthorization } from '@/components/providers/AuthorizationProvider'

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
          <ComposerAlerts attachmentError={viewProps.attachmentError} composerNotice={viewProps.composerNotice} />
          {viewProps.billingPromptContent}
          {viewProps.isSendBlocked && !viewProps.isActiveLoading ? (
            viewProps.blockedComposerContent
          ) : (
            <ComposerInputCard {...viewProps} disabledSend={disabledSend} />
          )}
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

  return (
    <div className="overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[background-color,border-color,box-shadow,color] duration-300">
      {props.replyContext && <ReplyContextBar replyContext={props.replyContext} setReplyContext={props.setReplyContext} />}
      <div className="p-2.5 sm:p-3">
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
          extraCategories={props.surface.mentionCategories}
          value={props.input}
          valueRevision={props.inputRevision}
          onChange={props.onInputChange}
          onMentionsChange={props.onMentionsChange}
          onPaste={props.onPaste}
          onUploadFile={() => props.docInputRef.current?.click()}
          placeholder={composerPlaceholder(props)}
          className={undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void props.onSend()
            }
          }}
        />
        <ComposerControls {...props} mixedFileInputRef={mixedFileInputRef} />
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
  const { allows } = useAuthorization()
  const can = (capability: Parameters<ReturnType<typeof useAuthorization>['can']>[0]) =>
    allows({ all: [capability] })
  const mentionTooltip = mentionReferenceLabel(props.capabilities)
  const showModeMenu = !props.isTemporaryChat && !props.surface.hideModeMenu
  return (
    <div className={`mt-2 grid min-h-9 items-center gap-2 ${
      showModeMenu
        ? 'grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]'
        : 'grid-cols-[auto_auto_minmax(0,1fr)_auto]'
    }`}>
      <AttachMenu {...props} />
      <DelayedTooltip label={mentionTooltip} side="top">
        <button type="button" onClick={() => props.textareaRef.current?.openMentionPopup()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]" aria-label="Insert mention">
          <AtSign size={16} strokeWidth={1.75} />
        </button>
      </DelayedTooltip>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!props.surface.hideGenerationModes && can('memory.use') && props.capabilities.memory && props.capabilities.vectorSearch && !props.memoryEnabled && (
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
        {(props.surface.hideGenerationModes ? [] : props.selectedToolIds).filter((toolId) => isToolRequestEnabled(toolId, props, can)).map((toolId) => {
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
        {!props.surface.hideGenerationModes && props.generationChip && <GenerationChip chip={props.generationChip} onClear={() => props.setGenerationChip(null)} />}
      </div>
      {showModeMenu ? <ModeMenu {...props} /> : null}
      {props.isActiveLoading ? (
        <DelayedTooltip label="Stop generating" side="top">
          <button
            type="button"
            onClick={() => void props.onStop()}
            aria-label="Stop generating"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-colors hover:opacity-80"
          >
            <div className="h-3.5 w-3.5 rounded-sm bg-current" />
          </button>
        </DelayedTooltip>
      ) : (
        <DelayedTooltip label="Send (↵) · new line (⇧↵)" side="top">
          <button
            type="button"
            onClick={() => void props.onSend()}
            disabled={props.disabledSend}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-colors hover:opacity-80 disabled:opacity-40"
          >
            <Send size={17} strokeWidth={1.75} />
          </button>
        </DelayedTooltip>
      )}
    </div>
  )
}

function mentionReferenceLabel(capabilities: ComposerViewProps['capabilities']): string {
  const targets = [
    capabilities.files ? 'files' : null,
    capabilities.skills ? 'skills' : null,
    capabilities.automations ? 'automations' : null,
    capabilities.mcpServers ? 'MCP servers' : null,
    capabilities.integrations ? 'connectors' : null,
    capabilities.chat ? 'chats' : null,
  ].filter(Boolean)
  return `Reference ${targets.length > 0 ? targets.join(', ') : 'context'}`
}

function composerPlaceholder(props: ComposerViewProps): string {
  if (props.surface.placeholder) return props.surface.placeholder
  if (props.mode === 'automate') {
    return 'Describe an automation, use @ to reference available context...'
  }
  return `Ask anything, use @ to ${mentionReferenceLabel(props.capabilities).toLowerCase()}...`
}

function AttachMenu(props: ComposerViewProps & { mixedFileInputRef: RefObject<HTMLInputElement | null> }) {
  const [menuDirection, setMenuDirection] = useState<'up' | 'down'>('up')
  const { allows } = useAuthorization()
  const can = (capability: Parameters<ReturnType<typeof useAuthorization>['can']>[0]) =>
    allows({ all: [capability] })

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
          {(props.surface.hideGenerationModes ? [] : TOOL_REQUEST_OPTIONS).filter((tool) => isToolRequestEnabled(tool.id, props, can)).map((tool) => {
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
          {!props.surface.hideGenerationModes && (
            <>
              <AttachMenuButton onClick={() => { props.onModeChange('image'); props.setShowAttachMenu(false) }} icon={<ImageIcon size={13} className="text-[var(--foreground)]" />} label="Generate images" />
              <AttachMenuButton onClick={() => { props.onModeChange('video'); props.setShowAttachMenu(false) }} icon={<Video size={13} className="text-[var(--foreground)]" />} label="Generate videos" />
            </>
          )}
          {!props.surface.hideGenerationModes && can('memory.use') && props.capabilities.memory && props.capabilities.vectorSearch && (
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
  can: ReturnType<typeof useAuthorization>['can'],
): boolean {
  if (!can('tools.use')) return false
  if (toolId === 'web_search') return can('web_search.use') && props.capabilities.webSearch
  if (toolId === 'browser') return props.capabilities.browserUse
  if (toolId === 'sandbox') return props.capabilities.sandboxes
  if (toolId === 'memory') return can('memory.use') && props.capabilities.memory && props.capabilities.vectorSearch
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
        <span className={`ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${active ? 'bg-[var(--foreground)]' : 'bg-[var(--border)]'}`}>
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

function ModeMenu(props: ComposerViewProps) {
  return (
    <div ref={props.modeMenuRef} className="relative shrink-0">
      <button type="button" onClick={() => props.setShowModeMenu((value) => !value)} className={`flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs transition-colors hover:bg-[var(--surface-muted)] ${props.mode === 'automate' ? 'text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
        {props.mode === 'automate' ? <Zap size={12} strokeWidth={1.75} /> : <MessageSquare size={12} strokeWidth={1.75} />}
        <span>{props.mode === 'automate' ? 'Automate' : 'Chat'}</span>
        <ChevronDown size={10} className="opacity-60" />
      </button>
      {props.showModeMenu && (
        <div className="overlay-fade-in absolute bottom-full right-0 z-20 mb-2 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
          {(['chat', 'automate'] as const).map((item) => (
            <button key={item} type="button" onClick={() => props.onNavigateMode(item)} className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-muted)] ${props.mode === item ? 'text-[var(--foreground)]' : 'text-[var(--muted)]'}`}>
              {item === 'chat' ? <MessageSquare size={13} /> : <Zap size={13} strokeWidth={1.75} />}
              <span>{item === 'chat' ? 'Chat' : 'Automate'}</span>
              {props.mode === item && <Check size={11} className="ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
