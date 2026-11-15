'use client'

/* eslint-disable react-hooks/refs */

import { ContextMeter, PromptInput, PromptInputBody, PromptInputButton, PromptInputSubmit, PromptInputTools } from '@overlay/chat-react'
import {
  AtSign,
  Brain,
  Paperclip,
  Globe2,
  Image as ImageIcon,
  ListEnd,
  MousePointerClick,
  Plus,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button, FloatingMenu, MenuItem } from '@overlay/ui/primitives'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { DelayedTooltip } from './DelayedTooltip'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { markComposerReady } from '../lib/realtime-baseline'
import { MentionInput } from './chat-interface/MentionInput'
import { AgentSlashMenu } from './chat-interface/AgentSlashMenu'
import { useAgentSlashMenu } from './chat-interface/useAgentSlashMenu'
import { ReplyContextBar } from './chat-interface/ReplyContextBar'
import { ChatEmptyHero, ChatEmptyState } from './ChatEmptyState'
import { AttachmentPreviewTray, useComposerAlertToasts } from './ChatComposerAttachments'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import { toComposerViewProps, type ChatComposerProps, type ComposerViewProps } from './ChatComposerTypes'
import { ComposerQueueTray, steerShortcutLabel } from './ChatComposerQueue'

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
  recordRender('ChatComposer')
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
          viewProps.showCenteredEmptyChat ? 'min-h-0 flex-1' : 'shrink-0'
        } ${viewProps.embedded ? '' : 'px-3 pb-1 sm:px-4'} ${viewProps.showCenteredEmptyChat ? 'max-md:pb-[max(1rem,env(safe-area-inset-bottom))]' : ''}`}
      >
        {/* A new chat or automation keeps the composer where it stays once the conversation starts: the greeting (and
            any automation intro) is centred in the free space, suggestions sit just above the composer. */}
        <ChatEmptyHero visible={viewProps.showCenteredEmptyChat} greetingLine={viewProps.greetingLine}>
          {viewProps.belowEmptyComposer}
        </ChatEmptyHero>
        <ChatEmptyState
          visible={viewProps.showCenteredEmptyChat}
          mode={viewProps.mode}
          onEmptySuggestion={viewProps.onEmptySuggestion}
          onAutomateSuggestion={viewProps.onAutomateSuggestion}
        />
        <div
          data-chat-composer
          data-centered={viewProps.showCenteredEmptyChat}
          className="mx-auto w-full max-w-4xl min-w-0 shrink-0"
        >
          {viewProps.beforeComposerContent}
          {viewProps.billingPromptContent}
          {viewProps.queue ? <ComposerQueueTray queue={viewProps.queue} canEdit={!viewProps.hasComposerText} /> : null}
          {viewProps.isSendBlocked && !viewProps.isActiveLoading && viewProps.blockedComposerContent ? (
            viewProps.blockedComposerContent
          ) : (
            <ComposerInputCard {...viewProps} disabledSend={disabledSend} />
          )}
        </div>
      </div>
    </>
  )
}

function ComposerInputCard(props: ComposerViewProps & { disabledSend: boolean }) {
  useEffect(() => {
    if (!props.isSendBlocked) markComposerReady()
  }, [props.isSendBlocked])
  const mixedFileInputRef = useRef<HTMLInputElement | null>(null)
  const mixedFileAccept = `${IMAGE_FILE_ACCEPT},${DOCUMENT_FILE_ACCEPT}`
  const slash = useAgentSlashMenu(props.input, props.onInputChange, props.agentCommands)

  const handleComposerKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (slash.handleKeyDown(event)) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (props.queue?.running) {
        if (!props.hasComposerText) return
        if (event.metaKey || event.ctrlKey) props.queue.onSteerDraft()
        else props.queue.onQueueDraft()
        return
      }
      if (!props.isSendBlocked && props.hasComposerText) void props.onSend()
    }
  }

  return (
    <>
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
        <div className="flex items-end gap-1">
          <div className="min-w-0 flex-1">
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
          </div>
          <ComposerSendControl {...props} />
        </div>
      </PromptInputBody>
    </PromptInput>
    <ComposerAccessoryRow {...props} mixedFileInputRef={mixedFileInputRef} />
    </>
  )
}


function ComposerSendControl(props: ComposerViewProps & { disabledSend: boolean }) {
  if (props.queue?.running && props.hasComposerText) {
    return (
      <DelayedTooltip label={`Queue (↵) · steer now (${steerShortcutLabel()}↵)`} side="top">
        <Button variant="ghost" size="icon" type="button" aria-label="Queue message" className="size-9 shrink-0 rounded-lg text-(--foreground) hover:bg-(--surface-muted)" onClick={props.queue.onQueueDraft}>
          <ListEnd size={17} strokeWidth={2} />
        </Button>
      </DelayedTooltip>
    )
  }
  return (
    <DelayedTooltip label={props.isActiveLoading ? 'Stop generating' : 'Send (↵) · new line (⇧↵)'} side="top">
      <PromptInputSubmit
        status={props.isActiveLoading ? 'streaming' : 'ready'}
        onStop={() => void props.onStop()}
        onClick={() => void props.onSend()}
        disabled={props.disabledSend || props.isSendBlocked}
      />
    </DelayedTooltip>
  )
}

/** Everything except the text sits on one quiet row under the input card. */
function ComposerAccessoryRow(props: ComposerViewProps & { mixedFileInputRef: RefObject<HTMLInputElement | null> }) {
  const memoryOff = props.capabilities.memory && props.capabilities.vectorSearch && !props.memoryEnabled
  const tools = props.selectedToolIds.filter((toolId) => isToolRequestEnabled(toolId, props))
  return (
    <div data-slot="prompt-input-accessories" className="mt-1 grid min-h-8 grid-cols-[1fr_auto_1fr] items-center gap-2 px-0.5">
      <div className="flex min-w-0 items-center">
        {props.textOnly ? null : <AttachMenu {...props} />}
      </div>
      <p className="truncate text-center text-xs text-(--muted-light) max-sm:hidden">
        {props.queue?.running ? <QueueShortcutHint /> : props.mode === 'chat' ? 'Overlay can make mistakes.' : null}
      </p>
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        <PromptInputTools className="flex-none">
          {memoryOff ? (
            <DelayedTooltip label="Memory is off for this message." side="top">
              <div className="shrink-0">
                <ToolRequestChip label="Memory: OFF" Icon={Brain} onClear={props.onToggleMemory} />
              </div>
            </DelayedTooltip>
          ) : null}
          {tools.map((toolId) => {
            const tool = TOOL_REQUEST_BY_ID.get(toolId)
            if (!tool) return null
            return <ToolRequestChip key={toolId} label={tool.label} Icon={tool.Icon} onClear={() => props.onRemoveTool(toolId)} />
          })}
          {props.generationChip && <GenerationChip chip={props.generationChip} onClear={() => props.setGenerationChip(null)} />}
        </PromptInputTools>
        {props.contextUsage ? <ContextMeter {...props.contextUsage} /> : null}
        {props.modelControl}
      </div>
    </div>
  )
}

function QueueShortcutHint() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      <kbd className="rounded border border-(--border) px-1 font-sans text-[10px] text-(--muted)">↵</kbd>
      queue
      <span className="px-0.5">·</span>
      <kbd className="rounded border border-(--border) px-1 font-sans text-[10px] text-(--muted)">{steerShortcutLabel()}↵</kbd>
      steer
    </span>
  )
}

function composerPlaceholder(props: ComposerViewProps): string {
  if (props.placeholder) return props.placeholder
  return 'What do you want to get done?'
}

function AttachMenu(props: ComposerViewProps & { mixedFileInputRef: RefObject<HTMLInputElement | null> }) {
  const [open, setOpen] = useState(false)
  return (
    <FloatingMenu
      kind="menu"
      anchorRef={props.attachMenuRef}
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      className="w-56"
      onCloseAutoFocus={(event) => event.preventDefault()}
      trigger={
        <PromptInputButton aria-label="Add files or mention" className="size-8">
          <Plus size={17} strokeWidth={1.75} />
        </PromptInputButton>
      }
    >
      {props.capabilities.files ? (
        <MenuItem onClick={() => props.mixedFileInputRef.current?.click()}>
          <Paperclip size={14} strokeWidth={1.75} />
          Upload files or photos
        </MenuItem>
      ) : null}
      <MenuItem onClick={() => requestAnimationFrame(() => props.textareaRef.current?.openMentionPopup())}>
        <AtSign size={14} strokeWidth={1.75} />
        Mention
        <span className="ml-auto text-(--muted-light)">@</span>
      </MenuItem>
    </FloatingMenu>
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
