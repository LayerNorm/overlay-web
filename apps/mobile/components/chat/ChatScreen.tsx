import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { hapticImpact, hapticNotify } from '../../lib/haptics'
import * as ImagePicker from 'expo-image-picker'
import type { ChatModel } from '../../services/chatTypes'
import {
  generateChatId,
  generateMessageId,
  generateTempTitle,
  type Chat,
  type ChatMeta,
  type ChatMentionItem,
  type Message,
} from '../../services/chatTypes'
import {
  createNewChat,
  getLastOpenedChatId,
  loadChat,
  loadChatsMeta,
  saveChat,
  subscribeChats,
  subscribePersonalChat,
  setPersonalChatRead,
  setLastOpenedChatId,
} from '../../services/chatStorage'
import { chatStream, getAvailableModels, getLastSelectedModelId, setLastSelectedModelId, stopConversation, uploadDocument, type StreamChunk, type IndexedAttachment, type ChatToolRequestId } from '../../services/aiService'
import {
  generateImage,
  generateVideo,
  submitRunApproval,
} from '../../services/conversationActionsService'
import { mentionToRequestBody } from '../../lib/chatMentions'
import { submitPersonalTurn, watchPersonalExecution, type PersonalRun, type PersonalTurn } from '../../services/personalChatService'
import { getRequestWorkspaceId } from '../../services/appApi'
import { useFavoriteModels } from '../../hooks/useFavoriteModels'
import { useAndroidKeyboardVisible } from '../../hooks/useAndroidKeyboardVisible'
import { resolveAutoModel, sortChatModels } from '../../lib/chatModels'
import { getComposerBottomInset } from '../../lib/keyboardLayout'
import { ModelPicker } from './ModelPicker'
import { ChatHeader, ChatSheet, EmptyPersonalChat } from './ChatViews'
import { appendPersonalBlock } from '../../lib/personalStream'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { MessageBubble } from './MessageBubble'
import { Composer, type ComposerReplyContext, type PendingDocument } from './Composer'
import { ChatActionsSheet } from './ChatActionsSheet'
import { DraftReviewSheet } from './DraftReviewSheet'
import { createSkill } from '../../services/integrationsService'
import type { DraftModalState } from '@overlay/chat-core'
import { DrawerSidebar } from './DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import { useDrawer } from '../../contexts/DrawerContext'
import { FloatingSearchBar } from '../ui/FloatingSearchBar'
import { ListRow, Section } from '../ui/primitives'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { useAppSession } from '../../contexts/AppSessionContext'
import { UpgradePrompt } from '../auth/UpgradePrompt'
import { useAuth } from '../../contexts/AuthContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import * as DocumentPicker from 'expo-document-picker'


async function orderedChatModels(models: ChatModel[]): Promise<ChatModel[]> {
  return sortChatModels(models)
}


function createDraftChat(modelId?: string): Chat {
  const now = Date.now()
  return {
    id: generateChatId(),
    title: 'New Chat',
    createdAt: now,
    updatedAt: now,
    lastMode: 'act',
    askModelIds: modelId ? [modelId] : [],
    actModelId: modelId,
    modelId,
    messages: [],
  }
}

function upsertToolInvocation(message: Message, chunk: StreamChunk): Message {
  if (chunk.type !== 'tool') return message

  const toolInvocations = [...(message.toolInvocations || [])]
  const index = toolInvocations.findIndex(
    (tool) =>
      (chunk.toolCallId && tool.toolCallId === chunk.toolCallId) ||
      (!!chunk.toolName && tool.toolName === chunk.toolName),
  )

  const nextTool = {
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName || toolInvocations[index]?.toolName || 'Tool',
    state: chunk.state,
    toolInput:
      chunk.state === 'input-available'
        ? (chunk.input as Record<string, unknown> | undefined)
        : toolInvocations[index]?.toolInput,
    toolOutput:
      chunk.state === 'output-available'
        ? chunk.output
        : chunk.state === 'output-error'
          ? { error: chunk.content }
          : toolInvocations[index]?.toolOutput,
  }

  if (index >= 0) {
    toolInvocations[index] = {
      ...toolInvocations[index],
      ...nextTool,
    }
  } else {
    toolInvocations.push(nextTool)
  }

  return {
    ...message,
    toolInvocations,
  }
}

function applyStreamChunk(
  messages: Message[],
  assistantId: string,
  selectedModel: ChatModel,
  chunk: StreamChunk,
): Message[] {
  return messages.map((message) => {
    if (message.id !== assistantId) return message
    message = { ...message, blocks: appendPersonalBlock(message.blocks ?? [], chunk) }

    const response = message.responses?.[0] || {
      modelId: selectedModel.id,
      modelName: selectedModel.name,
      provider: selectedModel.provider,
      content: '',
      isLoading: true,
    }

    if (chunk.type === 'text') {
      const content = `${message.content}${chunk.content}`
      return {
        ...message,
        content,
        responses: [
          {
            ...response,
            content,
            isLoading: true,
          },
        ],
      }
    }

    if (chunk.type === 'reasoning') {
      return {
        ...message,
        reasoning: `${message.reasoning || ''}${chunk.content}`,
      }
    }

    if (chunk.type === 'tool') {
      return upsertToolInvocation(message, chunk)
    }

    if (chunk.type === 'file' && chunk.url) {
      return {
        ...message,
        generatedFiles: [
          ...(message.generatedFiles || []),
          {
            url: chunk.url,
            mediaType: chunk.mediaType || 'application/octet-stream',
          },
        ],
      }
    }

    if (chunk.type === 'error') {
      const content = message.content || `Error: ${chunk.content}`
      return {
        ...message,
        content,
        responses: [
          {
            ...response,
            content,
            isLoading: false,
            error: chunk.content,
          },
        ],
      }
    }

    if (chunk.type === 'finish' || chunk.type === 'done') {
      return {
        ...message,
        responses: [
          {
            ...response,
            content: message.content,
            isLoading: false,
          },
        ],
      }
    }

    return message
  })
}

function buildApiMessages(messages: Message[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    imageData: message.imageData,
    replyToTurnId: message.replyToTurnId,
    replySnippet: message.replySnippet,
  }))
}


function getNextTitle(currentTitle: string, inputValue: string): string {
  if (currentTitle === 'New Chat' && inputValue.trim()) {
    return generateTempTitle(inputValue.trim())
  }

  return currentTitle
}

export function ChatScreen({
  conversationId,
  routeKind,
}: {
  conversationId?: string
  routeKind: 'tab' | 'detail'
}): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const { openDrawer, drawerVisible } = useDrawer()
  const { entitlements, chatModels, imageModels, videoModels, uiSettings, capabilities } = useAppSession()
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth()
  const { favoriteIds, toggleFavorite } = useFavoriteModels(user?.id)
  const [autoSelected, setAutoSelected] = useState(true)
  const nativeReady = useNativeDataReady()
  const { activeWorkspaceId } = useWorkspace()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useAndroidKeyboardVisible()

  const [messages, setMessages] = useState<Message[]>([])
  const [chatTitle, setChatTitle] = useState('New Chat')
  const [inputValue, setInputValue] = useState('')
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null)
  const [availableModels, setAvailableModels] = useState<ChatModel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSwitchingChat, setIsSwitchingChat] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [history, setHistory] = useState<ChatMeta[]>([])
  const [modelPickerVisible, setModelPickerVisible] = useState(false)
  const [upgradeVisible, setUpgradeVisible] = useState(false)
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  // ── Phase 2 composer state ────────────────────────────────────────────────
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [selectedToolIds, setSelectedToolIds] = useState<ChatToolRequestId[]>([])
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [requestMode, setRequestMode] = useState<'chat' | 'automate'>('chat')
  const [mentions, setMentions] = useState<ChatMentionItem[]>([])
  const [replyContext, setReplyContext] = useState<ComposerReplyContext | null>(null)
  const [isTemporary, setIsTemporary] = useState(false)
  const [generationKind, setGenerationKind] = useState<'image' | 'video' | null>(null)
  const [selectedImageModelId, setSelectedImageModelId] = useState<string | null>(null)
  const [selectedVideoModelId, setSelectedVideoModelId] = useState<string | null>(null)
  const [execution, setExecution] = useState<{ workspaceId: string; run: PersonalRun } | null>(null)
  const currentRun = execution?.workspaceId === activeWorkspaceId && execution.run?.conversationId === activeChatId ? execution.run : null
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
  const [actionsChat, setActionsChat] = useState<ChatMeta | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [showingCachedCopy, setShowingCachedCopy] = useState(false)

  const chatRef = useRef<Chat | null>(null)
  const flatListRef = useRef<FlatList<Message>>(null)
  const textInputRef = useRef<TextInput>(null)
  const abortRef = useRef(false)
  const pendingTurn = useRef<{ conversationId: string; signature: string; turnId: string } | null>(null)
  const hasAutoScrolledRef = useRef(false)
  const handleSendRef = useRef<() => Promise<void>>(async () => {})
  const [draftModal, setDraftModal] = useState<DraftModalState | null>(null)
  const [draftSaving, setDraftSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const visibleMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return messages
    return messages.filter((m) => {
      const text = typeof m.content === 'string' ? m.content.toLowerCase() : ''
      return text.includes(q)
    })
  }, [messages, searchQuery])

  const composerFooterInset = getComposerBottomInset(
    keyboardVisible,
    insets.bottom,
    spacing.md,
    spacing.sm,
    Platform.OS === 'android' ? spacing.sm : 0,
  )

  const handleOpenDrawer = useCallback(() => {
    textInputRef.current?.blur()
    Keyboard.dismiss()
    openDrawer()
  }, [openDrawer])

  const refreshHistory = useCallback(async () => {
    const nextHistory = await loadChatsMeta().catch(() => null)
    if (nextHistory) {
      setHistory(nextHistory)
    }
    return nextHistory ?? []
  }, [])

  const syncConversationMeta = useCallback(
    async (overrides: Partial<Chat> = {}) => {
      if (!chatRef.current) return

      const resolvedModelId = overrides.modelId || selectedModel?.id || chatRef.current.modelId
      const nextChat: Chat = {
        ...chatRef.current,
        ...overrides,
        title: overrides.title ?? chatRef.current.title,
        updatedAt: Date.now(),
        modelId: resolvedModelId,
        askModelIds: resolvedModelId ? [resolvedModelId] : chatRef.current.askModelIds,
        actModelId: resolvedModelId || chatRef.current.actModelId,
        lastMode: 'act',
      }

      chatRef.current = nextChat
      setChatTitle(nextChat.title)
      if (nextChat.id.startsWith('chat-') && !nextChat.clientId) return
      await saveChat(nextChat).catch(() => {})
      await refreshHistory()
    },
    [refreshHistory, selectedModel?.id],
  )

  const hydrateConversation = useCallback(
    async (chatId: string, models: ChatModel[], options: { switching?: boolean } = {}) => {
      if (options.switching) {
        setIsSwitchingChat(true)
      }

      try {
        const chat = await loadChat(chatId)
        if (!chat) {
          return false
        }

        // DMs and channels have their own room surfaces — a shared link or
        // agent-DM route landing on /chat/[id] redirects instead of rendering
        // a multiplayer room as a personal chat.
        if (chat.conversationType === 'dm' || chat.conversationType === 'channel') {
          const pathname = chat.conversationType === 'dm' ? '/dm/[id]' : '/channel/[id]'
          router.replace({ pathname, params: { id: chat.id } })
          return false
        }

        chatRef.current = chat
        setActiveChatId(chat.id)
        setChatTitle(chat.title)
        hasAutoScrolledRef.current = false
        setMessages(chat.messages)
        setShowingCachedCopy(chat.restoredFromCache === true)
        setInputValue('')
        setImageBase64(null)
        setPendingDocuments([])
        setAttachmentError(null)
        setMentions([])
        setReplyContext(null)
        setGenerationKind(null)
        setExecution(null)
        await setLastOpenedChatId(chat.id)

        const preferredModelId = chat.actModelId || chat.askModelIds?.[0] || chat.modelId
        const nextSelected =
          models.find((model) => model.id === preferredModelId) ||
          models[0] ||
          null
        setSelectedModel(nextSelected)
        setAutoSelected(false)
        return true
      } finally {
        if (options.switching) {
          setIsSwitchingChat(false)
        }
      }
    },
    [router],
  )

  const createConversation = useCallback(
    async (models: ChatModel[], options: { replaceRoute?: boolean } = {}) => {
      const isFreeTier = entitlements?.tier === 'free'
      const preferredId = uiSettings.defaultActModelId || await getLastSelectedModelId().catch(() => null)
      const preferredModel = preferredId ? models.find((m) => m.id === preferredId) : undefined
      const modelId = preferredModel && !(isFreeTier && preferredModel.cost > 0)
        ? preferredModel.id
        : isFreeTier
          ? (models.find((m) => m.cost === 0)?.id ?? models[0]?.id)
        : models[0]?.id

      // Create a client-side draft only. The server-side conversation is
      // created lazily on the first user message (via chatStream), so
      // merely navigating to the Chat tab never produces an empty chat.
      const created: Chat = createDraftChat(modelId)

      chatRef.current = created
      setActiveChatId(created.id)
      setChatTitle(created.title)
      setMessages([])
      setShowingCachedCopy(false)
      setMentions([])
      setReplyContext(null)
      setPendingDocuments([])
      setAttachmentError(null)
      setGenerationKind(null)
      setExecution(null)
      setAutoSelected(true)
      setSelectedModel(
        models.find((model) => model.id === created.modelId) ||
          models[0] ||
          null,
      )
      setInputValue('')
      setImageBase64(null)
      await setLastOpenedChatId(created.id)

      if (options.replaceRoute) {
        router.replace({
          pathname: '/chat/[id]',
          params: {
            id: created.id,
          },
        })
      }

      return created
    },
    [entitlements?.tier, router, uiSettings.defaultActModelId],
  )

  const previousWorkspaceId = useRef(activeWorkspaceId)
  useEffect(() => {
    if (previousWorkspaceId.current === activeWorkspaceId) return
    previousWorkspaceId.current = activeWorkspaceId
    chatRef.current = null
    setActiveChatId(null)
    setMessages([])
    setChatTitle('New chat')
    abortRef.current = true
    pendingTurn.current = null
    setExecution(null)
    setIsSending(false)
    setInputValue('')
    setImageBase64(null)
    setPendingDocuments([])
    setMentions([])
    setReplyContext(null)
    setAttachmentError(null)
  }, [activeWorkspaceId])

  useEffect(() => {
    let isMounted = true

    if (!nativeReady || !activeWorkspaceId) return
    // Guard: skip re-initialization if we already have an active chat session.
    if (chatRef.current !== null && !conversationId) {
      return
    }

    async function resolveModels(): Promise<ChatModel[]> {
      if (chatModels.length > 0) return orderedChatModels(chatModels)
      return getAvailableModels()
    }

    async function resolvePreferredModel(models: ChatModel[]): Promise<ChatModel | null> {
      const isFreeTier = entitlements?.tier === 'free'
      const persistedId = uiSettings.defaultActModelId || await getLastSelectedModelId().catch(() => null)
      if (persistedId) {
        const match = models.find((m) => m.id === persistedId)
        // For free tier, don't restore a previously selected premium model
        if (match && !(isFreeTier && match.cost > 0)) return match
      }
      if (isFreeTier) {
        // Default free-tier users to the free model
        return models.find((m) => m.cost === 0) ?? models[0] ?? null
      }
      return models[0] || null
    }

    async function initialize(): Promise<void> {
      setIsLoading(true)

      try {
        const models = await resolveModels()
        if (!isMounted) return

        setAvailableModels(models)
        const preferred = await resolvePreferredModel(models)
        if (isMounted) setSelectedModel(preferred)

        if (conversationId === 'new') {
          await createConversation(models, { replaceRoute: routeKind === 'detail' })
          return
        }

        if (conversationId) {
          await hydrateConversation(conversationId, models)
          return
        }

        const lastOpenedChatId = await getLastOpenedChatId()
        if (lastOpenedChatId) {
          const didHydrate = await hydrateConversation(lastOpenedChatId, models).catch(() => false)
          if (didHydrate) {
            return
          }
        }

        await createConversation(models)
      } catch {
        if (isMounted) {
          const models = await resolveModels().catch(() => [])
          const preferred = await resolvePreferredModel(models)
          const draft = createDraftChat(preferred?.id ?? models[0]?.id)
          chatRef.current = draft
          setActiveChatId(draft.id)
          setChatTitle(draft.title)
          setMessages([])
          setSelectedModel(preferred ?? models[0] ?? null)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void initialize()

    return () => {
      isMounted = false
    }
  }, [
    nativeReady,
    activeWorkspaceId,
    chatModels,
    conversationId,
    createConversation,
    entitlements?.tier,
    hydrateConversation,
    routeKind,
    uiSettings.defaultActModelId,
  ])

  useEffect(() => {
    let isMounted = true
    if (chatModels.length > 0) {
      void orderedChatModels(chatModels).then((models) => {
        if (isMounted) setAvailableModels(models)
      })
    }
    return () => {
      isMounted = false
    }
  }, [chatModels])

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace('/auth-flow?force=true')
    }
  }, [isAuthLoading, isAuthenticated, router])

  // Refresh history once auth is ready (catches the race where useFocusEffect
  // fired before the session was restored from storage).
  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      void refreshHistory().catch(() => {})
    }
  }, [isAuthLoading, isAuthenticated, refreshHistory])

  // Refresh history every time the drawer opens so the list is never stale,
  // and force the composer to drop focus so the keyboard slides away.
  useEffect(() => {
    if (drawerVisible) {
      textInputRef.current?.blur()
      Keyboard.dismiss()
      void refreshHistory().catch(() => {})
    }
  }, [drawerVisible, refreshHistory])

  useEffect(() => {
    setHistory([])
    if (!nativeReady || !activeWorkspaceId) return
    return subscribeChats('personal', setHistory)
  }, [nativeReady, activeWorkspaceId])

  useEffect(() => {
    if (!nativeReady || !activeWorkspaceId || !activeChatId || !/^[0-9a-z]{20,40}$/.test(activeChatId) || isTemporary || isSending) return
    let lastReadMessageId: string | undefined
    return subscribePersonalChat(activeChatId, chat => {
      if (!chat) {
        chatRef.current = null
        setMessages([])
        return
      }
      chatRef.current = chat
      setChatTitle(chat.title)
      setMessages(chat.messages)
      setShowingCachedCopy(false)
      const lastMessageId = chat.messages.at(-1)?.id
      if (lastMessageId && lastReadMessageId !== lastMessageId) {
        lastReadMessageId = lastMessageId
        void setPersonalChatRead(chat.id, false, lastMessageId).catch(() => undefined)
      }
    })
  }, [nativeReady, activeWorkspaceId, activeChatId, isTemporary, isSending])

  useEffect(() => {
    if (!nativeReady || !activeWorkspaceId || !activeChatId || !/^[0-9a-z]{20,40}$/.test(activeChatId) || isTemporary) return
    let active = true
    try {
      const stop = watchPersonalExecution(activeWorkspaceId, activeChatId, run => { if (active) setExecution({ workspaceId: activeWorkspaceId, run }) }, error => { if (active) setAttachmentError(String(error)) })
      return () => { active = false; stop() }
    } catch (error) { void Promise.resolve().then(() => { if (active) setAttachmentError(String(error)) }) }
    return () => { active = false }
  }, [nativeReady, activeWorkspaceId, activeChatId, isTemporary])

  const handleSubmitApproval = useCallback(
    async (approved: boolean) => {
      const run = currentRun
      if (!activeChatId || !run?.approval || run.status !== 'waiting_for_approval') return
      setApprovalSubmitting(true)
      try {
        await submitRunApproval({
          conversationId: activeChatId,
          agentRunId: run.id,
          token: run.approval.token,
          approved,
        })
      } catch (error) {
        Alert.alert('Could not submit approval', error instanceof Error ? error.message : 'Try again.')
      } finally {
        setApprovalSubmitting(false)
      }
    },
    [activeChatId, currentRun],
  )

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true })
    })
  }, [])

  const openConversation = useCallback(
    async (chatId: string) => {
      if (routeKind === 'detail') {
        router.replace({
          pathname: '/chat/[id]',
          params: {
            id: chatId,
          },
        })
        return
      }

      abortRef.current = true
      await hydrateConversation(chatId, availableModels, { switching: true })
    },
    [availableModels, hydrateConversation, routeKind, router],
  )

  const startFreshConversation = useCallback(async () => {
    if (routeKind === 'detail') {
      router.replace({
        pathname: '/chat/[id]',
        params: {
          id: 'new',
        },
      })
      return
    }

    await createConversation(availableModels)
  }, [availableModels, createConversation, routeKind, router])

  // Draft chats are client-side only until the first send. Mirrors web's
  // PENDING_FIRST_CHAT_ID flow: POST /conversations with the draft's id as
  // clientId so the act turn (which also carries `conversationClientId`)
  // lands on the same server row, then adopt the real conversation id.
  const ensureServerConversation = useCallback(
    async (chat: Chat): Promise<Chat> => {
      if (!chat.id.startsWith('chat-') || chat.clientId) return chat
      const workspaceId = getRequestWorkspaceId()
      const created = await createNewChat(selectedModel?.id ?? chat.modelId, {
        clientId: chat.id,
        title: chat.title,
      })
      const next: Chat = { ...chat, id: created.id, clientId: created.clientId ?? chat.id }
      if (getRequestWorkspaceId() !== workspaceId || chatRef.current?.id !== chat.id) throw new Error('Chat changed. Reopen it to send.')
      chatRef.current = next
      setActiveChatId(next.id)
      await saveChat(next).catch(() => {})
      await setLastOpenedChatId(next.id).catch(() => {})
      return next
    },
    [selectedModel?.id],
  )

  const handleStopGeneration = useCallback(async () => {
    abortRef.current = true
    pendingTurn.current = null
    setIsSending(false)
    const activeChat = chatRef.current
    const workspaceId = getRequestWorkspaceId()
    if (!activeChat?.id) return
    try {
      if (!isTemporary) await stopConversation(activeChat.id)
      if (chatRef.current?.id === activeChat.id && getRequestWorkspaceId() === workspaceId) setMessages(current => current.map(message => ({ ...message, responses: message.responses?.map(response => ({ ...response, isLoading: false })) })))
    } catch { setAttachmentError('Could not stop. The response may still be running.') }
  }, [isTemporary])

  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Photo Library Access Needed', 'Please allow photo access in Settings to attach images.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    })

    if (!result.canceled && result.assets[0].base64) {
      const mimeType = result.assets[0].mimeType || 'image/jpeg'
      setImageBase64(`data:${mimeType};base64,${result.assets[0].base64}`)
    }
  }, [])

  const pickImageFromCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Camera access needed', 'Please allow camera access in Settings.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    })
    if (!result.canceled && result.assets[0].base64) {
      const mimeType = result.assets[0].mimeType || 'image/jpeg'
      setImageBase64(`data:${mimeType};base64,${result.assets[0].base64}`)
    }
  }, [])

  const queueDocumentUpload = useCallback(async (uri: string, name: string, mimeType: string) => {
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setAttachmentError(null)
    setPendingDocuments((prev) => [...prev, { clientId, name, fileIds: [], status: 'uploading' }])
    try {
      const result = await uploadDocument(uri, name, mimeType)
      setPendingDocuments((prev) =>
        prev.map((d) =>
          d.clientId === clientId
            ? { ...d, status: 'ready', fileIds: result.ids, name: result.name }
            : d,
        ),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not index file'
      setPendingDocuments((prev) =>
        prev.map((d) => (d.clientId === clientId ? { ...d, status: 'error', error: msg } : d)),
      )
    }
  }, [])

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    if (result.canceled) return
    const asset = result.assets[0]
    const mimeType = asset.mimeType ?? 'application/octet-stream'
    if (mimeType.startsWith('image/')) {
      void queueDocumentUpload(asset.uri, asset.name, mimeType)
    } else {
      void queueDocumentUpload(asset.uri, asset.name, mimeType)
    }
  }, [queueDocumentUpload])

  const handleModelSelect = useCallback(
    async (model: ChatModel) => {
      setSelectedModel(model)
      setModelPickerVisible(false)
      await setLastSelectedModelId(model.id).catch(() => {})
      await syncConversationMeta({
        modelId: model.id,
        askModelIds: [model.id],
        actModelId: model.id,
      })
    },
    [syncConversationMeta],
  )

  const handleMediaSend = useCallback(
    async (kind: 'image' | 'video') => {
      const activeChat = chatRef.current
      const mediaWorkspaceId = getRequestWorkspaceId()
      if (!activeChat || isSending || messages.some(message => message.responses?.some(response => response.isLoading))) return
      const modelId = kind === 'image'
        ? (selectedImageModelId ?? imageModels[0]?.id)
        : (selectedVideoModelId ?? videoModels[0]?.id)
      if (!modelId) {
        setAttachmentError(`No ${kind} model is available on this account.`)
        return
      }
      if (!inputValue.trim() && !imageBase64) return

      hapticImpact()
      Keyboard.dismiss()
      setIsSending(true)
      setAttachmentError(null)

      const signature = JSON.stringify([mediaWorkspaceId, kind, modelId, inputValue, imageBase64, replyContext])
      const turnId = pendingTurn.current?.conversationId === activeChat.id && pendingTurn.current.signature === signature ? pendingTurn.current.turnId : generateMessageId()
      pendingTurn.current = { conversationId: activeChat.id, signature, turnId }
      const promptText = replyContext?.bodyForModel
        ? `${inputValue.trim()}\n\n---\n[User is replying in thread to prior content]\n${replyContext.bodyForModel}`
        : inputValue.trim()
      const userMessage: Message = {
        id: generateMessageId(),
        turnId,
        role: 'user',
        content: inputValue.trim(),
        timestamp: Date.now(),
        imageData: imageBase64 || undefined,
        mode: 'act',
        replyToTurnId: replyContext?.replyToTurnId,
        replySnippet: replyContext?.snippet,
      }
      const assistantId = turnId
      const generating: Message = {
        id: assistantId,
        turnId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        responses: [
          {
            modelId,
            modelName: kind === 'image' ? 'Image generation' : 'Video generation',
            provider: 'overlay',
            content: '',
            isLoading: true,
          },
        ],
        mode: 'act',
      }
      setMessages((current) => [...current.filter(message => message.turnId !== turnId), userMessage, generating])
      setInputValue('')
      setImageBase64(null)
      setReplyContext(null)
      setGenerationKind(null)
      scrollToBottom()

      // Generation endpoints need a real conversationId — create the server
      // row for drafts first (same pending-first-send flow as text sends).
      let sendChat = activeChat
      if (!isTemporary) {
        sendChat = await ensureServerConversation(activeChat).catch(() => activeChat)
      }
      let sendConversationId = sendChat.id.startsWith('chat-') ? undefined : sendChat.id
      if (getRequestWorkspaceId() !== mediaWorkspaceId || chatRef.current?.id !== sendChat.id) {
        if (pendingTurn.current?.turnId === turnId) { pendingTurn.current = null; setIsSending(false) }
        return
      }
      if (pendingTurn.current?.turnId === turnId) pendingTurn.current.conversationId = sendChat.id
      let mediaFailed = false

      try {
        if (!isTemporary) {
          const result = await submitPersonalTurn({ conversationId: sendConversationId as PersonalTurn['conversationId'], clientId: sendConversationId ? undefined : sendChat.id, turnId, modelId, mode: 'act', contentType: kind, parts: [...(imageBase64 ? [{ type: 'file' as const, url: imageBase64, mediaType: imageBase64.match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg' }] : []), { type: 'text', text: inputValue.trim() }], replyToTurnId: replyContext?.replyToTurnId, replySnippet: replyContext?.snippet }, mediaWorkspaceId ?? undefined)
          sendConversationId = result.conversationId
          sendChat = { ...sendChat, id: result.conversationId }
          chatRef.current = sendChat
          setActiveChatId(sendChat.id)
          if (pendingTurn.current?.turnId === turnId) pendingTurn.current.conversationId = sendChat.id
        }
        if (getRequestWorkspaceId() !== mediaWorkspaceId || chatRef.current?.id !== sendChat.id || pendingTurn.current?.turnId !== turnId) return
        const result = kind === 'image'
          ? await generateImage({
              prompt: promptText,
              modelId,
              conversationId: isTemporary ? undefined : sendConversationId,
              temporaryChat: isTemporary || undefined,
              turnId,
              imageUrl: imageBase64 ?? undefined,
            })
          : await generateVideo({
              prompt: promptText,
              modelId,
              conversationId: isTemporary ? undefined : sendConversationId,
              temporaryChat: isTemporary || undefined,
              turnId,
              imageUrl: imageBase64 ?? undefined,
            })
        if (getRequestWorkspaceId() !== mediaWorkspaceId || chatRef.current?.id !== sendChat.id || pendingTurn.current?.turnId !== turnId) return
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  generatedFiles: [
                    ...(m.generatedFiles ?? []),
                    {
                      url: result.url ?? '',
                      mediaType: kind === 'image' ? 'image/png' : 'video/mp4',
                    },
                  ],
                  responses: [{ ...m.responses![0], isLoading: false }],
                }
              : m,
          ),
        )
      } catch (error) {
        if (getRequestWorkspaceId() !== mediaWorkspaceId || chatRef.current?.id !== sendChat.id) return
        mediaFailed = true
        setGenerationKind(kind)
        setInputValue(inputValue)
        setImageBase64(imageBase64)
        setReplyContext(replyContext)
        const message = error instanceof Error ? error.message : 'Generation failed'
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  responses: [
                    {
                      ...(m.responses?.[0] ?? {
                        modelId,
                        modelName: modelId,
                        provider: 'overlay',
                        content: '',
                        isLoading: false,
                      }),
                      isLoading: false,
                      error: message,
                    },
                  ],
                }
              : m,
          ),
        )
      } finally {
        if (getRequestWorkspaceId() === mediaWorkspaceId && pendingTurn.current?.turnId === turnId) setIsSending(false)
      }

      if (mediaFailed || pendingTurn.current?.turnId !== turnId) return
      pendingTurn.current = null

      if (!isTemporary && getRequestWorkspaceId() === mediaWorkspaceId) {
        const refreshed = await loadChat(sendChat.id)
        if (refreshed && !pendingTurn.current && chatRef.current?.id === sendChat.id && getRequestWorkspaceId() === mediaWorkspaceId) {
          chatRef.current = refreshed
          setChatTitle(refreshed.title)
          setMessages(refreshed.messages)
          setShowingCachedCopy(refreshed.restoredFromCache === true)
        }
        await refreshHistory()
      }
    },
    [
      ensureServerConversation,
      imageBase64,
      imageModels,
      messages,
      inputValue,
      isSending,
      isTemporary,
      refreshHistory,
      replyContext,
      scrollToBottom,
      selectedImageModelId,
      selectedVideoModelId,
      videoModels,
    ],
  )

  const handleToggleTool = useCallback((id: ChatToolRequestId) => {
    setSelectedToolIds((current) =>
      current.includes(id) ? current.filter((toolId) => toolId !== id) : [...current, id],
    )
  }, [])

  const handleSelectGeneration = useCallback(
    (kind: 'image' | 'video' | null, modelId: string | null) => {
      setGenerationKind(kind)
      if (kind === 'image' && modelId) setSelectedImageModelId(modelId)
      if (kind === 'video' && modelId) setSelectedVideoModelId(modelId)
    },
    [],
  )

  const handleMessageLongPress = useCallback(
    (message: Message) => {
      hapticImpact()
      const text = message.content?.trim() ?? ''
      const canReply = text.length > 0
      Alert.alert(message.role === 'user' ? 'Your message' : 'Message', undefined, [
        {
          text: 'Copy',
          onPress: () => {
            void Clipboard.setStringAsync(text)
            hapticNotify()
          },
        },
        ...(canReply
          ? [
              {
                text: 'Reply',
                onPress: () => {
                  // Mirrors web `beginReplyToAssistantText`: snippet ≤160 chars
                  // for the bar, full text (≤16k) goes to the model.
                  setReplyContext({
                    snippet: text.length > 160 ? `${text.slice(0, 160)}…` : text,
                    bodyForModel: text.slice(0, 16000),
                    ...(message.turnId ? { replyToTurnId: message.turnId } : {}),
                  })
                  textInputRef.current?.focus()
                },
              },
            ]
          : []),
        { text: 'Cancel', style: 'cancel' as const },
      ])
    },
    [],
  )

  const handleSend = useCallback(async () => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push('/auth-flow?force=true')
      return
    }

    const activeChat = chatRef.current
    const hasReadyDocs = pendingDocuments.some((d) => d.status === 'ready')
    const workspaceAtSend = getRequestWorkspaceId()
    if ((!inputValue.trim() && !imageBase64 && !hasReadyDocs) || !activeChat || isSending || messages.some(message => message.responses?.some(response => response.isLoading))) {
      return
    }

    if (pendingDocuments.some((d) => d.status === 'uploading')) {
      setAttachmentError('Wait for documents to finish indexing.')
      return
    }
    if (pendingDocuments.some((d) => d.status === 'error')) {
      setAttachmentError('Remove failed documents before sending.')
      return
    }

    if (generationKind) {
      await handleMediaSend(generationKind)
      return
    }
    if (!selectedModel) { setAttachmentError('No text model is available on this account.'); return }

    hapticImpact()
    textInputRef.current?.blur()
    Keyboard.dismiss()
    abortRef.current = false
    setIsSending(true)
    setAttachmentError(null)

    const readyDocs = pendingDocuments.filter((d) => d.status === 'ready')
    const indexedAttachments: IndexedAttachment[] = readyDocs.map((d) => ({ name: d.name, fileIds: d.fileIds }))
    const indexedFileNames = readyDocs.map((d) => d.name)

    let fileContext = ''
    if (indexedFileNames.length > 0) {
      fileContext = `\n\n[Indexed documents: ${indexedFileNames.join(', ')}]`
    }

    const signature = JSON.stringify([workspaceAtSend, inputValue, imageBase64, selectedModel.id, requestMode, indexedAttachments, mentions, replyContext])
    const assistantId = pendingTurn.current?.conversationId === activeChat.id && pendingTurn.current.signature === signature ? pendingTurn.current.turnId : generateMessageId()
    pendingTurn.current = { conversationId: activeChat.id, signature, turnId: assistantId }
    const userMessage: Message = {
      id: generateMessageId(),
      turnId: assistantId,
      role: 'user',
      content: inputValue.trim() + fileContext,
      timestamp: Date.now(),
      imageData: imageBase64 || undefined,
      mode: 'act',
      replyToTurnId: replyContext?.replyToTurnId,
      replySnippet: replyContext?.snippet,
      mentions: mentions.length > 0 ? mentions : undefined,
    }

    const nextTitle = getNextTitle(chatTitle, inputValue.trim() || indexedFileNames[0] || '')
    const userMessageList = [...messages.filter(message => message.turnId !== assistantId), userMessage]
    const placeholderAssistant: Message = {
      id: assistantId,
      turnId: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      selectedModelId: selectedModel.id,
      responses: [
        {
          modelId: selectedModel.id,
          modelName: selectedModel.name,
          provider: selectedModel.provider,
          content: '',
          isLoading: true,
        },
      ],
      mode: 'act',
      isStreaming: true,
    }

    setMessages([...userMessageList, placeholderAssistant])
    const sentMentions = mentions
    const sentReply = replyContext
    setInputValue('')
    setImageBase64(null)
    setPendingDocuments([])
    setMentions([])
    setReplyContext(null)

    // Temporary chats never hit the persistence path — no conversationId,
    // temporaryChat flag only, history untouched.
    // Draft chats get a server row here (web's pending-first-send flow):
    // POST /conversations with the draft id as clientId; on failure the act
    // body still carries `conversationClientId` so the turn creates it lazily.
    let sendChat = activeChat
    if (!isTemporary) {
      sendChat = await ensureServerConversation(activeChat).catch(() => activeChat)
      if (getRequestWorkspaceId() !== workspaceAtSend || chatRef.current?.id !== sendChat.id) {
        if (pendingTurn.current?.turnId === assistantId) { pendingTurn.current = null; setIsSending(false) }
        return
      }
      try {
        await syncConversationMeta({
          title: nextTitle,
          modelId: selectedModel.id,
          askModelIds: [selectedModel.id],
          actModelId: selectedModel.id,
          lastMode: 'act',
        })
      } catch {
        // ignore sync errors
      }
    }
    const stillDraft = sendChat.id.startsWith('chat-')
    if (pendingTurn.current?.turnId === assistantId) pendingTurn.current.conversationId = sendChat.id
    let failed = false
    scrollToBottom()

    try {
      console.log('[ChatScreen] send: conversationId=%s modelId=%s baseUrl=%s temp=%s', sendChat.id, selectedModel.id, AUTH_BASE_URL, isTemporary)
      for await (const chunk of chatStream(selectedModel.id, buildApiMessages(userMessageList), {
        workspaceId: workspaceAtSend ?? undefined,
        conversationId: isTemporary || stillDraft ? undefined : sendChat.id,
        conversationClientId: isTemporary || !stillDraft ? undefined : sendChat.id,
        turnId: assistantId,
        temporaryChat: isTemporary || undefined,
        requestMode,
        requestedToolIds: selectedToolIds.length > 0 ? selectedToolIds : undefined,
        memoryEnabled: isTemporary ? false : memoryEnabled,
        mentions: sentMentions.length > 0 ? sentMentions.map(mentionToRequestBody) : undefined,
        replyContextForModel: sentReply?.bodyForModel,
        indexedFileNames: indexedFileNames.length > 0 ? indexedFileNames : undefined,
        indexedAttachments: indexedAttachments.length > 0 ? indexedAttachments : undefined,
      })) {
        if (abortRef.current || getRequestWorkspaceId() !== workspaceAtSend || chatRef.current?.id !== sendChat.id || pendingTurn.current?.turnId !== assistantId) break
        if (chunk.type === 'start' && chunk.metadata && typeof chunk.metadata === 'object' && 'conversationId' in chunk.metadata && typeof chunk.metadata.conversationId === 'string') {
          sendChat = { ...sendChat, id: chunk.metadata.conversationId }
          chatRef.current = sendChat
          setActiveChatId(sendChat.id)
          if (pendingTurn.current?.turnId === assistantId) pendingTurn.current.conversationId = sendChat.id
        }
        if (chunk.type === 'error') failed = true
        setMessages((current) => applyStreamChunk(current, assistantId, selectedModel, chunk))
      }
    } catch (error) {
      failed = true
      console.error('[ChatScreen] send failed:', error)
      setMessages((current) =>
        applyStreamChunk(current, assistantId, selectedModel, {
          type: 'error',
          content: String(error),
        }),
      )
    } finally {
      if (getRequestWorkspaceId() === workspaceAtSend && pendingTurn.current?.turnId === assistantId) setIsSending(false)
    }

    if (getRequestWorkspaceId() !== workspaceAtSend || chatRef.current?.id !== sendChat.id || pendingTurn.current?.turnId !== assistantId) return
    if (failed) {
      setInputValue(inputValue)
      setImageBase64(imageBase64)
      setPendingDocuments(readyDocs)
      setMentions(sentMentions)
      setReplyContext(sentReply)
      setAttachmentError('Could not send. Your draft is ready to retry.')
      return
    }
    pendingTurn.current = null

    if (!isTemporary) {
      const refreshed = await loadChat(sendChat.id)
      if (refreshed && !pendingTurn.current && getRequestWorkspaceId() === workspaceAtSend && chatRef.current?.id === sendChat.id) {
        chatRef.current = refreshed
        setChatTitle(refreshed.title)
        setMessages(refreshed.messages)
        setShowingCachedCopy(refreshed.restoredFromCache === true)
      } else {
        setMessages((current) =>
          applyStreamChunk(current, assistantId, selectedModel, { type: 'done', content: '' }),
        )
      }

      await refreshHistory()
    } else {
      setMessages((current) =>
        applyStreamChunk(current, assistantId, selectedModel, { type: 'done', content: '' }),
      )
    }
  }, [
    chatTitle,
    ensureServerConversation,
    generationKind,
    handleMediaSend,
    imageBase64,
    inputValue,
    isAuthLoading,
    isAuthenticated,
    isSending,
    isTemporary,
    memoryEnabled,
    mentions,
    messages,
    pendingDocuments,
    refreshHistory,
    replyContext,
    requestMode,
    router,
    scrollToBottom,
    selectedModel,
    selectedToolIds,
    syncConversationMeta,
  ])

  // Latest-send ref so draft quick actions can fire a message without reading a
  // stale `inputValue` closure — same setInput-then-send flow as the web.
  handleSendRef.current = handleSend

  const sendPresetMessage = useCallback((text: string) => {
    setInputValue(text)
    setTimeout(() => { void handleSendRef.current() }, 0)
  }, [])

  const handleSaveDraft = useCallback(async (state: DraftModalState) => {
    setDraftSaving(true)
    try {
      if (state.kind === 'skill') {
        await createSkill({
          name: state.draft.name,
          description: state.draft.description,
          instructions: state.draft.instructions,
          enabled: true,
        })
        setDraftModal(null)
        Alert.alert('Skill saved', `${state.draft.name} is now available in Extensions.`)
      } else {
        // Web parity: the "Create automation" CTA sends the instruction back
        // into chat — the agent owns automation creation and can follow up.
        setDraftModal(null)
        sendPresetMessage('Create automation')
      }
    } catch (error) {
      Alert.alert('Could not save draft', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setDraftSaving(false)
    }
  }, [sendPresetMessage])

  const sortedModels = useMemo(() => availableModels, [availableModels])

  // The upgrade modal is now only shown when a user explicitly taps a locked
  // premium model. Auto-opening it on every free-tier session is removed for
  // App Store compliance and to avoid a confusing initial popup.

  if (isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.textSecondary} size="large" />
      </View>
    )
  }

  if (!capabilities.chat) {
    return <FeatureGate title="Chat is turned off" />
  }

  return (
    <ScreenWithDrawer
      drawer={
        <DrawerSidebar
          variant="slide"
          theme={theme}
          chats={history}
          activeChatId={chatRef.current?.id || null}
          onSelectChat={(chatId) => {
            void openConversation(chatId)
          }}
          onCreateChat={() => {
            void startFreshConversation()
          }}
          onChatsChanged={(removedChatId) => {
            void refreshHistory()
            if (removedChatId && removedChatId === chatRef.current?.id) {
              void startFreshConversation()
            }
          }}
        />
      }
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <KeyboardAvoidingView
          style={styles.screenPadding}
          behavior={Platform.OS === 'ios' || Platform.OS === 'android' ? 'padding' : undefined}
        >
          <ChatHeader theme={theme} busy={isSwitchingChat} title={chatTitle || 'New chat'} topInset={insets.top} onDrawer={handleOpenDrawer} onNew={() => void startFreshConversation()} onOptions={() => setOptionsOpen(true)} />

          <View style={styles.threadSurface}>
            {showingCachedCopy ? (
              <View
                style={[
                  styles.offlineBanner,
                  {
                    backgroundColor: theme.surfaceElevated,
                    borderColor: theme.border,
                  },
                ]}
                accessibilityRole="text"
                accessibilityLabel="You are offline. Showing the last synced copy of this conversation."
              >
                <Feather name="wifi-off" size={11} color={theme.textSecondary} />
                <Text style={[styles.offlineBannerText, { color: theme.textSecondary }]}>
                  Offline — showing saved copy
                </Text>
              </View>
            ) : null}
            {messages.length === 0 ? (
              <EmptyPersonalChat theme={theme} onSuggest={text => { setInputValue(text); textInputRef.current?.focus() }} />
            ) : (
              <FlatList
                ref={flatListRef}
                data={visibleMessages}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <MessageBubble
                    message={item}
                    theme={theme}
                    onLongPress={handleMessageLongPress}
                    onOpenDraft={setDraftModal}
                    onQuickSend={sendPresetMessage}
                    onCopy={async (content) => {
                      await Clipboard.setStringAsync(content)
                      hapticNotify()
                    }}
                  />
                )}
                contentContainerStyle={[styles.messageList, { paddingBottom: spacing.md }]}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
                onContentSizeChange={() => {
                  if (!hasAutoScrolledRef.current) {
                    hasAutoScrolledRef.current = true
                    scrollToBottom()
                  }
                }}
              />
            )}
          </View>

          <View style={[styles.composerSurface, { paddingBottom: composerFooterInset }]}>
            {currentRun?.status === 'waiting_for_approval' && currentRun.approval ? (
              <View style={[styles.approvalCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                <View style={styles.approvalHeader}>
                  <Feather name="shield" size={14} color={theme.textSecondary} />
                  <Text style={[styles.approvalTitle, { color: theme.text }]}>Approval needed</Text>
                  <Text style={[styles.approvalCount, { color: theme.textSecondary }]}>
                    {currentRun.approval.requests.length} tool
                    {currentRun.approval.requests.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <View style={styles.approvalChips}>
                  {currentRun.approval.requests.slice(0, 4).map((tool) => (
                    <View key={tool.toolCallId} style={[styles.approvalChip, { backgroundColor: theme.surfaceSubtle }]}>
                      <Feather name="tool" size={10} color={theme.textSecondary} />
                      <Text style={[styles.approvalChipText, { color: theme.textSecondary }]} numberOfLines={1}>
                        {tool.toolName}
                      </Text>
                    </View>
                  ))}
                  {currentRun.approval.requests.length > 4 ? (
                    <Text style={[styles.approvalChipText, { color: theme.textSecondary }]}>
                      +{currentRun.approval.requests.length - 4} more
                    </Text>
                  ) : null}
                </View>
                <View style={styles.approvalActions}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    disabled={approvalSubmitting}
                    style={[styles.approvalButton, { backgroundColor: theme.foreground }]}
                    onPress={() => void handleSubmitApproval(true)}
                  >
                    {approvalSubmitting ? (
                      <ActivityIndicator size="small" color={theme.background} />
                    ) : (
                      <Text style={[styles.approvalButtonTextPrimary, { color: theme.background }]}>Approve</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    disabled={approvalSubmitting}
                    style={[styles.approvalButton, { borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }]}
                    onPress={() => void handleSubmitApproval(false)}
                  >
                    <Text style={[styles.approvalButtonText, { color: theme.text }]}>Deny</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            <Composer
              theme={theme}
              modelLabel={generationKind === 'image' ? imageModels.find(model => model.id === selectedImageModelId)?.name ?? 'Image' : generationKind === 'video' ? videoModels.find(model => model.id === selectedVideoModelId)?.name ?? 'Video' : autoSelected ? 'Auto' : selectedModel?.name}
              onModel={() => setModelPickerVisible(true)}
              inputValue={inputValue}
              onChangeInput={setInputValue}
              onSend={() => void handleSend()}
              onStop={() => void handleStopGeneration()}
              isSending={isSending || messages.some(message => message.responses?.some(response => response.isLoading))}
              isTemporary={isTemporary}
              capabilities={capabilities}
              imageBase64={imageBase64}
              onClearImage={() => setImageBase64(null)}
              onPickImage={() => {
                void pickImage()
              }}
              onPickCamera={() => void pickImageFromCamera()}
              onPickFile={() => void pickFile()}
              pendingDocuments={pendingDocuments}
              onRemoveDocument={(clientId) => setPendingDocuments((prev) => prev.filter((d) => d.clientId !== clientId))}
              attachmentError={attachmentError}
              mentions={mentions}
              onAddMention={(item) => setMentions((current) => [...current, item])}
              onRemoveMention={(item) =>
                setMentions((current) =>
                  current.filter((m) => !(m.id === item.id && m.type === item.type)),
                )
              }
              requestMode={requestMode}
              onChangeRequestMode={setRequestMode}
              replyContext={replyContext}
              onClearReply={() => setReplyContext(null)}
              generationKind={generationKind}
              selectedImageModelId={selectedImageModelId}
              selectedVideoModelId={selectedVideoModelId}
              imageModels={imageModels}
              videoModels={videoModels}
              onSelectGeneration={handleSelectGeneration}
              selectedToolIds={selectedToolIds}
              onToggleTool={handleToggleTool}
              memoryEnabled={memoryEnabled}
              onToggleMemory={() => setMemoryEnabled((v) => !v)}
              inputRef={textInputRef}
            />
          </View>
        </KeyboardAvoidingView>

      <ChatSheet theme={theme} visible={modelPickerVisible} onClose={() => setModelPickerVisible(false)} modelPicker title="Choose a model">
        <ModelPicker theme={theme} models={sortedModels} imageModels={imageModels} videoModels={videoModels} selectedId={generationKind === 'image' ? selectedImageModelId ?? undefined : generationKind === 'video' ? selectedVideoModelId ?? undefined : selectedModel?.id} favoriteIds={favoriteIds} onFavorite={toggleFavorite} autoSelected={autoSelected} mode={generationKind ?? 'text'} isLocked={model => entitlements?.tier === 'free' && (model.cost ?? 0) > 0} onAuto={() => {
          const model = resolveAutoModel(availableModels.filter(model => entitlements?.tier !== 'free' || model.cost === 0), uiSettings.defaultActModelId)
          if (!model) { setModelPickerVisible(false); setAttachmentError('No text model is available on this account.'); return }
          if (model) { setGenerationKind(null); setAutoSelected(true); void handleModelSelect(model).catch(error => setAttachmentError(String(error))) }
        }} onSelect={(mode, id) => {
          if (mode !== 'text') { handleSelectGeneration(mode, id); setModelPickerVisible(false); return }
          const model = availableModels.find(model => model.id === id)
          if (!model) return
          if (entitlements?.tier === 'free' && model.cost > 0) { setModelPickerVisible(false); setUpgradeVisible(true); return }
          setAutoSelected(false); setGenerationKind(null); void handleModelSelect(model).catch(error => setAttachmentError(String(error)))
        }} />
      </ChatSheet>

      <ChatSheet theme={theme} visible={optionsOpen} onClose={() => setOptionsOpen(false)} title="Chat options">
        <Section theme={theme}>
          <ListRow theme={theme} icon="shield" title="Temporary chat" subtitle={isTemporary ? 'On. Nothing from this chat is saved.' : 'Off'} onPress={isSending || messages.some(message => message.responses?.some(response => response.isLoading)) ? undefined : () => { setIsTemporary(value => !value); setOptionsOpen(false) }} />
          {history.some(chat => chat.id === activeChatId) ? <ListRow theme={theme} icon="more-horizontal" title="Conversation actions" onPress={() => { setOptionsOpen(false); setActionsChat(history.find(chat => chat.id === activeChatId) ?? null) }} /> : null}
        </Section>
      </ChatSheet>

      <UpgradePrompt
        visible={upgradeVisible}
        theme={theme}
        onClose={() => setUpgradeVisible(false)}
      />

      <DraftReviewSheet
        state={draftModal}
        saving={draftSaving}
        onClose={() => setDraftModal(null)}
        onSave={(state) => { void handleSaveDraft(state) }}
      />

      <ChatActionsSheet
        theme={theme}
        visible={actionsChat !== null}
        chat={actionsChat}
        onClose={() => setActionsChat(null)}
        onChanged={() => {
          const chatId = actionsChat?.id
          void refreshHistory().then((next) => {
            const updated = chatId ? next.find((c) => c.id === chatId) : null
            if (updated?.title) {
              setChatTitle(updated.title)
              if (chatRef.current) chatRef.current = { ...chatRef.current, title: updated.title }
            }
          }).catch(() => {})
        }}
        onDeleted={() => {
          void startFreshConversation()
        }}
        onArchived={() => {
          void startFreshConversation()
        }}
      />
      <FloatingSearchBar
        theme={theme}
        isDark={isDark}
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search this chat"
      />
    </View>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
  },
  screenPadding: {
    flex: 1,
    paddingBottom: spacing.sm,
  },
  floatingModelPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  topBarModelName: {
    fontSize: fontSize.md,
    fontWeight: '700',
    flexShrink: 1,
    fontFamily: 'LibreBaskerville',
  },
  providerDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  threadSurface: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  emptySurface: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingBottom: 60,
  },
  overlayLogo: {
    width: 56,
    height: 56,
  },
  emptyTitle: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '400',
    fontFamily: 'LibreBaskerville',
    textAlign: 'center',
    maxWidth: 300,
  },
  messageList: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  composerSurface: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  attachmentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingLeft: spacing.md,
    paddingRight: 6,
    paddingVertical: 6,
  },
  attachmentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  attachmentText: {
    fontSize: fontSize.sm,
  },
  pendingDocsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  pendingDocChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  pendingDocChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  pendingDocChipText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    maxWidth: 160,
  },
  attachmentErrorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  attachmentErrorText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    flexShrink: 1,
  },
  composerBox: {
    borderWidth: 1,
    borderRadius: 26,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 8,
    gap: spacing.sm,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  composerInput: {
    minHeight: 58,
    maxHeight: 150,
    fontSize: 17,
    lineHeight: 26,
    textAlignVertical: 'top',
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  composerIconButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelList: {
    gap: 0,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  modelRowContent: {
    flex: 1,
    gap: 3,
  },
  modelRowTitle: {
    fontSize: fontSize.lg,
    fontWeight: '500',
  },
  modelRowDesc: {
    fontSize: fontSize.sm,
  },
  modelSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 4,
  },
  modelRowLocked: {
    opacity: 0.55,
  },
  lockedOpacity: {
    opacity: 0.6,
  },
  modelRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  logoContainer: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerLogo: {
    width: '100%',
    height: '100%',
  },
  providerLogoPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 4,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerInitial: {
    fontSize: 12,
    fontWeight: '700',
  },
  attachSheetGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  attachSheetCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.lg,
  },
  attachSheetLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  modelRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chevronButton: {
    padding: 4,
  },
  metricsContainer: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 6,
    borderRadius: borderRadius.md,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  metricLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  metricValue: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  attributionContainer: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
    marginTop: 4,
  },
  attributionText: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  centerSlotRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 0,
  },
  rightSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tempBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  tempBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  offlineBanner: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: spacing.xs,
    zIndex: 5,
  },
  offlineBannerText: {
    fontSize: 11,
    fontWeight: '600',
  },
  suggestionsWrap: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.md,
  },
  suggestionChip: {
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  suggestionChipText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    lineHeight: 19,
  },
  approvalCard: {
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  approvalTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    flex: 1,
  },
  approvalCount: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  approvalChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  approvalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 180,
  },
  approvalChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  approvalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  approvalButton: {
    flex: 1,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
  },
  approvalButtonTextPrimary: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  approvalButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
})
