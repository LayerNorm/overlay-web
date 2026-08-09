import type { ClipboardEventHandler, Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import type { GenerationMode } from '@/shared/ai/gateway/model-types'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import type { AttachmentPreview, AttachmentPreviewOpenOptions } from '@overlay/chat-react'
import type { CapabilityCheck } from '@overlay/app-core'
import type { MentionInputHandle } from './chat-interface/MentionInput'
import type { AttachedImage, PendingChatDocument } from './chat-interface/types'
import type { EmptyAutomateSuggestionId, EmptyChatSuggestionId } from './ChatEmptyState'

export type ReplyContext = { snippet: string; bodyForModel: string; replyToTurnId?: string } | null
export type ChatComposerEmptyState = { showCenteredEmptyChat: boolean; greetingLine: string; belowEmptyComposer?: ReactNode }
export type ChatComposerAttachmentState = {
  attachedImages: AttachedImage[]; setAttachedImages: Dispatch<SetStateAction<AttachedImage[]>>
  pendingChatDocuments: PendingChatDocument[]; removePendingDocument: (clientId: string) => void
  attachmentError: string | null; fileInputRef: RefObject<HTMLInputElement | null>; docInputRef: RefObject<HTMLInputElement | null>
  onAddImages: (files: FileList | File[]) => void; onAddDocumentsFromPicker: (files: FileList | File[] | null) => void
  onOpenAttachmentPreview: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
  onOpenFilePreview: (name: string, fileIds: string[]) => void | Promise<void>
}
export type ChatComposerRuntime = {
  composerNotice: string | null
  /** Contextual confirmation or warning rendered immediately above the composer. */
  beforeComposerContent?: ReactNode
  billingPromptContent?: ReactNode
  isSendBlocked: boolean
  isActiveLoading: boolean
  isTemporaryChat: boolean
  blockedComposerContent: ReactNode
}
export type ChatComposerInputState = {
  replyContext: ReplyContext; setReplyContext: (context: ReplyContext) => void; textareaRef: RefObject<MentionInputHandle | null>
  input: string; inputRevision: number; onInputChange: (text: string) => void; onMentionsChange: (mentions: MentionItem[]) => void
  onPaste: ClipboardEventHandler; hasComposerText: boolean
}
export type ChatComposerToolState = {
  showAttachMenu: boolean; setShowAttachMenu: Dispatch<SetStateAction<boolean>>; attachMenuRef: RefObject<HTMLDivElement | null>
  selectedToolIds: ChatToolRequestId[]; memoryEnabled: boolean
  capabilities: CapabilityCheck
  onToggleTool: (toolId: ChatToolRequestId) => void; onToggleMemory: () => void; onRemoveTool: (toolId: ChatToolRequestId) => void
}
export type ChatComposerModeState = {
  onModeChange: (mode: GenerationMode) => void; generationChip: 'image' | 'video' | null; setGenerationChip: (chip: 'image' | 'video' | null) => void
  showModeMenu: boolean; setShowModeMenu: Dispatch<SetStateAction<boolean>>; modeMenuRef: RefObject<HTMLDivElement | null>; onNavigateMode: (mode: 'chat' | 'automate') => void
}
export type ChatComposerActions = {
  onStop: () => void | Promise<void>
  onSend: () => void | Promise<void>
  onEmptySuggestion?: (id: EmptyChatSuggestionId) => void
  onAutomateSuggestion?: (id: EmptyAutomateSuggestionId) => void
}
export type ChatComposerSurface = {
  hideModeMenu?: boolean
  hideGenerationModes?: boolean
  placeholder?: string
  /** Additional mention targets, such as workspace people and named agents. */
  mentionCategories?: MentionCategory[]
}
export type ChatComposerProps = {
  mode: 'chat' | 'automate'; emptyState: ChatComposerEmptyState; attachments: ChatComposerAttachmentState
  runtime: ChatComposerRuntime; inputState: ChatComposerInputState; toolState: ChatComposerToolState
  modeState: ChatComposerModeState; actions: ChatComposerActions
  surface?: ChatComposerSurface
}
export type ComposerViewProps = { mode: 'chat' | 'automate' }
  & ChatComposerEmptyState & ChatComposerAttachmentState & ChatComposerRuntime & ChatComposerInputState
  & ChatComposerToolState & ChatComposerModeState & ChatComposerActions & ChatComposerSurface

export function toComposerViewProps(props: ChatComposerProps): ComposerViewProps {
  return { mode: props.mode, ...props.emptyState, ...props.attachments, ...props.runtime, ...props.inputState, ...props.toolState, ...props.modeState, ...props.actions, ...props.surface }
}
