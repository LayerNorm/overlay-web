import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { MentionItem } from '@/shared/knowledge/mention-types'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import type { ReasoningLevel } from '@overlay/chat-core'
import type {
  AskModelSelectionMode,
  AttachedImage,
  ChatMessageMetadata,
  ConversationRuntime,
  ConversationUiState,
  PendingChatDocument,
} from '../chat-interface/types'

export const TEMPORARY_CHAT_ID = '__overlay_temporary_chat__'
export const PENDING_FIRST_CHAT_ID = '__overlay_pending_first_chat__'

export type ReplyContext = {
  snippet: string
  bodyForModel: string
  replyToTurnId?: string
} | null

export type UiPart = {
  type: string
  text?: string
  url?: string
  mediaType?: string
  fileName?: string
}

export type StartSession = (
  chatId: string,
  mode: 'act',
  title: string,
  messageCountAtStart: number,
) => void

export type CompleteSession = (chatId: string, active: boolean) => void

export type UpdateRuntimeUiState = (
  chatId: string,
  updater: (prev: ConversationUiState) => ConversationUiState,
) => void

export type EnsureConversationRuntime = (
  chatId: string,
  uiOverrides?: Partial<ConversationUiState>,
) => ConversationRuntime

export type SubmittedComposerSnapshot = {
  text: string
  selectedActModelSnapshot: string
  textModelsForTurn: string[]
  activeChatTitleSnapshot: string | null
  selectedImageModelsSnapshot: string[]
  selectedVideoModelsSnapshot: string[]
  attachedImagesSnapshot: AttachedImage[]
  pendingChatDocumentsSnapshot: PendingChatDocument[]
  mentionsSnapshot: MentionItem[]
  temporaryChatSnapshot: boolean
  requestMode: 'chat' | 'automate'
  selectedToolIdsSnapshot: ChatToolRequestId[]
  memoryEnabledSnapshot: boolean
  hasReadyDocs: boolean
}

export function buildSubmittedComposerSnapshot({
  askModelSelectionMode,
  selectedModels,
  selectedActModel,
  activeChatTitle,
  selectedImageModels,
  selectedVideoModels,
  attachedImages,
  pendingChatDocuments,
  mentions,
  isTemporaryChat,
  mode,
  selectedToolIds,
  memoryEnabled,
  text,
}: {
  askModelSelectionMode: AskModelSelectionMode
  selectedModels: string[]
  selectedActModel: string
  activeChatTitle: string | null
  selectedImageModels: string[]
  selectedVideoModels: string[]
  attachedImages: AttachedImage[]
  pendingChatDocuments: PendingChatDocument[]
  mentions: MentionItem[]
  isTemporaryChat: boolean
  mode: 'chat' | 'automate'
  selectedToolIds: ChatToolRequestId[]
  memoryEnabled: boolean
  text: string
}): SubmittedComposerSnapshot {
  const normalizedTextSelection = normalizeChatModelSelection({
    askModelIds: askModelSelectionMode === 'multiple' ? selectedModels.slice(0, 4) : [selectedActModel],
    actModelId: selectedActModel,
  })
  const pendingChatDocumentsSnapshot = [...pendingChatDocuments]
  const temporaryChatSnapshot = isTemporaryChat
  return {
    text,
    selectedActModelSnapshot: normalizedTextSelection.actModelId,
    textModelsForTurn: normalizedTextSelection.askModelIds,
    activeChatTitleSnapshot: activeChatTitle,
    selectedImageModelsSnapshot: [...selectedImageModels],
    selectedVideoModelsSnapshot: [...selectedVideoModels],
    attachedImagesSnapshot: [...attachedImages],
    pendingChatDocumentsSnapshot,
    mentionsSnapshot: [...mentions],
    temporaryChatSnapshot,
    requestMode: temporaryChatSnapshot ? 'chat' : mode,
    selectedToolIdsSnapshot: [...selectedToolIds],
    memoryEnabledSnapshot: memoryEnabled,
    hasReadyDocs: pendingChatDocumentsSnapshot.some((document) => document.status === 'ready'),
  }
}

export function getSendValidationError(
  snapshot: Pick<
    SubmittedComposerSnapshot,
    'pendingChatDocumentsSnapshot' | 'attachedImagesSnapshot' | 'text' | 'hasReadyDocs'
  >,
  effectiveGenType: 'image' | 'video' | null,
): 'uploading-documents' | 'failed-documents' | 'empty' | null {
  if (snapshot.pendingChatDocumentsSnapshot.some((document) => document.status === 'uploading')) {
    return 'uploading-documents'
  }
  if (snapshot.pendingChatDocumentsSnapshot.some((document) => document.status === 'error')) {
    return 'failed-documents'
  }
  if (effectiveGenType === 'image' || effectiveGenType === 'video') {
    if (!snapshot.text && snapshot.attachedImagesSnapshot.length === 0) return 'empty'
  } else if (
    snapshot.attachedImagesSnapshot.length === 0 &&
    !snapshot.text &&
    !snapshot.hasReadyDocs
  ) {
    return 'empty'
  }
  return null
}

export function buildMediaPromptForModel(replyContext: ReplyContext, text: string): string {
  return replyContext?.bodyForModel && text
    ? `${text}\n\n---\n[User is replying in thread to prior content]\n${replyContext.bodyForModel}`
    : text
}

export function buildMediaUserMessage({
  turnId,
  text,
  attachedImages,
  replyContext,
}: {
  turnId: string
  text: string
  attachedImages: AttachedImage[]
  replyContext: ReplyContext
}) {
  const parts: UiPart[] = []
  if (text) parts.push({ type: 'text', text })
  for (const image of attachedImages) {
    parts.push({
      type: 'file',
      url: image.dataUrl,
      mediaType: image.mimeType,
      fileName: image.name,
    })
  }
  return {
    id: turnId,
    role: 'user',
    parts,
    ...(replyContext?.replyToTurnId
      ? {
          metadata: {
            replyToTurnId: replyContext.replyToTurnId,
            replySnippet: replyContext.snippet,
          },
        }
      : {}),
  }
}

export type TextTurnPayload = {
  indexedAttachments: { name: string; fileIds: string[] }[]
  indexedFileNames: string[]
  partsForModel: UiPart[]
  userMeta: ChatMessageMetadata
  userMetadata?: ChatMessageMetadata
  userUIMessage: UIMessage
}

export function buildTextTurnPayload({
  text,
  attachedImages,
  pendingChatDocuments,
  mentions,
  replyContext,
  turnId,
}: {
  text: string
  attachedImages: AttachedImage[]
  pendingChatDocuments: PendingChatDocument[]
  mentions: MentionItem[]
  replyContext: ReplyContext
  turnId: string
}): TextTurnPayload {
  const readyDocs = pendingChatDocuments.filter((document) => document.status === 'ready')
  const indexedAttachments = readyDocs.map((document) => ({ name: document.name, fileIds: document.fileIds }))
  const indexedFileNames = readyDocs.map((document) => document.name)
  const partsForModel: UiPart[] = []
  if (text.trim()) partsForModel.push({ type: 'text', text: text.trim() })
  for (const image of attachedImages) {
    partsForModel.push({
      type: 'file',
      url: image.dataUrl,
      mediaType: image.mimeType,
      fileName: image.name,
    })
  }

  const userMeta: ChatMessageMetadata = {}
  if (indexedFileNames.length > 0) {
    userMeta.indexedDocuments = indexedFileNames
    userMeta.indexedAttachments = indexedAttachments
  }
  if (replyContext?.replyToTurnId) {
    userMeta.replyToTurnId = replyContext.replyToTurnId
    userMeta.replySnippet = replyContext.snippet
  }
  if (mentions.length > 0) {
    userMeta.mentions = mentions.map((mention) => ({
      type: mention.type,
      id: mention.id,
      name: mention.name,
      ...(mention.meta?.fileIds ? { fileIds: mention.meta.fileIds as string[] } : {}),
    }))
  }
  const userMetadata = Object.keys(userMeta).length > 0 ? userMeta : undefined
  return {
    indexedAttachments,
    indexedFileNames,
    partsForModel,
    userMeta,
    userMetadata,
    userUIMessage: {
      id: turnId,
      role: 'user',
      parts: partsForModel,
      ...(userMetadata ? { metadata: userMetadata } : {}),
    } as UIMessage,
  }
}

export function buildCommonActBody({
  chatId,
  pendingConversationClientId,
  temporaryChatSnapshot,
  embedProjectId,
  knowledgeBaseId,
  textModelsForTurn,
  turnId,
  requestMode,
  automationIdParam,
  indexedFileNames,
  indexedAttachments,
  replyContext,
  userMeta,
  textHistoryBaseModelId,
  selectedToolIdsSnapshot,
  memoryEnabledSnapshot,
  reasoning,
}: {
  chatId: string
  pendingConversationClientId: string | null
  temporaryChatSnapshot: boolean
  embedProjectId: string | null
  knowledgeBaseId?: string
  textModelsForTurn: string[]
  turnId: string
  requestMode: 'chat' | 'automate'
  automationIdParam: string | null
  indexedFileNames: string[]
  indexedAttachments: { name: string; fileIds: string[] }[]
  replyContext: ReplyContext
  userMeta: ChatMessageMetadata
  textHistoryBaseModelId?: string
  selectedToolIdsSnapshot: ChatToolRequestId[]
  memoryEnabledSnapshot: boolean
  reasoning?: ReasoningLevel
}) {
  return {
    ...(temporaryChatSnapshot
      ? { temporaryChat: true }
      : chatId === PENDING_FIRST_CHAT_ID
        ? {
            conversationClientId: pendingConversationClientId,
            ...(embedProjectId ? { projectId: embedProjectId } : {}),
            askModelIds: textModelsForTurn,
          }
        : { conversationId: chatId }),
    turnId,
    mode: requestMode,
    automationMode: requestMode === 'automate',
    ...(requestMode === 'automate' && automationIdParam ? { automationId: automationIdParam } : {}),
    ...(indexedFileNames.length > 0 ? { indexedFileNames, indexedAttachments } : {}),
    ...(replyContext?.bodyForModel ? { replyContextForModel: replyContext.bodyForModel } : {}),
    ...(userMeta.mentions && userMeta.mentions.length > 0 ? { mentions: userMeta.mentions } : {}),
    ...(userMeta.mentions?.some((mention) => mention.type === 'knowledge')
      ? {
          knowledgeBaseIds: [...new Set(
            userMeta.mentions
              .filter((mention) => mention.type === 'knowledge')
              .map((mention) => mention.id),
          )],
        }
      : {}),
    ...(textHistoryBaseModelId ? { historyBaseModelId: textHistoryBaseModelId } : {}),
    requestedToolIds: selectedToolIdsSnapshot,
    memoryEnabled: memoryEnabledSnapshot,
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(reasoning && reasoning !== 'provider-default' ? { reasoning } : {}),
  }
}
