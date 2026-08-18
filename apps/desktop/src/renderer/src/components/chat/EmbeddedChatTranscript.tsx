import { useMemo } from 'react'
import type { ChatTranscriptPresentation } from '@overlay/chat-react/transcript'
import type { PanelTheme } from '../../hooks/usePanelTheme'
import { DesktopChatTranscript } from './DesktopChatTranscript'
import {
  embeddedChatItemsToMessages,
  type EmbeddedChatItem,
  type EmbeddedPlanStep
} from './embeddedChatTranscriptAdapter'

const EMBEDDED_TRANSCRIPT_PRESENTATION: Partial<ChatTranscriptPresentation> = {
  density: 'compact',
  showActions: false,
  showModelLabel: false,
  maxContentWidth: '100%'
}

const noopMessage = (): void => undefined
const noopAttachmentPreview = (): void => undefined
const noopSelection = (): void => undefined

interface EmbeddedChatTranscriptProps {
  idPrefix: string
  items: readonly EmbeddedChatItem[]
  isRunning: boolean
  mode: 'ask' | 'act'
  theme: PanelTheme
  modelId?: string
  modelName?: string
  planSteps?: readonly EmbeddedPlanStep[]
  onContinue?: () => void
}

export function EmbeddedChatTranscript({
  idPrefix,
  items,
  isRunning,
  mode,
  theme,
  modelId,
  modelName,
  planSteps,
  onContinue
}: EmbeddedChatTranscriptProps): React.ReactElement<any> | null {
  const messages = useMemo(
    () =>
      embeddedChatItemsToMessages(items, {
        idPrefix,
        isRunning,
        mode,
        modelId,
        planSteps
      }),
    [idPrefix, isRunning, items, mode, modelId, planSteps]
  )
  const streamingAssistantMessageId = useMemo(
    () =>
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === 'assistant' &&
            (message.status === 'submitted' ||
              message.status === 'streaming' ||
              message.status === 'executing-tool')
        )?.id ?? null,
    [messages]
  )
  const models = useMemo(
    () =>
      modelId
        ? [
            {
              id: modelId,
              name: modelName ?? modelId,
              provider: 'overlay',
              intelligence: 0,
              cost: 0 as const,
              speedTier: 2 as const,
              supportsVision: false,
              supportsReasoning: true,
              supportsSearch: false
            }
          ]
        : [],
    [modelId, modelName]
  )

  if (messages.length === 0) return null

  return (
    <DesktopChatTranscript
      messages={messages}
      models={models}
      onDelete={noopMessage}
      onRetry={noopMessage}
      onReply={noopMessage}
      onOpenAttachmentPreview={noopAttachmentPreview}
      onSelectResponseModel={noopSelection}
      streamingAssistantMessageId={streamingAssistantMessageId}
      theme={theme}
      presentation={EMBEDDED_TRANSCRIPT_PRESENTATION}
      onContinue={onContinue}
    />
  )
}

export type { EmbeddedChatItem, EmbeddedPlanStep }
