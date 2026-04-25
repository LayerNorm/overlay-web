import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
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
import { chatStream, DEFAULT_CHAT_MODEL_ID, getAvailableModels, type StreamChunk } from '../../services/aiService'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { MessageBubble } from './MessageBubble'
import { ChatHistorySheet } from './ChatHistorySheet'
import {
  BottomSheet,
  StatusPill,
  TopBarIconButton,
} from '../ui/AppChrome'

const PROMPT_SUGGESTIONS = [
  'Summarize the key point here.',
  'Turn this into a concrete plan.',
  'Draft a sharper reply.',
  'Explain this simply, then go deeper.',
] as const

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

function isAuthRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('authentication required')
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
  const { theme } = useTheme()
  const { width } = useWindowDimensions()
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
  const [historyVisible, setHistoryVisible] = useState(false)
  const [history, setHistory] = useState<ChatMeta[]>([])
  const [modelPickerVisible, setModelPickerVisible] = useState(false)

  const chatRef = useRef<Chat | null>(null)
  const flatListRef = useRef<FlatList<Message>>(null)
  const abortRef = useRef(false)

  const showInlineControls = width >= 720
  const bottomTabClearance = routeKind === 'tab' ? 76 : 0
  const composerBottomPadding = Math.max(insets.bottom, spacing.sm) + bottomTabClearance
  const messageBottomPadding = spacing.md + bottomTabClearance

  const refreshHistory = useCallback(async () => {
    const nextHistory = await loadChatsMeta(projectId).catch(() => [])
    setHistory(nextHistory)
    return nextHistory
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
      let created: Chat
      try {
        created = await createNewChat(models[0]?.id, {
          projectId,
          title: 'New Chat',
        })
      } catch {
        created = createDraftChat(models[0]?.id, projectId)
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

    async function initialize(): Promise<void> {
      setIsLoading(true)

      try {
        const models = await getAvailableModels()
        if (!isMounted) return

        setAvailableModels(models)
        setSelectedModel(models[0] || null)

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
      } catch (error) {
        if (isMounted && isAuthRequiredError(error)) {
          router.replace('/auth-flow?mode=sign-in&force=true')
          return
        }

        if (isMounted) {
          const models = await getAvailableModels().catch(() => [])
          const draft = createDraftChat(models[0]?.id, projectId)
          chatRef.current = draft
          setChatTitle(draft.title)
          setMessages([])
          setSelectedModel(models[0] || createSyntheticModel(draft.modelId))
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
  }, [conversationId, createConversation, hydrateConversation, routeKind])

  useFocusEffect(
    useCallback(() => {
      void refreshHistory().catch((error) => {
        if (isAuthRequiredError(error)) {
          router.replace('/auth-flow?mode=sign-in&force=true')
        }
      })
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
      } catch (error) {
        if (isAuthRequiredError(error)) {
          router.replace('/auth-flow?mode=sign-in&force=true')
        }
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
      } catch (error) {
        if (isAuthRequiredError(error)) {
          router.replace('/auth-flow?mode=sign-in&force=true')
        }
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

  const handleModelSelect = useCallback(
    async (model: ChatModel) => {
      setSelectedModel(model)
      setModelPickerVisible(false)
      await syncConversationMeta({
        modelId: model.id,
        askModelIds: [model.id],
        actModelId: model.id,
      })
    },
    [syncConversationMeta],
  )

  const handleSend = useCallback(async () => {
    const activeChat = chatRef.current
    if ((!inputValue.trim() && !imageBase64) || !selectedModel || !activeChat || isSending) {
      return
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    abortRef.current = false
    setIsSending(true)

    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
      imageData: imageBase64 || undefined,
      mode: 'act',
    }

    const nextTitle = getNextTitle(chatTitle, userMessage.content)
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

    try {
      await syncConversationMeta({
        title: nextTitle,
        modelId: selectedModel.id,
        askModelIds: [selectedModel.id],
        actModelId: selectedModel.id,
        lastMode: 'act',
      })
    } catch (error) {
      if (isAuthRequiredError(error)) {
        router.replace('/auth-flow?mode=sign-in&force=true')
        setIsSending(false)
        return
      }
    }
    scrollToBottom()

    try {
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
    chatTitle,
    imageBase64,
    inputValue,
    isSending,
    messages,
    refreshHistory,
    scrollToBottom,
    selectedModel,
    syncConversationMeta,
  ])

  const sortedModels = useMemo(() => availableModels, [availableModels])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.loadingScreen, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.textSecondary} size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
      >
        <View style={styles.screenPadding}>
          <View style={[styles.topBar, { borderBottomColor: theme.border, backgroundColor: theme.background }]}>
            <TopBarIconButton
              theme={theme}
              icon={routeKind === 'detail' ? 'chevron-left' : 'menu'}
              onPress={() => {
                if (routeKind === 'detail') {
                  if (router.canGoBack()) {
                    router.back()
                  } else {
                    router.replace('/(tabs)/chat')
                  }
                  return
                }

                setHistoryVisible(true)
              }}
            />

            <View style={styles.topBarCenter}>
              <Text style={[styles.topTitle, { color: theme.text }]} numberOfLines={1}>
                {chatTitle}
              </Text>
              <View style={styles.topMetaRow}>
                {isSwitchingChat ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
                <Text style={[styles.topMeta, { color: theme.textSecondary }]}>
                  {projectName || 'Overlay'}
                </Text>
                {projectName ? <StatusPill theme={theme} label={projectName} tone="default" /> : null}
              </View>
            </View>

            <TopBarIconButton
              theme={theme}
              icon="plus"
              onPress={() => {
                void startFreshConversation()
              }}
            />
          </View>

          <View style={[styles.controlStrip, showInlineControls && styles.controlStripInline]}>
            <View style={[styles.modalityTabs, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
              {([
                { value: 'text', icon: 'message-square', label: 'Text' },
                { value: 'image', icon: 'image', label: 'Image' },
                { value: 'video', icon: 'video', label: 'Video' },
              ] as const).map((item) => {
                const active = activeModality === item.value
                return (
                  <TouchableOpacity
                    key={item.value}
                    activeOpacity={0.82}
                    onPress={() => {
                      setActiveModality(item.value)
                      if (item.value === 'image') {
                        void pickImage()
                      }
                    }}
                    style={[
                      styles.modalityTab,
                      { backgroundColor: active ? theme.foreground : 'transparent' },
                    ]}
                  >
                    <Feather
                      name={item.icon}
                      size={13}
                      color={active ? theme.background : theme.textSecondary}
                    />
                    <Text style={[styles.modalityText, { color: active ? theme.background : theme.textSecondary }]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => setModelPickerVisible(true)}
              style={[styles.modelButton, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
            >
              {selectedModel ? (
                <>
                  <View
                    style={[
                      styles.providerDot,
                      { backgroundColor: PROVIDER_COLORS[selectedModel.provider] || theme.textSecondary },
                    ]}
                  />
                  <Text style={[styles.modelButtonText, { color: theme.text }]} numberOfLines={1}>
                    {selectedModel.name}
                  </Text>
                </>
              ) : (
                <Text style={[styles.modelButtonText, { color: theme.textSecondary }]}>No models</Text>
              )}
              <Feather name="chevron-down" size={15} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.threadSurface}>
            {messages.length === 0 ? (
              <View style={styles.emptySurface}>
                <View style={[styles.brandMark, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
                  <Text style={[styles.brandGlyph, { color: theme.text }]}>O</Text>
                </View>
                <Text style={[styles.emptyTitle, { color: theme.text }]}>Ask Overlay</Text>
                <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>
                  Ask a question, attach an image, or describe a video. Replies stream in as they arrive.
                </Text>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.promptRow}
                >
                  {PROMPT_SUGGESTIONS.map((prompt) => (
                    <TouchableOpacity
                      key={prompt}
                      onPress={() => setInputValue(prompt)}
                      activeOpacity={0.82}
                      style={[
                        styles.promptChip,
                        { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
                      ]}
                    >
                      <Text style={[styles.promptChipText, { color: theme.textSecondary }]}>{prompt}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
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
                contentContainerStyle={[styles.messageList, { paddingBottom: messageBottomPadding }]}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={scrollToBottom}
              />
            )}
          </View>

          <View style={[styles.composerSurface, { paddingBottom: composerBottomPadding }]}>
            {imageBase64 ? (
              <View style={[styles.attachmentBar, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <View style={styles.attachmentInfo}>
                  <Feather name="image" size={14} color={theme.textSecondary} />
                  <Text style={[styles.attachmentText, { color: theme.textSecondary }]}>Image attached</Text>
                </View>
                <TopBarIconButton theme={theme} icon="x" onPress={() => setImageBase64(null)} />
              </View>
            ) : null}

            {activeModality === 'video' ? (
              <View style={[styles.statusBar, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <Feather name="video" size={14} color={theme.textSecondary} />
                <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                  Video mode sends your prompt to Act with video-generation intent.
                </Text>
              </View>
            ) : null}

            <View style={[styles.composerBox, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <TextInput
                value={inputValue}
                onChangeText={setInputValue}
                placeholder={
                  activeModality === 'video'
                    ? 'Describe the video you want...'
                    : activeModality === 'image'
                      ? 'Ask about the image or describe what to create...'
                      : 'Ask Overlay anything...'
                }
                placeholderTextColor={theme.textDisabled}
                multiline
                maxLength={10000}
                style={[styles.composerInput, { color: theme.text }]}
              />

              <View style={styles.composerFooter}>
                <View style={styles.leftComposerActions}>
                  <TopBarIconButton
                    theme={theme}
                    icon="image"
                    onPress={() => {
                      setActiveModality('image')
                      void pickImage()
                    }}
                  />
                  <TopBarIconButton
                    theme={theme}
                    icon="video"
                    onPress={() => {
                      setActiveModality('video')
                    }}
                    active={activeModality === 'video'}
                  />
                </View>

                <TouchableOpacity
                  onPress={() => {
                    void handleSend()
                  }}
                  activeOpacity={0.82}
                  disabled={(!inputValue.trim() && !imageBase64) || isSending}
                  style={[
                    styles.sendButton,
                    {
                      backgroundColor:
                        inputValue.trim() || imageBase64 ? theme.buttonPrimaryBg : theme.surfaceSubtle,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color={theme.buttonPrimaryText} />
                  ) : (
                    <Feather
                      name="arrow-up"
                      size={18}
                      color={
                        inputValue.trim() || imageBase64 ? theme.buttonPrimaryText : theme.textDisabled
                      }
                    />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <ChatHistorySheet
        theme={theme}
        visible={historyVisible}
        chats={history}
        activeChatId={chatRef.current?.id || null}
        streamingChatId={isSending ? chatRef.current?.id || null : null}
        onClose={() => setHistoryVisible(false)}
        onSelectChat={(chatId) => {
          void openConversation(chatId)
        }}
        onCreateChat={() => {
          void startFreshConversation()
        }}
        onDeleteChat={handleDeleteConversation}
        onRenameChat={handleRenameConversation}
      />

      <BottomSheet
        theme={theme}
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        title="Choose model"
      >
        <View style={styles.modelList}>
          {sortedModels.map((model) => {
            const isSelected = selectedModel?.id === model.id
            return (
              <TouchableOpacity
                key={model.id}
                onPress={() => {
                  void handleModelSelect(model)
                }}
                activeOpacity={0.82}
                style={[
                  styles.modelRow,
                  {
                    backgroundColor: isSelected ? theme.surfaceSubtle : theme.surfaceElevated,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.modelRowCopy}>
                  <View style={styles.modelRowTitleLine}>
                    <View
                      style={[
                        styles.providerDot,
                        { backgroundColor: PROVIDER_COLORS[model.provider] || theme.textSecondary },
                      ]}
                    />
                    <Text style={[styles.modelRowTitle, { color: theme.text }]}>{model.name}</Text>
                  </View>
                  <Text style={[styles.modelRowDescription, { color: theme.textSecondary }]}>
                    {model.description || 'General purpose model'}
                  </Text>
                  <View style={styles.modelTagRow}>
                    {capabilityTags(model).map((tag) => (
                      <StatusPill key={`${model.id}-${tag}`} theme={theme} label={tag} />
                    ))}
                  </View>
                </View>
                {isSelected ? <Feather name="check" size={16} color={theme.text} /> : null}
              </TouchableOpacity>
            )
          })}
        </View>
      </BottomSheet>
    </SafeAreaView>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  topTitle: {
    maxWidth: '100%',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  topMetaRow: {
    minHeight: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topMeta: {
    fontSize: 11,
    fontWeight: '600',
  },
  controlStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  controlStripInline: {
    justifyContent: 'center',
  },
  modalityTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    padding: 3,
    gap: 2,
  },
  modalityTab: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: borderRadius.full,
    paddingHorizontal: 9,
  },
  modalityText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modelButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    maxWidth: 180,
  },
  providerDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  modelButtonText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  threadSurface: {
    flex: 1,
    overflow: 'hidden',
  },
  emptySurface: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: 18,
  },
  brandMark: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandGlyph: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    fontFamily: 'LibreBaskerville',
  },
  emptyTitle: {
    marginTop: spacing.xs,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    fontFamily: 'LibreBaskerville',
    textAlign: 'center',
  },
  emptyDescription: {
    maxWidth: 320,
    fontSize: fontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
  },
  promptRow: {
    width: '100%',
    gap: 8,
    paddingTop: spacing.sm,
  },
  promptChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  promptChipText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  messageList: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  composerSurface: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
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
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  statusText: {
    fontSize: fontSize.sm,
    flex: 1,
  },
  composerBox: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 8,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  composerInput: {
    minHeight: 58,
    maxHeight: 150,
    fontSize: fontSize.md,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftComposerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelList: {
    gap: spacing.sm,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
  },
  modelRowCopy: {
    flex: 1,
    gap: 8,
  },
  modelRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modelRowTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  modelRowDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  modelTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
})
