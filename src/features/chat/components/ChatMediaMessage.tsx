'use client'

import {
  MediaExchange,
  type AttachmentPreview,
  type AttachmentPreviewOpenOptions,
} from '@overlay/chat-react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { DEFAULT_IMAGE_MODEL_ID, DEFAULT_VIDEO_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { IMAGE_MODELS, VIDEO_MODELS } from '@/shared/ai/gateway/model-data'
import {
  getMessageImageAttachments,
  getMessageText,
  getUserReplyThreadMeta,
  getUserTurnId,
} from '@overlay/chat-core'
import type { GenerationResult } from './chat-interface/types'

export type ChatMediaMessageProps = {
  message: UIMessage
  exchangeIndex: number
  kind: 'image' | 'video'
  generationResults?: GenerationResult[]
  exchangeModels: string[]
  selectedImageModels: string[]
  selectedVideoModels: string[]
  exitingTurnIds: string[]
  onJumpToReply: (turnId: string) => void
  onDeleteTurn: (turnId: string) => void | Promise<void>
  onReplyToMediaPrompt: (prompt: string, kind: 'image' | 'video', turnId: string | null) => void
  onOpenAttachmentPreview: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
}

export function ChatMediaMessage({
  message,
  exchangeIndex,
  kind,
  generationResults,
  exchangeModels,
  selectedImageModels,
  selectedVideoModels,
  exitingTurnIds,
  onJumpToReply,
  onDeleteTurn,
  onReplyToMediaPrompt,
  onOpenAttachmentPreview,
}: ChatMediaMessageProps) {
  let modelList = exchangeModels
  if (modelList.length === 0) {
    modelList = kind === 'image'
      ? [selectedImageModels[0] ?? DEFAULT_IMAGE_MODEL_ID]
      : [selectedVideoModels[0] ?? DEFAULT_VIDEO_MODEL_ID]
  }
  let results = generationResults?.length
    ? [...generationResults]
    : modelList.map(() => ({ type: kind, status: 'generating' as const }))
  while (results.length < modelList.length) results.push({ type: kind, status: 'generating' })
  if (results.length > modelList.length) results = results.slice(0, modelList.length)

  const promptText = getMessageText(message)
  const turnId = getUserTurnId(message)
  const isExiting = !!turnId && exitingTurnIds.includes(turnId)
  const modelLabel = modelList.length > 1
    ? `${kind === 'image' ? 'Image' : 'Video'} · ${modelList.length} models`
    : getMediaModelDisplayName(modelList[0] ?? kind)

  return (
    <MediaExchange
      exchangeIndex={exchangeIndex}
      turnId={turnId}
      kind={kind}
      promptText={promptText}
      userImages={getMessageImageAttachments(message)}
      replyThread={getUserReplyThreadMeta(message)}
      results={results}
      modelIds={modelList}
      modelLabel={modelLabel}
      isExiting={isExiting}
      getModelDisplayName={getMediaModelDisplayName}
      onJumpToReply={onJumpToReply}
      onDeleteTurn={onDeleteTurn}
      onReply={onReplyToMediaPrompt}
      onOpenAttachmentPreview={onOpenAttachmentPreview}
    />
  )
}

function getMediaModelDisplayName(modelId: string): string {
  return IMAGE_MODELS.find((model) => model.id === modelId)?.name ||
    VIDEO_MODELS.find((model) => model.id === modelId)?.name ||
    modelId
}
