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
/**
 * Per-surface trims. Rooms (direct messages and channels) reuse the chat
 * composer verbatim minus the single-player controls that have no meaning with
 * other members in the conversation.
 */
export type ChatComposerSurface = {
  /** Hide the Chat/Automate switcher. */
  hideModeMenu?: boolean
  /** Hide image/video generation and tool-request entries. */
  hideGenerationModes?: boolean
  /** Override the textarea placeholder. */
  placeholder?: string
  /** Conversation-scoped @-mention sources (room members) shown above the workspace catalog. */
  mentionCategories?: MentionCategory[]
}
export type ChatComposerProps = {
  mode: 'chat' | 'automate'; emptyState: ChatComposerEmptyState; attachments: ChatComposerAttachmentState
  runtime: ChatComposerRuntime; inputState: ChatComposerInputState; toolState: ChatComposerToolState
  modeState: ChatComposerModeState; actions: ChatComposerActions; surface?: ChatComposerSurface
}
export type ComposerViewProps = { mode: 'chat' | 'automate'; surface: ChatComposerSurface }
  & ChatComposerEmptyState & ChatComposerAttachmentState & ChatComposerRuntime & ChatComposerInputState
  & ChatComposerToolState & ChatComposerModeState & ChatComposerActions

export function toComposerViewProps(props: ChatComposerProps): ComposerViewProps {
  return { mode: props.mode, surface: props.surface ?? {}, ...props.emptyState, ...props.attachments, ...props.runtime, ...props.inputState, ...props.toolState, ...props.modeState, ...props.actions }
}
