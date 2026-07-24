import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mergeStreamingConversationParts,
  finalizeStreamingConversationParts,
  type GenerationResult
} from '@overlay/chat-core'
import type {
  ChatModel,
  Message,
  MessageRenderPart,
  ProviderResponse,
  Screenshot
} from '../components/chat/types'
import type { ChatSendOptions } from '../components/chat/ChatInputArea'
import type { Mention } from '../components/chat/MentionInput'
import { useAppBootstrap } from '../contexts/AppBootstrapContext'
import { generateCloudChatTitle, streamCloudActMessage } from '../services/cloud-chat-service'
import { CUSTOM_AUTH_BASE_URL } from '../services/auth-service'
import { analytics } from '../services/analytics'
import {
  CHATS_CHANGED_EVENT,
  createChatBranch,
  createNewChat,
  deleteTurn,
  generateTempTitle,
  getChat,
  loadChat,
  saveChat,
  setLastOpenedChatId,
  updateChatTitle
} from '../utils/chatStorage'
import {
  buildTurnToolInstruction,
  DESKTOP_ACT_SYSTEM_PROMPT,
  HIDDEN_CHAT_MODEL_IDS
} from '../utils/chatRuntimeHelpers'
import { filterToEnabledChatModels } from '../utils/enabledChatModels'
import { screenshotUrl } from '../utils/chatMediaPersistence'
import { migrateLegacyChatMedia } from '../utils/chatMediaPersistence'
import { runDesktopMediaGenerationBatch } from '../services/desktop-media-generation'
import { indexMentionReferences, runAfterUi } from '../utils/knowledgeIndexing'
import {
  cloneMessagesThroughTurn,
  messageIdsForTurnDeletion
} from '../components/chat/desktopTranscriptActions'
import {
  deriveDesktopProviderResponseStatus,
  settleDesktopMessagesAsInterrupted
} from '../components/chat/desktopRuntimeStatus'

export type DesktopChatMode = 'chat' | 'automate'

export interface UseDesktopChatRuntimeParams {
  chatId: string | null
  mode?: DesktopChatMode
  onChatIdChange?: (chatId: string) => void
}

export interface UseDesktopChatRuntimeResult {
  messages: Message[]
  isLoading: boolean
  isBranching: boolean
  streamingAssistantMessageId: string | null
  models: ChatModel[]
  selectedModels: ChatModel[]
  setSelectedModels: React.Dispatch<React.SetStateAction<ChatModel[]>>
  memoryEnabled: boolean
  setMemoryEnabled: React.Dispatch<React.SetStateAction<boolean>>
  searchEnabled: boolean
  setSearchEnabled: React.Dispatch<React.SetStateAction<boolean>>
  supportsVision: boolean
  currentChatId: string | null
  deleteMessage: (messageId: string) => void
  retryMessage: (message: Message) => void
  /** Returns text to insert into the composer. */
  replyToMessage: (message: Message) => string
  selectResponseModel: (messageId: string, modelId: string) => void
  branchConversationAtTurn: (turnId: string) => Promise<void>
  sendMessage: (
    message: string,
    screenshots?: Screenshot[],
    mentions?: Mention[],
    options?: ChatSendOptions
  ) => void
  stopStreaming: () => void
}

export function useDesktopChatRuntime({
  chatId: initialChatId,
  mode = 'chat',
  onChatIdChange
}: UseDesktopChatRuntimeParams): UseDesktopChatRuntimeResult {
  const { chatModels, bootstrap } = useAppBootstrap()

  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isBranching, setIsBranching] = useState(false)
  const [models, setModels] = useState<ChatModel[]>([])
  const [selectedModels, setSelectedModels] = useState<ChatModel[]>([])
  const [memoryEnabled, setMemoryEnabled] = useState(() => {
    const saved = localStorage.getItem('overlay-memory-enabled')
    return saved !== null ? saved === 'true' : true
  })
  const [searchEnabled, setSearchEnabled] = useState(() => {
    return localStorage.getItem('overlay-search-enabled') === 'true'
  })
  const [currentChatId, setCurrentChatId] = useState<string | null>(initialChatId)

  const currentChatIdRef = useRef<string | null>(initialChatId)
  const isLoadingRef = useRef(false)
  const messagesRef = useRef<Message[]>([])
  const streamGenerationRef = useRef(0)
  const mediaAbortRef = useRef<AbortController | null>(null)
  const branchingRef = useRef(false)

  useEffect(() => {
    currentChatIdRef.current = currentChatId
  }, [currentChatId])

  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    localStorage.setItem('overlay-memory-enabled', String(memoryEnabled))
  }, [memoryEnabled])

  useEffect(() => {
    localStorage.setItem('overlay-search-enabled', String(searchEnabled))
  }, [searchEnabled])

  // Load models
  useEffect(() => {
    try {
      const visibleModels = filterToEnabledChatModels(
        chatModels.filter((m) => !HIDDEN_CHAT_MODEL_IDS.has(m.id)),
        bootstrap?.uiSettings?.enabledChatModelIds
      )
      setModels(visibleModels)

      if (visibleModels.length === 0) return

      setSelectedModels((prevSelected) => {
        const savedModelIds = localStorage.getItem('chatPanel.selectedModelIds')
        if (savedModelIds) {
          try {
            const ids = JSON.parse(savedModelIds) as string[]
            const savedModels = ids
              .map((id) => visibleModels.find((m) => m.id === id))
              .filter((m): m is ChatModel => m !== undefined && !m.disabled)
            if (savedModels.length > 0)
              return mode === 'automate' ? savedModels.slice(0, 1) : savedModels
          } catch {
            // fall through
          }
        }

        if (prevSelected.length > 0) {
          const stillValid = prevSelected
            .map((selected) => visibleModels.find((m) => m.id === selected.id))
            .filter((m): m is ChatModel => m !== undefined && !m.disabled)
          if (stillValid.length > 0)
            return mode === 'automate' ? stillValid.slice(0, 1) : stillValid
        }

        const enabledModels = visibleModels.filter((m) => !m.disabled)
        if (enabledModels.length === 0) return []
        const defaultModel =
          enabledModels.find((m) => m.id === bootstrap?.defaults?.chatModelId) ||
          enabledModels.find((m) => m.supportsVision && m.provider === 'groq') ||
          enabledModels.find((m) => m.provider === 'groq') ||
          enabledModels[0]
        return defaultModel ? [defaultModel] : []
      })
    } catch (err) {
      console.error('[useDesktopChatRuntime] Failed to load models:', err)
    }
  }, [
    chatModels,
    bootstrap?.defaults?.chatModelId,
    bootstrap?.uiSettings?.enabledChatModelIds,
    mode
  ])

  useEffect(() => {
    if (selectedModels.length > 0) {
      localStorage.setItem(
        'chatPanel.selectedModelIds',
        JSON.stringify(selectedModels.map((m) => m.id))
      )
    }
  }, [selectedModels])

  // Load chat when chatId changes
  useEffect(() => {
    setCurrentChatId(initialChatId)
    currentChatIdRef.current = initialChatId
    if (!initialChatId) {
      messagesRef.current = []
      setMessages([])
      return
    }

    let cancelled = false
    const cached = loadChat(initialChatId)
    const cachedMessages = Array.isArray(cached?.messages) ? cached.messages : []
    messagesRef.current = cachedMessages
    setMessages(cachedMessages)
    if (cached) setLastOpenedChatId(initialChatId)

    void getChat(initialChatId)
      .then((remoteChat) => {
        if (cancelled) return
        if (isLoadingRef.current) return
        if (!remoteChat || currentChatIdRef.current !== initialChatId) return
        const remoteMessages = Array.isArray(remoteChat.messages) ? remoteChat.messages : []
        // Avoid clobbering optimistic local messages mid-send.
        if (
          messagesRef.current.length === 0 ||
          remoteMessages.length > messagesRef.current.length
        ) {
          messagesRef.current = remoteMessages
          setMessages(remoteMessages)
        }
        setLastOpenedChatId(initialChatId)
      })
      .catch((error) => {
        console.error('[useDesktopChatRuntime] Failed to load chat:', error)
      })

    return () => {
      cancelled = true
    }
  }, [initialChatId])

  // Listen for shared cache changes.
  // Only adopt the cached copy when it is meaningfully different (a message was
  // added or removed elsewhere). saveChat() re-emits CHATS_CHANGED with a freshly
  // cloned messages array; blindly adopting that new identity re-triggered the
  // persist effect below and created an infinite save -> event -> setState loop
  // that pegged the CPU and ballooned memory.
  useEffect(() => {
    const handler = (): void => {
      if (isLoadingRef.current) return
      const chatId = currentChatIdRef.current
      if (!chatId) return
      const chat = loadChat(chatId)
      if (!chat) return
      const incoming = Array.isArray(chat.messages) ? chat.messages : []
      const current = messagesRef.current
      if (incoming === current) return
      const sameShape =
        incoming.length === current.length &&
        (incoming.length === 0 ||
          incoming[incoming.length - 1]?.id === current[current.length - 1]?.id)
      if (sameShape) return
      messagesRef.current = incoming
      setMessages(incoming)
    }
    window.addEventListener('storage', handler)
    window.addEventListener(CHATS_CHANGED_EVENT, handler)
    return () => {
      window.removeEventListener('storage', handler)
      window.removeEventListener(CHATS_CHANGED_EVENT, handler)
    }
  }, [])

  // Persist after streaming settles (once per messages identity)
  const isMountedRef = useRef(false)
  const lastPersistedMessagesRef = useRef<Message[] | null>(null)
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      return
    }
    if (isLoading) return
    const chatId = currentChatIdRef.current
    if (!chatId || messages.length === 0) return
    if (lastPersistedMessagesRef.current === messages) return
    lastPersistedMessagesRef.current = messages
    const chat = loadChat(chatId)
    if (chat) {
      chat.messages = messages
      chat.updatedAt = Date.now()
      saveChat(chat)
    }
  }, [messages, isLoading])

  const supportsVision = useMemo(
    () => selectedModels.length > 0 && selectedModels.every((m) => m.supportsVision),
    [selectedModels]
  )

  const streamingAssistantMessageId = useMemo(() => {
    const active = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' && message.responses?.some((response) => response.isLoading)
      )
    return active?.id ?? null
  }, [messages])

  const deleteMessage = useCallback((messageId: string) => {
    setMessages((prevMessages) => {
      const messageIds = messageIdsForTurnDeletion(prevMessages, messageId)
      if (messageIds.size === 0) return prevMessages
      const deletedMessage = prevMessages.find((message) => message.id === messageId)!
      const filteredMessages = prevMessages.filter((message) => !messageIds.has(message.id))
      const chatId = currentChatIdRef.current
      if (chatId) {
        void deleteTurn(chatId, deletedMessage.turnId || deletedMessage.id).catch((error) => {
          console.error('[useDesktopChatRuntime] Failed to delete remote turn:', error)
        })
        const chat = loadChat(chatId)
        if (chat) {
          chat.messages = filteredMessages
          chat.updatedAt = Date.now()
          saveChat(chat)
        }
      }
      messagesRef.current = filteredMessages
      return filteredMessages
    })
  }, [])

  const selectResponseModel = useCallback((messageId: string, modelId: string) => {
    setMessages((prev) => {
      const next = prev.map((m) => {
        if (m.id !== messageId) return m
        const selected = m.responses?.find((r) => r.modelId === modelId)
        return {
          ...m,
          selectedModelId: modelId,
          content: selected?.content || m.content,
          renderParts: selected?.renderParts || m.renderParts
        }
      })
      messagesRef.current = next
      return next
    })
  }, [])

  const replyToMessage = useCallback((message: Message): string => {
    const snippet = (
      message.role === 'assistant'
        ? message.responses?.find((response) => response.modelId === message.selectedModelId)
            ?.content ||
          message.responses?.[0]?.content ||
          message.content
        : message.content
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 160)
    return snippet ? `Replying to: "${snippet}"\n\n` : ''
  }, [])

  const stopStreaming = useCallback(() => {
    mediaAbortRef.current?.abort()
    mediaAbortRef.current = null
    streamGenerationRef.current += 1
    isLoadingRef.current = false
    setIsLoading(false)
    setMessages((prev) => {
      const next = settleDesktopMessagesAsInterrupted(prev)
      messagesRef.current = next
      return next
    })
  }, [])

  const sendMessage = useCallback(
    (
      message: string,
      messageScreenshots: Screenshot[] = [],
      messageMentions: Mention[] = [],
      sendOptions?: ChatSendOptions
    ): void => {
      void (async () => {
        const modelsForMessage =
          mode === 'automate' ? selectedModels.slice(0, 1) : selectedModels.slice(0, 4)
        const generationMode = sendOptions?.generationMode ?? 'text'
        const mediaModelIds = sendOptions?.mediaModelIds?.slice(0, 4) ?? []
        const userContent = message.trim()
        if (
          (generationMode === 'text'
            ? userContent.length === 0 && messageScreenshots.length === 0
            : userContent.length === 0 || mediaModelIds.length === 0) ||
          (generationMode === 'text' && modelsForMessage.length === 0) ||
          isLoadingRef.current
        ) {
          return
        }

        analytics.increment('messages_sent')

        const baseMessages = messagesRef.current
        const memoryForTurn = sendOptions?.memoryEnabled ?? memoryEnabled
        const turnToolInstruction = buildTurnToolInstruction(sendOptions)
        const effectiveMentions = sendOptions?.mentions ?? messageMentions

        let activeChatId = currentChatIdRef.current
        const isNewChat = !activeChatId
        if (isNewChat) {
          const chat = await createNewChat(modelsForMessage[0]?.id ?? mediaModelIds[0])
          activeChatId = chat.id
          currentChatIdRef.current = chat.id
          setCurrentChatId(chat.id)
        }

        const imageDataArray = messageScreenshots.map(screenshotUrl).filter(Boolean)
        const isFirstMessage = baseMessages.length === 0
        const userMessageId = `${Date.now()}-user`
        const userMessage: Message = {
          id: userMessageId,
          turnId: userMessageId,
          role: 'user',
          content: userContent,
          timestamp: Date.now(),
          imageData: imageDataArray[0],
          screenshots: messageScreenshots.length > 0 ? [...messageScreenshots] : undefined,
          mentions:
            effectiveMentions.length > 0
              ? effectiveMentions.map((m) => ({
                  id: m.id,
                  type: m.type,
                  title: m.title,
                  preview: m.preview,
                  folderId: m.folderId,
                  filename: m.filename,
                  filepath: m.filepath
                }))
              : undefined
        }

        if (generationMode === 'image' || generationMode === 'video') {
          const initialResults: GenerationResult[] = mediaModelIds.map(() => ({
            type: generationMode,
            status: 'generating'
          }))
          userMessage.generation = {
            kind: generationMode,
            modelIds: mediaModelIds,
            results: initialResults,
            ...(generationMode === 'video' && sendOptions?.videoSubMode
              ? { videoSubMode: sendOptions.videoSubMode }
              : {})
          }
          const newMessages = [...baseMessages, userMessage]
          messagesRef.current = newMessages
          setMessages(newMessages)
          isLoadingRef.current = true
          setIsLoading(true)
          const generation = ++streamGenerationRef.current
          const controller = new AbortController()
          mediaAbortRef.current = controller
          const chatId = activeChatId as string

          const persistMediaMessages = async (nextMessages: Message[]): Promise<void> => {
            const chat = loadChat(chatId)
            if (!chat) return
            chat.messages = nextMessages
            chat.updatedAt = Date.now()
            const migrated = await migrateLegacyChatMedia(chat, window.bridge.chatMedia)
            messagesRef.current = migrated.chat.messages
            setMessages(migrated.chat.messages)
            await saveChat(migrated.chat)
          }

          await persistMediaMessages(newMessages)
          if (isNewChat) onChatIdChange?.(chatId)
          if (isFirstMessage) updateChatTitle(chatId, generateTempTitle(userContent))

          try {
            await runDesktopMediaGenerationBatch({
              kind: generationMode,
              prompt: userContent,
              modelIds: mediaModelIds,
              conversationId: chatId,
              turnId: userMessageId,
              imageUrl: imageDataArray[0],
              videoSubMode: sendOptions?.videoSubMode,
              signal: controller.signal,
              cacheDataUrl: window.bridge.chatMedia.cacheDataUrl,
              onSlot: (index, result) => {
                if (streamGenerationRef.current !== generation) return
                setMessages((current) => {
                  const next = current.map((candidate) => {
                    if (candidate.id !== userMessageId || !candidate.generation) return candidate
                    const results = [...candidate.generation.results]
                    results[index] = result
                    return {
                      ...candidate,
                      generation: { ...candidate.generation, results }
                    }
                  })
                  messagesRef.current = next
                  return next
                })
              }
            })
          } finally {
            if (streamGenerationRef.current === generation) {
              mediaAbortRef.current = null
              isLoadingRef.current = false
              setIsLoading(false)
              await persistMediaMessages(messagesRef.current)
            }
          }
          return
        }

        const initialResponses: ProviderResponse[] = modelsForMessage.map((model) => ({
          modelId: model.id,
          modelName: model.name,
          provider: model.provider,
          content: '',
          isLoading: true,
          renderParts: [],
          status: 'submitted'
        }))

        const assistantMessageId = `${Date.now()}-assistant`
        const assistantMessage: Message & { turnId: string } = {
          id: assistantMessageId,
          turnId: userMessage.id,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          responses: initialResponses,
          selectedModelId: undefined
        }

        const newMessages = [...baseMessages, userMessage, assistantMessage]
        messagesRef.current = newMessages
        setMessages(newMessages)
        // Persist the optimistic messages immediately for a brand-new chat. The
        // parent window (MainWindow) will be notified via onChatIdChange next, and
        // its load effect must find saved messages so it does not clobber them
        // with the empty chat state.
        if (isNewChat && activeChatId) {
          const chat = loadChat(activeChatId)
          if (chat) {
            chat.messages = newMessages
            chat.updatedAt = Date.now()
            saveChat(chat)
          }
          onChatIdChange?.(activeChatId)
        }
        // activeChatId is guaranteed to be set (either originally or from the new chat above).
        const chatId = activeChatId as string
        // Set the ref synchronously: updateChatTitle() below emits CHATS_CHANGED in
        // the same tick, and the cache handler must not clobber the optimistic
        // user/assistant messages with the stale cached copy.
        isLoadingRef.current = true
        setIsLoading(true)
        const generation = ++streamGenerationRef.current

        runAfterUi(
          () => indexMentionReferences(effectiveMentions),
          'Failed to index mention references after send'
        )

        if (isFirstMessage) {
          updateChatTitle(chatId, generateTempTitle(userContent || 'Image attachment'))
        }

        // Hydrate mention content for the model prompt.
        let mentionContext = ''
        if (effectiveMentions.length > 0) {
          const mentionContents: string[] = []
          for (const mention of effectiveMentions) {
            try {
              if (mention.type === 'note') {
                const note = await window.bridge.loadNote(mention.id)
                if (note?.content) {
                  mentionContents.push(
                    `[Attached Note: ${mention.title}]\n${note.content}\n[End of Note]`
                  )
                }
              } else if (mention.type === 'chat') {
                mentionContents.push(`[Referenced Chat: ${mention.title}]`)
              } else if (mention.type === 'document') {
                const chunksResult = await window.bridge.document.getChunks(mention.id)
                if (chunksResult.success && chunksResult.chunks?.length) {
                  const docContent = chunksResult.chunks
                    .slice(0, 50)
                    .map((c: { content: string }) => c.content)
                    .join('\n\n')
                  const truncatedContent =
                    docContent.length > 30000
                      ? `${docContent.slice(0, 30000)}\n...[truncated]`
                      : docContent
                  mentionContents.push(
                    `[Attached Document: ${mention.title}]\n${truncatedContent}\n[End of Document]`
                  )
                } else {
                  mentionContents.push(`[Referenced Document: ${mention.title}]`)
                }
              } else if (mention.type === 'file' && mention.filepath) {
                const fileResult = await window.bridge.workspace.readFile(mention.filepath)
                if (fileResult.success && fileResult.content) {
                  const content = fileResult.truncated
                    ? `${fileResult.content}\n...[truncated]`
                    : fileResult.content
                  mentionContents.push(
                    `[File: ${mention.filepath}]\n\`\`\`\n${content}\n\`\`\`\n[End of File]`
                  )
                } else {
                  mentionContents.push(`[Referenced File: ${mention.title}]`)
                }
              }
            } catch (err) {
              console.error(
                `[useDesktopChatRuntime] Failed to fetch mention content for ${mention.id}:`,
                err
              )
            }
          }
          if (mentionContents.length > 0) {
            mentionContext = mentionContents.join('\n\n')
          }
        }

        let contextPrompt = ''
        if (memoryForTurn) {
          try {
            const contextResult = await window.bridge.context.getForMessage({
              userMessage: userContent,
              chatId,
              recentMessages: baseMessages.slice(-6).map((m) => m.content)
            })
            if (contextResult.success && contextResult.contextPrompt) {
              contextPrompt = contextResult.contextPrompt
            }
          } catch (error) {
            console.error('[useDesktopChatRuntime] Failed to get context:', error)
          }
        }

        const streamedContent: Record<string, string> = {}
        const streamedRenderParts: Record<string, MessageRenderPart[]> = {}

        const sendToModelWithStreaming = async (model: ChatModel): Promise<ProviderResponse> => {
          streamedContent[model.id] = ''
          streamedRenderParts[model.id] = []

          // Coalesce per-token stream updates into at most ~10 state updates/sec;
          // per-token setState caused a re-render storm. setTimeout (not rAF) so
          // streaming keeps flowing while the window is hidden/occluded.
          let syncScheduled = false
          let hasPendingChanges = false
          let streamError: string | null = null
          const syncResponseParts = (): void => {
            if (streamGenerationRef.current !== generation) return
            if (!hasPendingChanges) return
            if (syncScheduled) return
            syncScheduled = true
            window.setTimeout(() => {
              syncScheduled = false
              if (streamGenerationRef.current !== generation) return
              hasPendingChanges = false
              flushResponseParts()
            }, 100)
          }

          const flushResponseParts = (): void => {
            setMessages((prev) => {
              const assistantIdx = prev.findIndex((m) => m.id === assistantMessageId)
              if (assistantIdx === -1) return prev
              const msg = prev[assistantIdx]
              const responseIdx = msg.responses?.findIndex((r) => r.modelId === model.id) ?? -1
              if (responseIdx === -1) return prev

              const existingResponse = msg.responses![responseIdx]
              const newContent = streamedContent[model.id]
              const newRenderParts = streamedRenderParts[model.id]
              // Skip if nothing actually changed since the last flush.
              if (
                existingResponse.content === newContent &&
                existingResponse.renderParts === newRenderParts
              ) {
                return prev
              }

              const responses = [...(msg.responses || [])]
              responses[responseIdx] = {
                ...existingResponse,
                content: newContent,
                renderParts: [...newRenderParts],
                // Preserve the current loading flag: a throttled flush can land
                // after the final response already marked this model done.
                isLoading: existingResponse.isLoading,
                status: streamError
                  ? 'error'
                  : deriveDesktopProviderResponseStatus({
                      ...existingResponse,
                      content: newContent,
                      renderParts: newRenderParts
                    })
              }

              const newSelectedModelId = msg.selectedModelId || model.id
              const selectedResponse = responses.find((r) => r.modelId === newSelectedModelId)
              const updated: Message[] = [...prev]
              updated[assistantIdx] = {
                ...msg,
                responses,
                renderParts: selectedResponse?.renderParts || msg.renderParts,
                content: selectedResponse?.content || msg.content,
                selectedModelId: newSelectedModelId
              }
              messagesRef.current = updated
              return updated
            })
          }

          const partIdPrefix = `${assistantMessageId}:${model.id}`
          const mergeParts = (newParts: MessageRenderPart[]): void => {
            const prevLength = streamedRenderParts[model.id].length
            const prevContent = streamedContent[model.id]
            streamedRenderParts[model.id] = mergeStreamingConversationParts(
              streamedRenderParts[model.id],
              newParts,
              partIdPrefix
            )
            for (const part of newParts) {
              if (part.type === 'text') streamedContent[model.id] += part.text
            }
            if (
              streamedRenderParts[model.id].length !== prevLength ||
              streamedContent[model.id] !== prevContent
            ) {
              hasPendingChanges = true
            }
          }

          const replaceWithTextPart = (text: string): void => {
            streamedRenderParts[model.id] = [
              {
                type: 'text',
                id: `${partIdPrefix}:text:error`,
                text
              }
            ]
            streamedContent[model.id] = text
            hasPendingChanges = true
          }

          try {
            const slotIndex = modelsForMessage.findIndex((m) => m.id === model.id)
            const systemPrompt = [
              DESKTOP_ACT_SYSTEM_PROMPT,
              turnToolInstruction,
              mentionContext ? `Attached context:\n${mentionContext}` : '',
              contextPrompt ? `Relevant user context:\n${contextPrompt}` : ''
            ]
              .filter(Boolean)
              .join('\n\n')

            await streamCloudActMessage({
              conversationId: chatId,
              turnId: userMessage.id,
              modelId: model.id,
              messages: [...baseMessages, userMessage],
              mode: mode === 'automate' ? 'automate' : 'chat',
              systemPrompt: systemPrompt || undefined,
              multiModelSlotIndex: modelsForMessage.length > 1 ? slotIndex : undefined,
              multiModelTotal: modelsForMessage.length > 1 ? modelsForMessage.length : undefined,
              onChunk: (chunk) => {
                if (streamGenerationRef.current !== generation) return
                if (chunk.type === 'parts') {
                  mergeParts(chunk.parts)
                  syncResponseParts()
                } else if (chunk.type === 'done') {
                  streamedRenderParts[model.id] = finalizeStreamingConversationParts(
                    streamedRenderParts[model.id]
                  )
                  syncResponseParts()
                } else if (chunk.type === 'error') {
                  streamError = chunk.content || 'Generation failed'
                  if (chunk.content === 'premium_model_not_allowed') {
                    streamedContent[model.id] =
                      `**${model.name}** is a premium model. Please upgrade to [Pro](${CUSTOM_AUTH_BASE_URL}/pricing) or [Max](${CUSTOM_AUTH_BASE_URL}/pricing) to access premium models.`
                  } else if (chunk.content === 'daily_limit_exceeded') {
                    streamedContent[model.id] =
                      `You've reached your daily limit. Upgrade to [Pro](${CUSTOM_AUTH_BASE_URL}/pricing) for more requests.`
                  } else if (chunk.content === 'insufficient_credits') {
                    streamedContent[model.id] =
                      `You've run out of credits. Visit your [account](${CUSTOM_AUTH_BASE_URL}/account) to purchase more.`
                  } else {
                    streamedContent[model.id] = `Error: ${chunk.content}`
                  }
                  replaceWithTextPart(streamedContent[model.id])
                  syncResponseParts()
                }
              }
            })

            return {
              modelId: model.id,
              modelName: model.name,
              provider: model.provider,
              content: streamedContent[model.id] || '',
              isLoading: false,
              renderParts: [...streamedRenderParts[model.id]],
              status: streamError ? 'error' : 'completed',
              error: streamError ?? undefined
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error && error.message.trim()
                ? error.message
                : 'An error occurred while sending the message.'
            console.error('[useDesktopChatRuntime] Cloud act send failed:', error)
            return {
              modelId: model.id,
              modelName: model.name,
              provider: model.provider,
              content: errorMessage,
              isLoading: false,
              renderParts: [
                {
                  type: 'text',
                  id: `${assistantMessageId}:${model.id}:error`,
                  text: errorMessage
                }
              ],
              error: String(error),
              status: 'error'
            }
          }
        }

        try {
          const updateFinalResponse = (response: ProviderResponse): void => {
            if (streamGenerationRef.current !== generation) return
            setMessages((prev) => {
              const updated = [...prev]
              const assistantIdx = updated.findIndex((m) => m.id === assistantMessageId)
              if (assistantIdx === -1) return prev
              const msg = updated[assistantIdx]
              const responses: ProviderResponse[] = msg.responses?.map((r) =>
                r.modelId === response.modelId
                  ? {
                      ...response,
                      isLoading: false,
                      status: response.error ? ('error' as const) : ('completed' as const)
                    }
                  : r
              ) || [response]
              const nextSelectedModelId = msg.selectedModelId || response.modelId
              const selectedResponse =
                responses.find((r) => r.modelId === nextSelectedModelId) || responses[0]
              updated[assistantIdx] = {
                ...msg,
                responses,
                selectedModelId: nextSelectedModelId,
                content: selectedResponse?.content || msg.content,
                renderParts: selectedResponse?.renderParts || msg.renderParts
              }
              messagesRef.current = updated
              return updated
            })
          }

          const completedResponses = await Promise.all(
            modelsForMessage.map((model) =>
              sendToModelWithStreaming(model).then((response) => {
                updateFinalResponse(response)
                return response
              })
            )
          )

          if (streamGenerationRef.current !== generation) return

          // Best-effort memory extraction
          const primaryResponse = completedResponses.find((r) => !r.error && r.content)
          if (memoryForTurn && primaryResponse) {
            const conversationContext = baseMessages.slice(-6).map((m) => `${m.role}: ${m.content}`)
            void window.bridge.memory
              .extract({
                userMessage: userContent,
                chatId,
                messageId: assistantMessageId,
                conversationContext
              })
              .then((extractionResult) => {
                if (!extractionResult.extracted.length) return
                setMessages((prev) => {
                  const updated = [...prev]
                  const assistantIdx = updated.findIndex((m) => m.id === assistantMessageId)
                  if (assistantIdx === -1) return prev
                  updated[assistantIdx] = {
                    ...updated[assistantIdx],
                    addedMemories: extractionResult.extracted.map((mem, idx) => ({
                      id: extractionResult.ids[idx] || `temp-${idx}`,
                      content: mem.content,
                      type: mem.type,
                      importance: mem.importance
                    }))
                  }
                  messagesRef.current = updated
                  return updated
                })
              })
              .catch((err) =>
                console.error('[useDesktopChatRuntime] Memory extraction failed:', err)
              )
          }

          setMessages((prev) => {
            messagesRef.current = prev
            const chat = loadChat(chatId)
            if (chat) {
              chat.messages = prev
              chat.updatedAt = Date.now()
              saveChat(chat)
            }
            return prev
          })

          if (isFirstMessage) {
            void generateCloudChatTitle(userContent)
              .then((title) => {
                if (title) updateChatTitle(chatId, title.trim().slice(0, 50))
              })
              .catch(() => {})
          }
        } catch (error) {
          console.error('[useDesktopChatRuntime] Chat error:', error)
        } finally {
          if (streamGenerationRef.current === generation) {
            isLoadingRef.current = false
            setIsLoading(false)
          }
        }
      })()
    },
    [memoryEnabled, mode, onChatIdChange, selectedModels]
  )

  const retryMessage = useCallback(
    (message: Message) => {
      const source =
        message.role === 'user'
          ? message
          : [...messagesRef.current]
              .slice(
                0,
                messagesRef.current.findIndex((m) => m.id === message.id)
              )
              .reverse()
              .find((candidate) => candidate.role === 'user')
      if (!source) return

      const retryMentions: Mention[] =
        source.mentions
          ?.filter(
            (mention): mention is Mention =>
              mention.type === 'note' ||
              mention.type === 'chat' ||
              mention.type === 'document' ||
              mention.type === 'file'
          )
          .map((mention) => ({
            id: mention.id,
            type: mention.type,
            title: mention.title,
            preview: mention.preview,
            folderId: mention.folderId,
            filename: mention.filename,
            filepath: mention.filepath
          })) ?? []

      sendMessage(source.content, source.screenshots ?? [], retryMentions, {
        requestedTools: [],
        memoryEnabled,
        mentions: retryMentions,
        generationMode: source.generation?.kind ?? 'text',
        mediaModelIds: source.generation?.modelIds,
        videoSubMode: source.generation?.videoSubMode
      })
    },
    [memoryEnabled, sendMessage]
  )

  const branchConversationAtTurn = useCallback(
    async (turnId: string): Promise<void> => {
      const sourceChatId = currentChatIdRef.current
      if (branchingRef.current || isLoadingRef.current || !sourceChatId) return

      const branchMessages = cloneMessagesThroughTurn(messagesRef.current, turnId)
      if (!branchMessages) return

      branchingRef.current = true
      setIsBranching(true)
      try {
        const sourceChat = loadChat(sourceChatId) ?? (await getChat(sourceChatId))
        if (!sourceChat) throw new Error('Source chat could not be loaded')

        const branch = await createChatBranch(
          sourceChat,
          branchMessages,
          selectedModels[0]?.id
        )
        analytics.increment('chats_created')
        currentChatIdRef.current = branch.id
        messagesRef.current = branchMessages
        setCurrentChatId(branch.id)
        setMessages(branchMessages)
        setLastOpenedChatId(branch.id)
        onChatIdChange?.(branch.id)
      } catch (error) {
        console.error('[useDesktopChatRuntime] Failed to branch chat:', error)
      } finally {
        branchingRef.current = false
        setIsBranching(false)
      }
    },
    [onChatIdChange, selectedModels]
  )

  return {
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
  }
}
