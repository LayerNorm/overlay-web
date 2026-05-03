import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import type { ChatModel } from '../../services/chatTypes'
import {
  PROVIDER_COLORS,
  generateChatId,
  generateMessageId,
  generateTempTitle,
  type Chat,
  type ChatMeta,
  type Message,
} from '../../services/chatTypes'
import {
  createNewChat,
  deleteChat,
  getLastOpenedChatId,
  loadChat,
  loadChatsMeta,
  saveChat,
  setLastOpenedChatId,
  updateChatTitle,
} from '../../services/chatStorage'
import { chatStream, DEFAULT_CHAT_MODEL_ID, getAvailableModels, getLastSelectedModelId, setLastSelectedModelId, type StreamChunk } from '../../services/aiService'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { MessageBubble } from './MessageBubble'
import { DrawerSidebar } from './DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import {
  BottomSheet,
  MainScreenHeader,
  StatusPill,
  TopBarIconButton,
} from '../ui/AppChrome'
import { useDrawer } from '../../contexts/DrawerContext'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { useAppSession } from '../../contexts/AppSessionContext'
import { UpgradePrompt } from '../auth/UpgradePrompt'
import { GlassSurface } from '../ui/GlassSurface'
import { useAuth } from '../../contexts/AuthContext'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'

const OVERLAY_LOGO = require('../../assets/overlay-logo.png')

// Provider logo mapping
const PROVIDER_LOGOS: Record<string, ReturnType<typeof require>> = {
  google: require('../../assets/model-logos/google.svg'),
  openai: require('../../assets/model-logos/openai.svg'),
  anthropic: require('../../assets/model-logos/anthropic.svg'),
  xai: require('../../assets/model-logos/xai.svg'),
  deepseek: require('../../assets/model-logos/deepseek.svg'),
  groq: require('../../assets/model-logos/groq.svg'),
  nvidia: require('../../assets/model-logos/nvidia.svg'),
  openrouter: require('../../assets/model-logos/openrouter.svg'),
  meta: require('../../assets/model-logos/meta.svg'),
  mistral: require('../../assets/model-logos/mistral.svg'),
}

function getProviderLogo(provider: string): ReturnType<typeof require> | null {
  return PROVIDER_LOGOS[provider.toLowerCase()] ?? null
}

function createSyntheticModel(modelId?: string | null): ChatModel | null {
  if (!modelId) {
    return null
  }

  return {
    id: modelId,
    name: modelId === DEFAULT_CHAT_MODEL_ID ? 'Free: Kimi K2 Thinking' : modelId,
    provider: modelId.includes('deepseek') || modelId.includes('kimi') || modelId.includes('minimaxai') ? 'nvidia' : 'openrouter',
    intelligence: 3,
    cost: 0,
    supportsVision: true,
    supportsReasoning: true,
    supportsSearch: true,
  }
}


function createDraftChat(modelId?: string, projectId?: string): Chat {
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
    projectId,
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

function capabilityTags(model: ChatModel): string[] {
  const tags = [`IQ ${model.intelligence}`]
  if (model.supportsVision) tags.push('Vision')
  if (model.supportsReasoning) tags.push('Reasoning')
  if (model.supportsSearch) tags.push('Search')
  tags.push(model.cost === 0 ? 'Free' : `Tier ${model.cost}`)
  return tags
}

function getModelDescription(model: ChatModel): string {
  if (model.intelligence >= 5) return 'Most capable for ambitious work'
  if (model.intelligence >= 4) return 'Powerful and versatile'
  if (model.cost === 0) return 'Fast and free'
  if (model.intelligence <= 2) return 'Fastest for quick answers'
  return 'Efficient for everyday tasks'
}

function getTimeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function getNextTitle(currentTitle: string, inputValue: string): string {
  if (currentTitle === 'New Chat' && inputValue.trim()) {
    return generateTempTitle(inputValue.trim())
  }

  return currentTitle
}

export function ChatScreen({
  conversationId,
  projectId,
  projectName,
  routeKind,
}: {
  conversationId?: string
  projectId?: string
  projectName?: string
  routeKind: 'tab' | 'detail'
}): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const { openDrawer, drawerVisible } = useDrawer()
  const { entitlements, chatModels } = useAppSession()
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth()
  const insets = useSafeAreaInsets()

  const [messages, setMessages] = useState<Message[]>([])
  const [chatTitle, setChatTitle] = useState('New Chat')
  const [inputValue, setInputValue] = useState('')
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null)
  const [availableModels, setAvailableModels] = useState<ChatModel[]>([])
  const [activeModality, setActiveModality] = useState<'text' | 'image' | 'video'>('text')
  const [isLoading, setIsLoading] = useState(true)
  const [isSwitchingChat, setIsSwitchingChat] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [history, setHistory] = useState<ChatMeta[]>([])
  const [modelPickerVisible, setModelPickerVisible] = useState(false)
  const [upgradeVisible, setUpgradeVisible] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [attachPickerVisible, setAttachPickerVisible] = useState(false)
  const [attachedFile, setAttachedFile] = useState<{ name: string; uri: string; mimeType: string } | null>(null)

  const chatRef = useRef<Chat | null>(null)
  const flatListRef = useRef<FlatList<Message>>(null)
  const textInputRef = useRef<TextInput>(null)
  const abortRef = useRef(false)

  // PanResponder to dismiss keyboard on downward swipe — attached to the whole screen
  // Uses onMoveShouldSetPanResponder so it never blocks taps or typing
  const swipeDownPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 20 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5,
      onPanResponderGrant: () => {},
      onPanResponderMove: () => {},
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 40) {
          textInputRef.current?.blur()
        }
      },
    }),
  ).current

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height)
    })
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  /** Lift composer above keyboard (KAV fails with edge‑to‑edge / some Android IME stacks). */
  const composerFooterInset = Math.max(insets.bottom, spacing.md)
  const composerBottomPadding =
    keyboardHeight > 0 ? keyboardHeight + spacing.sm : composerFooterInset
  /** Keeps latest messages reachable above the lifted composer area. */
  const messageBottomPadding =
    keyboardHeight > 0 ? keyboardHeight + 160 + spacing.md : spacing.md

  const handleOpenDrawer = useCallback(() => {
    textInputRef.current?.blur()
    Keyboard.dismiss()
    openDrawer()
  }, [openDrawer])

  const refreshHistory = useCallback(async () => {
    const nextHistory = await loadChatsMeta(projectId).catch(() => null)
    if (nextHistory) {
      setHistory(nextHistory)
    }
    return nextHistory ?? []
  }, [projectId])

  const syncConversationMeta = useCallback(
    async (overrides: Partial<Chat> = {}) => {
      if (!chatRef.current) return
      if (!history.some((item) => item.id === chatRef.current?.id)) {
        chatRef.current = {
          ...chatRef.current,
          ...overrides,
          updatedAt: Date.now(),
          title: overrides.title ?? chatRef.current.title,
          modelId: overrides.modelId || selectedModel?.id || chatRef.current.modelId,
          lastMode: 'act',
        }
        setChatTitle(chatRef.current.title)
        return
      }

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
      await saveChat(nextChat)
      await refreshHistory()
    },
    [history, refreshHistory, selectedModel?.id],
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

        chatRef.current = chat
        setChatTitle(chat.title)
        setMessages(chat.messages)
        setInputValue('')
        setImageBase64(null)
        await setLastOpenedChatId(chat.id)

        const preferredModelId = chat.actModelId || chat.askModelIds?.[0] || chat.modelId
        const nextSelected =
          models.find((model) => model.id === preferredModelId) ||
          createSyntheticModel(preferredModelId) ||
          models[0] ||
          null
        setSelectedModel(nextSelected)
        return true
      } finally {
        if (options.switching) {
          setIsSwitchingChat(false)
        }
      }
    },
    [],
  )

  const createConversation = useCallback(
    async (models: ChatModel[], options: { replaceRoute?: boolean } = {}) => {
      const preferredId = await getLastSelectedModelId().catch(() => null)
      const modelId = preferredId
        ? (models.find((m) => m.id === preferredId)?.id ?? models[0]?.id)
        : models[0]?.id

      let created: Chat
      try {
        created = await createNewChat(modelId, {
          projectId,
          title: 'New Chat',
        })
      } catch {
        created = createDraftChat(modelId, projectId)
      }

      chatRef.current = created
      setChatTitle(created.title)
      setMessages([])
      setSelectedModel(
        models.find((model) => model.id === created.modelId) ||
          createSyntheticModel(created.modelId) ||
          models[0] ||
          null,
      )
      setInputValue('')
      setImageBase64(null)
      await setLastOpenedChatId(created.id)
      await refreshHistory().catch(() => [])

      if (options.replaceRoute) {
        router.replace({
          pathname: '/chat/[id]',
          params: {
            id: created.id,
            ...(projectId ? { projectId } : {}),
            ...(projectName ? { projectName } : {}),
          },
        })
      }

      return created
    },
    [projectId, projectName, refreshHistory, router],
  )

  useEffect(() => {
    let isMounted = true

    // Guard: skip re-initialization if we already have an active chat session.
    if (chatRef.current !== null && !conversationId) {
      return
    }

    async function resolveModels(): Promise<ChatModel[]> {
      if (chatModels.length > 0) return chatModels
      return getAvailableModels()
    }

    async function resolvePreferredModel(models: ChatModel[]): Promise<ChatModel | null> {
      const persistedId = await getLastSelectedModelId().catch(() => null)
      if (persistedId) {
        const match = models.find((m) => m.id === persistedId)
        if (match) return match
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
          const draft = createDraftChat(preferred?.id ?? models[0]?.id, projectId)
          chatRef.current = draft
          setChatTitle(draft.title)
          setMessages([])
          setSelectedModel(preferred ?? models[0] ?? createSyntheticModel(draft.modelId))
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
  }, [chatModels, conversationId, createConversation, hydrateConversation, routeKind])

  useEffect(() => {
    if (chatModels.length > 0) {
      setAvailableModels(chatModels)
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

  // Poll the conversation list while this screen is focused for near-real-time
  // sync with the web app and other devices.
  useFocusEffect(
    useCallback(() => {
      let intervalId: ReturnType<typeof setInterval> | null = null

      void refreshHistory().catch(() => {})
      intervalId = setInterval(() => {
        void refreshHistory().catch(() => {})
      }, 15000)

      return () => {
        if (intervalId) clearInterval(intervalId)
      }
    }, [refreshHistory]),
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
            ...(projectId ? { projectId } : {}),
            ...(projectName ? { projectName } : {}),
          },
        })
        return
      }

      abortRef.current = true
      await hydrateConversation(chatId, availableModels, { switching: true })
    },
    [availableModels, hydrateConversation, projectId, projectName, routeKind, router],
  )

  const startFreshConversation = useCallback(async () => {
    if (routeKind === 'detail') {
      router.replace({
        pathname: '/chat/[id]',
        params: {
          id: 'new',
          ...(projectId ? { projectId } : {}),
          ...(projectName ? { projectName } : {}),
        },
      })
      return
    }

    await createConversation(availableModels)
  }, [availableModels, createConversation, projectId, projectName, routeKind, router])

  const handleDeleteConversation = useCallback(
    async (chatId: string) => {
      try {
        await deleteChat(chatId)
      } catch {
        return
      }

      const nextHistory = await refreshHistory()

      if (chatRef.current?.id !== chatId) {
        return
      }

      const fallback = nextHistory.find((chat) => chat.id !== chatId)
      if (fallback) {
        await openConversation(fallback.id)
        return
      }

      await startFreshConversation()
    },
    [openConversation, refreshHistory, startFreshConversation],
  )

  const handleRenameConversation = useCallback(
    async (chatId: string, title: string) => {
      try {
        await updateChatTitle(chatId, title)
      } catch {
        return
      }
      if (chatRef.current?.id === chatId) {
        setChatTitle(title)
      }
      await refreshHistory()
    },
    [refreshHistory],
  )

  const pickImage = useCallback(async () => {
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

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    if (result.canceled) return
    const asset = result.assets[0]
    const mimeType = asset.mimeType ?? 'application/octet-stream'
    if (mimeType.startsWith('image/')) {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' })
      setImageBase64(`data:${mimeType};base64,${base64}`)
    } else {
      setAttachedFile({ name: asset.name, uri: asset.uri, mimeType })
    }
  }, [])

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

  const handleSend = useCallback(async () => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push('/auth-flow?force=true')
      return
    }

    const activeChat = chatRef.current
    if ((!inputValue.trim() && !imageBase64 && !attachedFile) || !selectedModel || !activeChat || isSending) {
      return
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    abortRef.current = false
    setIsSending(true)

    let fileContext = ''
    if (attachedFile) {
      try {
        const isText = attachedFile.mimeType.startsWith('text/') || attachedFile.name.endsWith('.md') || attachedFile.name.endsWith('.json')
        if (isText) {
          const content = await FileSystem.readAsStringAsync(attachedFile.uri)
          fileContext = `\n\n[File: ${attachedFile.name}]\n${content}`
        } else {
          fileContext = `\n\n[Attached file: ${attachedFile.name}]`
        }
      } catch {
        fileContext = `\n\n[Attached file: ${attachedFile.name}]`
      }
    }

    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content: inputValue.trim() + fileContext,
      timestamp: Date.now(),
      imageData: imageBase64 || undefined,
      mode: 'act',
    }

    const nextTitle = getNextTitle(chatTitle, inputValue.trim() || attachedFile?.name || '')
    const userMessageList = [...messages, userMessage]
    const assistantId = generateMessageId()
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
    }

    setMessages([...userMessageList, placeholderAssistant])
    setInputValue('')
    setImageBase64(null)
    setAttachedFile(null)

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
    scrollToBottom()

    try {
      console.log('[ChatScreen] send: conversationId=%s modelId=%s baseUrl=%s', activeChat.id, selectedModel.id, AUTH_BASE_URL)
      for await (const chunk of chatStream(selectedModel.id, buildApiMessages(userMessageList), {
        conversationId: activeChat.id,
        turnId: assistantId,
      })) {
        if (abortRef.current) break
        setMessages((current) => applyStreamChunk(current, assistantId, selectedModel, chunk))
        if (
          chunk.type === 'text' ||
          chunk.type === 'reasoning' ||
          chunk.type === 'tool' ||
          chunk.type === 'file'
        ) {
          scrollToBottom()
        }
      }
    } catch (error) {
      console.error('[ChatScreen] send failed:', error)
      setMessages((current) =>
        applyStreamChunk(current, assistantId, selectedModel, {
          type: 'error',
          content: String(error),
        }),
      )
    } finally {
      setIsSending(false)
    }

    const refreshed = await loadChat(activeChat.id)
    if (refreshed) {
      chatRef.current = refreshed
      setChatTitle(refreshed.title)
      setMessages(refreshed.messages)
    } else {
      setMessages((current) =>
        applyStreamChunk(current, assistantId, selectedModel, { type: 'done', content: '' }),
      )
    }

    await refreshHistory()
    scrollToBottom()
  }, [
    attachedFile,
    chatTitle,
    imageBase64,
    inputValue,
    isAuthLoading,
    isAuthenticated,
    isSending,
    messages,
    refreshHistory,
    router,
    scrollToBottom,
    selectedModel,
    syncConversationMeta,
  ])

  const sortedModels = useMemo(() => availableModels, [availableModels])

  useEffect(() => {
    if (entitlements?.tier === 'free') {
      setUpgradeVisible(true)
    }
  }, [entitlements?.tier])

  if (isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.textSecondary} size="large" />
      </View>
    )
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
        />
      }
    >
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.screenPadding} {...swipeDownPanResponder.panHandlers}>
          <MainScreenHeader
            theme={theme}
            isDark={isDark}
            topInset={insets.top}
            blurHeight={insets.top + 60}
            leftSlot={
              routeKind !== 'detail' ? (
                <TopBarIconButton theme={theme} icon="menu" onPress={handleOpenDrawer} />
              ) : (
                <View style={{ width: 44 }} />
              )
            }
            centerSlot={
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => setModelPickerVisible(true)}
                style={styles.floatingModelPill}
              >
                {isSwitchingChat ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : null}
                <Text style={[styles.topBarModelName, { color: theme.text }]} numberOfLines={1}>
                  {selectedModel?.name ?? 'Select model'}
                </Text>
                <Feather name="chevron-down" size={14} color={theme.textSecondary} />
              </TouchableOpacity>
            }
            rightSlot={
              <TopBarIconButton
                theme={theme}
                icon="plus"
                onPress={() => {
                  void startFreshConversation()
                }}
              />
            }
          />

          <View style={styles.threadSurface}>
            {messages.length === 0 ? (
              <View style={styles.emptySurface}>
                <Image source={OVERLAY_LOGO} style={styles.overlayLogo} resizeMode="contain" />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>
                  {'How can I help you this ' + getTimeGreeting() + '?'}
                </Text>
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <MessageBubble
                    message={item}
                    theme={theme}
                    onCopy={async (content) => {
                      await Clipboard.setStringAsync(content)
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                    }}
                  />
                )}
                contentContainerStyle={[styles.messageList, { paddingTop: insets.top + 70, paddingBottom: messageBottomPadding }]}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
                onContentSizeChange={scrollToBottom}
              />
            )}
          </View>

          <View style={[styles.composerSurface, { paddingBottom: composerBottomPadding }]}>
            {imageBase64 ? (
              <View style={[styles.attachmentBar, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                <View style={styles.attachmentInfo}>
                  <Feather name="image" size={14} color={theme.textSecondary} />
                  <Text style={[styles.attachmentText, { color: theme.textSecondary }]}>Image attached</Text>
                </View>
                <TopBarIconButton theme={theme} icon="x" onPress={() => setImageBase64(null)} />
              </View>
            ) : null}
            {attachedFile ? (
              <View style={[styles.attachmentBar, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                <View style={styles.attachmentInfo}>
                  <Feather name="file-text" size={14} color={theme.textSecondary} />
                  <Text style={[styles.attachmentText, { color: theme.textSecondary }]} numberOfLines={1}>{attachedFile.name}</Text>
                </View>
                <TopBarIconButton theme={theme} icon="x" onPress={() => setAttachedFile(null)} />
              </View>
            ) : null}

            <GlassSurface interactive style={[styles.composerBox, { backgroundColor: theme.glassBg, borderColor: composerFocused ? theme.border : theme.glassBorder }]}>
              <TextInput
                ref={textInputRef}
                value={inputValue}
                onChangeText={setInputValue}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                placeholder={
                  activeModality === 'image'
                    ? 'Ask about the image'
                    : 'Chat with Overlay'
                }
                placeholderTextColor={theme.textDisabled}
                multiline
                maxLength={10000}
                style={[styles.composerInput, { color: theme.text }]}
              />

              <View style={styles.composerFooter}>
                <GlassSurface interactive style={[styles.composerIconButton, { backgroundColor: theme.surfaceSubtle }]}>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    onPress={() => setAttachPickerVisible(true)}
                    style={[styles.composerIconButton]}
                  >
                    <Feather name="plus" size={22} color={theme.textSecondary} />
                  </TouchableOpacity>
                </GlassSurface>

                <View style={styles.composerRightActions}>
                  <GlassSurface interactive style={[styles.sendButton, { backgroundColor: theme.foreground }]}>
                    <TouchableOpacity
                      onPress={() => {
                        void handleSend()
                      }}
                      activeOpacity={0.82}
                      disabled={isSending}
                      style={styles.sendButton}
                    >
                      {isSending ? (
                        <ActivityIndicator size="small" color={theme.background} />
                      ) : (
                        <Feather name="arrow-up" size={18} color={theme.background} />
                      )}
                    </TouchableOpacity>
                  </GlassSurface>
                </View>
              </View>
            </GlassSurface>
          </View>
        </View>

      <BottomSheet
        theme={theme}
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        title="Choose model"
      >
        <View style={styles.modelList}>
          {sortedModels.map((model, index) => {
            const isSelected = selectedModel?.id === model.id
            const isLast = index === sortedModels.length - 1
            return (
              <React.Fragment key={model.id}>
                <TouchableOpacity
                  onPress={() => { void handleModelSelect(model) }}
                  activeOpacity={0.7}
                  style={styles.modelRow}
                >
                  <View style={styles.modelRowLeft}>
                    {getProviderLogo(model.provider) ? (
                      <Image
                        source={getProviderLogo(model.provider)}
                        style={styles.providerLogo}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={[styles.providerLogoPlaceholder, { backgroundColor: theme.surfaceElevated }]}>
                        <Text style={[styles.providerInitial, { color: theme.textSecondary }]}>
                          {model.provider.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={styles.modelRowContent}>
                      <Text style={[styles.modelRowTitle, { color: theme.text }]}>
                        {model.name}
                      </Text>
                      <Text style={[styles.modelRowDesc, { color: theme.textSecondary }]}>
                        {getModelDescription(model)}
                      </Text>
                    </View>
                  </View>
                  {isSelected && (
                    <Feather name="check" size={18} color={theme.text} />
                  )}
                </TouchableOpacity>
                {!isLast && (
                  <View style={[styles.modelSeparator, { backgroundColor: theme.border }]} />
                )}
              </React.Fragment>
            )
          })}
        </View>
      </BottomSheet>

      <UpgradePrompt
        visible={upgradeVisible}
        theme={theme}
        onClose={() => setUpgradeVisible(false)}
      />

      <BottomSheet
        theme={theme}
        visible={attachPickerVisible}
        onClose={() => setAttachPickerVisible(false)}
        title="Add to Chat"
      >
        <View style={styles.attachSheetGrid}>
          <TouchableOpacity
            style={[styles.attachSheetCell, { backgroundColor: theme.surfaceElevated }]}
            activeOpacity={0.82}
            onPress={() => {
              setAttachPickerVisible(false)
              void pickImageFromCamera()
            }}
          >
            <Feather name="camera" size={24} color={theme.text} />
            <Text style={[styles.attachSheetLabel, { color: theme.text }]}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attachSheetCell, { backgroundColor: theme.surfaceElevated }]}
            activeOpacity={0.82}
            onPress={() => {
              setAttachPickerVisible(false)
              setActiveModality('image')
              void pickImage()
            }}
          >
            <Feather name="image" size={24} color={theme.text} />
            <Text style={[styles.attachSheetLabel, { color: theme.text }]}>Photos</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attachSheetCell, { backgroundColor: theme.surfaceElevated }]}
            activeOpacity={0.82}
            onPress={() => {
              setAttachPickerVisible(false)
              void pickFile()
            }}
          >
            <Feather name="file" size={24} color={theme.text} />
            <Text style={[styles.attachSheetLabel, { color: theme.text }]}>Files</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
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
  modelRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  providerLogo: {
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  providerLogoPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 4,
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
})
