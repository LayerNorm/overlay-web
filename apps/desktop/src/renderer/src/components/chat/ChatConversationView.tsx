import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranscriptScroll } from '@overlay/chat-react/transcript'
import type { WebSourceItem } from '@overlay/chat-core'
import type { PanelTheme } from '../../hooks/usePanelTheme'
import { useDesktopChatRuntime, type DesktopChatMode } from '../../hooks/useDesktopChatRuntime'
import { CHATS_CHANGED_EVENT, loadChat } from '../../utils/chatStorage'
import { ChatInputArea, type ChatInputAreaHandle, type ChatSendOptions } from './ChatInputArea'
import { ChatViewHeader } from './ChatViewHeader'
import { DesktopChatTranscript } from './DesktopChatTranscript'
import {
  DesktopAttachmentPreviewDialog,
  DesktopAttachmentPreviewPanel,
  useDesktopAttachmentPreview
} from './DesktopAttachmentPreview'
import { DesktopSourcesPanel } from './DesktopSourcesPanel'
import { isDesktopComposerStreaming } from './desktopRuntimeStatus'
import { EmptyState } from './EmptyState'
import type { ChatModel, Message, Screenshot } from './types'

import type { ReactNode } from 'react'

export interface ChatConversationViewProps {
  chatId: string | null
  theme: PanelTheme
  mode?: DesktopChatMode
  embedded?: boolean
  placeholder?: string
  onChatIdChange?: (chatId: string) => void
  headerLeftSlot?: ReactNode
}

export function ChatConversationView({
  chatId,
  theme,
  mode = 'chat',
  embedded = false,
  placeholder,
  onChatIdChange,
  headerLeftSlot
}: ChatConversationViewProps): React.ReactElement<any> {
  const runtime = useDesktopChatRuntime({
    chatId,
    mode,
    onChatIdChange
  })

  const {
    messages,
    isLoading,
    isBranching,
    streamingAssistantMessageId,
    models,
    selectedModels,
    setSelectedModels,
    memoryEnabled,
    setMemoryEnabled,
    searchEnabled,
    setSearchEnabled,
    supportsVision,
    currentChatId,
    deleteMessage,
    retryMessage,
    replyToMessage,
    selectResponseModel,
    branchConversationAtTurn,
    sendMessage,
    stopStreaming
  } = runtime

  const composerRef = useRef<ChatInputAreaHandle>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [chatTitle, setChatTitle] = useState<string>('New Chat')
  const [sourcesPanel, setSourcesPanel] = useState<{
    turnId: string
    sources: WebSourceItem[]
  } | null>(null)
  const prepareAttachmentPreview = useCallback(() => setSourcesPanel(null), [])
  const attachmentPreview = useDesktopAttachmentPreview(prepareAttachmentPreview)
  useEffect(() => {
    const refreshTitle = (): void => {
      const id = currentChatId
      const title = id ? loadChat(id)?.title : null
      setChatTitle(title || (mode === 'automate' ? 'New Automation' : 'New Chat'))
    }
    refreshTitle()
    window.addEventListener(CHATS_CHANGED_EVENT, refreshTitle)
    return () => window.removeEventListener(CHATS_CHANGED_EVENT, refreshTitle)
  }, [currentChatId, mode])

  useEffect(() => {
    setSourcesPanel(null)
  }, [currentChatId])

  const handleHeaderModelsChange = useCallback(
    (nextModels: ChatModel[]) => {
      setSelectedModels(mode === 'automate' ? nextModels.slice(0, 1) : nextModels.slice(0, 4))
    },
    [mode, setSelectedModels]
  )

  const submittedTurnCount = useMemo(
    () => messages.filter((message) => message.role === 'user').length,
    [messages]
  )
  const composerIsStreaming = useMemo(() => isDesktopComposerStreaming(messages), [messages])
  const { reservedSpace } = useTranscriptScroll({
    containerRef: chatContainerRef,
    endRef: messagesEndRef,
    submittedTurnCount,
    active: isLoading,
    transcriptKey: currentChatId
  })

  useEffect(() => {
    const t = window.setTimeout(() => composerRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [chatId])

  const handleModelSelect = useCallback(
    (model: ChatModel) => {
      if (mode === 'automate') {
        setSelectedModels([model])
        return
      }
      setSelectedModels((prev) => {
        const isSelected = prev.some((m) => m.id === model.id)
        if (isSelected) {
          if (prev.length > 1) return prev.filter((m) => m.id !== model.id)
          return prev
        }
        if (prev.length >= 4) return prev
        return [...prev, model]
      })
    },
    [mode, setSelectedModels]
  )

  const handleSend = useCallback(
    (
      message: string,
      screenshots: Screenshot[],
      _isAgentMode?: boolean,
      options?: ChatSendOptions
    ) => {
      sendMessage(message, screenshots, options?.mentions, options)
    },
    [sendMessage]
  )

  const handleReply = useCallback(
    (message: Message) => {
      const text = replyToMessage(message)
      composerRef.current?.setValue(text)
      composerRef.current?.focus()
    },
    [replyToMessage]
  )

  const openSourcesPanel = useCallback((turnId: string, sources: WebSourceItem[]) => {
    setSourcesPanel((current) => (current?.turnId === turnId ? null : { turnId, sources }))
  }, [])

  const closeSourcesPanel = useCallback(() => {
    setSourcesPanel(null)
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: theme.panelBg,
        color: theme.text
      }}
    >
      <ChatViewHeader
        title={chatTitle}
        theme={theme}
        models={models}
        selectedModels={selectedModels}
        setSelectedModels={handleHeaderModelsChange}
        allowMultiSelect={mode !== 'automate'}
        isAgentMode={mode === 'automate'}
        leftSlot={headerLeftSlot}
      />

      <div
        style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div
            ref={chatContainerRef}
            className="px-3 py-3 sm:px-4 sm:py-4"
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <DesktopChatTranscript
                messages={Array.isArray(messages) ? messages : []}
                models={models}
                onDelete={deleteMessage}
                onRetry={retryMessage}
                onReply={handleReply}
                onBranch={branchConversationAtTurn}
                onOpenSources={openSourcesPanel}
                sourcesPanel={sourcesPanel}
                actionsLocked={isLoading || isBranching}
                onOpenAttachmentPreview={attachmentPreview.open}
                onSelectResponseModel={selectResponseModel}
                streamingAssistantMessageId={streamingAssistantMessageId}
                theme={theme}
              />
            )}
            <div ref={messagesEndRef} />
            {reservedSpace !== null ? (
              <div aria-hidden style={{ height: reservedSpace, flexShrink: 0 }} />
            ) : null}
          </div>

          <div style={{ flexShrink: 0, padding: '12px 24px 16px' }}>
            <ChatInputArea
              ref={composerRef}
              theme={theme}
              models={models}
              selectedModels={selectedModels}
              onModelSelect={handleModelSelect}
              supportsVision={supportsVision}
              placeholder={
                placeholder ||
                (mode === 'automate'
                  ? 'Describe an automation, use @ to reference files, chats, or projects...'
                  : 'Message Overlay...')
              }
              dropdownDirection="up"
              onSend={handleSend}
              embedded={embedded}
              memoryEnabled={memoryEnabled}
              onToggleMemory={() => setMemoryEnabled((prev) => !prev)}
              searchEnabled={searchEnabled}
              onToggleSearch={() => setSearchEnabled((prev) => !prev)}
              chatId={currentChatId ?? undefined}
              forceSingleSelect={mode === 'automate'}
              chatMode={mode === 'automate' ? 'write' : 'ask'}
              containerRef={chatContainerRef}
              isStreaming={composerIsStreaming}
              onStop={stopStreaming}
              showModelSelector={false}
            />
          </div>
        </div>

        {attachmentPreview.preview && attachmentPreview.mode === 'panel' ? (
          <div className="w-[440px] shrink-0 border-l border-[var(--border)]">
            <DesktopAttachmentPreviewPanel
              preview={attachmentPreview.preview}
              onClose={attachmentPreview.close}
              onModeChange={attachmentPreview.setMode}
            />
          </div>
        ) : (
          <DesktopSourcesPanel
            open={sourcesPanel !== null}
            onClose={closeSourcesPanel}
            sources={sourcesPanel?.sources ?? []}
            theme={theme}
          />
        )}
      </div>
      <DesktopAttachmentPreviewDialog
        preview={attachmentPreview.preview}
        mode={attachmentPreview.mode}
        onClose={attachmentPreview.close}
        onModeChange={attachmentPreview.setMode}
      />
    </div>
  )
}
