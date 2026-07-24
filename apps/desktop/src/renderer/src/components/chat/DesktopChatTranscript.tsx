import { useCallback, useMemo, type CSSProperties } from 'react'
import {
  groupTranscriptMessages,
  type ChatTranscriptExchangeView,
  type ChatExchangeStatus,
  type WebSourceItem
} from '@overlay/chat-core'
import {
  ChatReactConfigContext,
  type AttachmentPreview,
  type AttachmentPreviewOpenOptions
} from '@overlay/chat-react'
import {
  ChatExchange,
  ChatTranscript,
  MediaExchange,
  type ChatTranscriptPresentation
} from '@overlay/chat-react/transcript'
import type { PanelTheme } from '../../hooks/usePanelTheme'
import { desktopChatTranscriptAdapter } from './desktopChatTranscriptAdapter'
import { resolveDesktopExchangeActionTargets } from './desktopTranscriptActions'
import { panelThemeToSharedCssVars } from './themeBridge'
import type { ChatModel, Message } from './types'

import overlayLogoUrl from '../../../../../resources/logos/overlay-chat-mark.png'

export interface DesktopChatTranscriptProps {
  messages: Message[]
  models: ChatModel[]
  streamingAssistantMessageId?: string | null
  theme: PanelTheme
  onDelete: (messageId: string) => void
  onRetry: (message: Message) => void
  onReply: (message: Message) => void
  onOpenAttachmentPreview: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions
  ) => void
  onSelectResponseModel: (messageId: string, modelId: string) => void
  onBranch?: (turnId: string) => void | Promise<void>
  onOpenSources?: (turnId: string, sources: WebSourceItem[]) => void
  sourcesPanel?: { turnId: string; sources: WebSourceItem[] } | null
  actionsLocked?: boolean
  presentation?: Partial<ChatTranscriptPresentation>
  onContinue?: () => void
}

const DESKTOP_TRANSCRIPT_PRESENTATION: ChatTranscriptPresentation = {
  density: 'comfortable',
  actionVisibility: 'hover',
  showActions: true,
  showModelLabel: true,
  maxContentWidth: '56rem'
}

const DESKTOP_CHAT_REACT_CONFIG = { toolLogoUrl: overlayLogoUrl }

const ACTIVE_RESPONSE_STATUSES = new Set<ChatExchangeStatus>([
  'submitted',
  'streaming',
  'awaiting-approval',
  'executing-tool'
])

function noop(): void {
  return undefined
}
function noopTurn(turnId: string): void {
  void turnId
}

export function DesktopChatTranscript({
  messages,
  models,
  streamingAssistantMessageId,
  theme,
  onDelete,
  onRetry,
  onReply,
  onOpenAttachmentPreview,
  onSelectResponseModel,
  onBranch,
  onOpenSources,
  sourcesPanel = null,
  actionsLocked = false,
  presentation,
  onContinue
}: DesktopChatTranscriptProps): React.ReactElement {
  const transcriptView = useMemo(
    () => desktopChatTranscriptAdapter({ messages, streamingAssistantMessageId }),
    [messages, streamingAssistantMessageId]
  )
  const messageGroups = useMemo(() => {
    return new Map(groupTranscriptMessages(messages).map((group) => [group.turnId, group]))
  }, [messages])
  const modelNames = useMemo(() => {
    const names = new Map(models.map((model) => [model.id, model.name]))
    for (const message of messages) {
      for (const response of message.responses ?? []) {
        names.set(response.modelId, response.modelName)
      }
    }
    return names
  }, [messages, models])
  const getModelDisplayName = useCallback(
    (modelId: string) => modelNames.get(modelId) ?? modelId,
    [modelNames]
  )
  const scopeStyle = useMemo(() => panelThemeToSharedCssVars(theme, overlayLogoUrl), [theme])
  const resolvedPresentation = useMemo(
    () => ({ ...DESKTOP_TRANSCRIPT_PRESENTATION, ...presentation }),
    [presentation]
  )

  const renderExchange = useCallback(
    (exchange: ChatTranscriptExchangeView, presentation: ChatTranscriptPresentation) => {
      const group = messageGroups.get(exchange.turnId)
      const selectedResponse =
        exchange.responses[exchange.selectedResponseIndex] ?? exchange.responses[0] ?? null
      const selectedModelId = selectedResponse?.modelId ?? exchange.selectedModelId ?? ''
      const targets = resolveDesktopExchangeActionTargets(group, selectedModelId)
      const userMessage =
        targets.userMessage ?? messages.find((message) => message.id === exchange.user.id)
      const { selectionMessage, actionMessage } = targets
      const responseInProgress = ACTIVE_RESPONSE_STATUSES.has(
        selectedResponse?.status ?? exchange.status
      )

      if (exchange.media) {
        const modelIds = userMessage?.generation?.modelIds ?? []
        return (
          <MediaExchange
            exchangeIndex={exchange.index}
            turnId={exchange.turnId}
            kind={exchange.media.kind}
            promptText={exchange.user.text}
            userImages={exchange.user.images.map((image) => ({
              url: image.url,
              name: image.name
            }))}
            replyThread={exchange.user.replyThread}
            results={exchange.media.results}
            modelIds={modelIds}
            modelLabel={modelIds.map(getModelDisplayName).join(', ')}
            getModelDisplayName={getModelDisplayName}
            onJumpToReply={noopTurn}
            onDeleteTurn={() => userMessage && onDelete(userMessage.id)}
            onReply={() => userMessage && onReply(userMessage)}
            onRetry={userMessage ? () => onRetry(userMessage) : undefined}
            onOpenAttachmentPreview={onOpenAttachmentPreview}
            actionVisibility={presentation.actionVisibility}
          />
        )
      }

      return (
        <ChatExchange
          userMsgId={exchange.user.id}
          userBodyText={exchange.user.text}
          userDocumentNames={[...exchange.user.documentNames]}
          userIndexedAttachments={exchange.user.indexedAttachments.map((attachment) => ({
            name: attachment.name,
            fileIds: [...attachment.fileIds]
          }))}
          userImages={exchange.user.images.map((image) => ({
            url: image.url,
            name: image.name,
            mediaType: image.mediaType
          }))}
          exchIdx={exchange.index}
          responseModelId={selectedModelId}
          assistantVisualBlocks={selectedResponse ? [...selectedResponse.blocks] : []}
          isStreaming={selectedResponse?.status === 'streaming'}
          isTextStreaming={selectedResponse?.status === 'streaming'}
          errorMessage={selectedResponse?.errorMessage ?? null}
          exchModelList={exchange.responses.map((response) => response.modelId)}
          selectedTab={Math.max(0, exchange.selectedResponseIndex)}
          onTabSelect={(tabIndex) => {
            const modelId = exchange.responses[tabIndex]?.modelId
            if (selectionMessage && modelId) {
              onSelectResponseModel(selectionMessage.id, modelId)
            }
          }}
          isLoadingTabs={exchange.responses.some((response) =>
            ACTIVE_RESPONSE_STATUSES.has(response.status)
          )}
          responseInProgress={responseInProgress}
          status={selectedResponse?.status ?? exchange.status}
          sourceCitations={selectedResponse?.sourceCitations}
          turnIdForActions={exchange.turnId}
          modelLabel={selectedModelId ? getModelDisplayName(selectedModelId) : ''}
          onDeleteTurn={() => userMessage && onDelete(userMessage.id)}
          onReply={() => actionMessage && onReply(actionMessage)}
          onBranch={onBranch ? () => void onBranch(exchange.turnId) : undefined}
          interrupted={exchange.status === 'interrupted'}
          actionsLocked={actionsLocked}
          replyThreadMeta={exchange.user.replyThread}
          onJumpToReply={noopTurn}
          onOpenDraft={noop}
          onCreateAutomationDraft={noop}
          isSourcesOpenForThis={sourcesPanel?.turnId === exchange.turnId}
          onOpenSources={onOpenSources}
          onRetry={actionMessage ? () => onRetry(actionMessage) : undefined}
          retryDisabled={!actionMessage || responseInProgress}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
          userMentions={exchange.user.mentions.map((mention) => ({
            type: mention.type,
            id: mention.id,
            name: mention.name
          }))}
          getModelDisplayName={getModelDisplayName}
          onContinue={
            onContinue && exchange.index === transcriptView.exchanges.length - 1
              ? onContinue
              : undefined
          }
          presentation={presentation}
        />
      )
    },
    [
      getModelDisplayName,
      messageGroups,
      messages,
      onDelete,
      onBranch,
      onOpenSources,
      onReply,
      onRetry,
      onSelectResponseModel,
      onOpenAttachmentPreview,
      onContinue,
      actionsLocked,
      sourcesPanel,
      transcriptView.exchanges.length
    ]
  )
  const transcriptActions = useMemo(() => ({ renderExchange }), [renderExchange])

  return (
    <ChatReactConfigContext.Provider value={DESKTOP_CHAT_REACT_CONFIG}>
      <div
        className="overlay-chat-surface shared-chat-scope min-w-0"
        data-theme={theme.isDark ? 'dark' : 'light'}
        style={scopeStyle as CSSProperties}
      >
        <div
          className={`mx-auto flex w-full min-w-0 max-w-4xl flex-col ${
            resolvedPresentation.density === 'compact' ? 'gap-3' : 'gap-5 sm:gap-6'
          }`}
        >
          <ChatTranscript
            view={transcriptView}
            actions={transcriptActions}
            presentation={resolvedPresentation}
          />
        </div>
      </div>
    </ChatReactConfigContext.Provider>
  )
}
