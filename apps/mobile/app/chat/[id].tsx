import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { MessageBubble } from '../../components/chat/MessageBubble'
import { IconAction, PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import { Chat, ChatModel, Message, PROVIDER_COLORS, generateMessageId, generateTempTitle } from '../../services/chatTypes'
import { chatStream, getAvailableModels, type StreamChunk } from '../../services/aiService'
import { createNewChat, loadChat, saveChat, setLastOpenedChatId } from '../../services/chatStorage'

const PROMPT_SUGGESTIONS = [
  'Summarize what I need to focus on today.',
  'Turn this into an action plan.',
  'Help me write a sharper response.',
  'Explain this simply, then go deeper.',
]

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

export default function ChatConversationScreen(): React.ReactElement {
  const { id, projectId, projectName } = useLocalSearchParams<{
    id: string
    projectId?: string
    projectName?: string
  }>()
  const router = useRouter()
  const { theme, isDark } = useTheme()

  const [messages, setMessages] = useState<Message[]>([])
  const [chatTitle, setChatTitle] = useState('New Chat')
  const [inputValue, setInputValue] = useState('')
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null)
  const [availableModels, setAvailableModels] = useState<ChatModel[]>([])
  const [currentMode, setCurrentMode] = useState<'ask' | 'act'>('act')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)

  const chatRef = useRef<Chat | null>(null)
  const flatListRef = useRef<FlatList<Message>>(null)
  const abortRef = useRef(false)

  const { isRecording, isProcessing: isTranscribing, toggleRecording } = useVoiceInput()

  const syncConversationMeta = useCallback(
    async (overrides: Partial<Chat> = {}) => {
      if (!chatRef.current) return

      const resolvedModelId = overrides.modelId || selectedModel?.id || chatRef.current.modelId
      const resolvedMode = overrides.lastMode || currentMode

      const nextChat: Chat = {
        ...chatRef.current,
        ...overrides,
        title: overrides.title ?? chatRef.current.title,
        updatedAt: Date.now(),
        modelId: resolvedModelId,
        askModelIds: resolvedModelId ? [resolvedModelId] : chatRef.current.askModelIds,
        actModelId: resolvedModelId || chatRef.current.actModelId,
        lastMode: resolvedMode,
      }

      chatRef.current = nextChat
      setChatTitle(nextChat.title)
      await saveChat(nextChat)
    },
    [currentMode, selectedModel?.id],
  )

  const hydrateChat = useCallback(
    async (chatId: string, models: ChatModel[]) => {
      const chat = await loadChat(chatId)
      if (!chat) return

      chatRef.current = chat
      setChatTitle(chat.title)
      setMessages(chat.messages)
      setCurrentMode(chat.lastMode || 'act')
      await setLastOpenedChatId(chat.id)

      const preferredModelId = chat.actModelId || chat.askModelIds?.[0] || chat.modelId
      const nextSelected = models.find((model) => model.id === preferredModelId) || models[0] || null
      setSelectedModel(nextSelected)
    },
    [],
  )

  useEffect(() => {
    let isMounted = true

    async function initialize(): Promise<void> {
      try {
        const models = await getAvailableModels()
        if (!isMounted) return

        setAvailableModels(models)
        setSelectedModel(models[0] || null)

        if (id === 'new') {
          const created = await createNewChat(models[0]?.id, {
            projectId,
            title: 'New Chat',
          })
          if (!isMounted) return
          chatRef.current = created
          setChatTitle(created.title)
          setMessages([])
          setCurrentMode(created.lastMode || 'act')
          setSelectedModel(models.find((model) => model.id === created.modelId) || models[0] || null)
          await setLastOpenedChatId(created.id)
          router.replace(`/chat/${created.id}`)
        } else if (id) {
          await hydrateChat(id, models)
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
  }, [hydrateChat, id, projectId, router])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true })
    })
  }, [])

  const handleVoiceToggle = useCallback(async () => {
    const result = await toggleRecording()
    if (result?.text) {
      setInputValue((current) => {
        const separator = current.trim().length > 0 ? ' ' : ''
        return `${current}${separator}${result.text}`.trimStart()
      })
    }
  }, [toggleRecording])

  const handleModeChange = useCallback(
    async (mode: 'ask' | 'act') => {
      setCurrentMode(mode)
      await syncConversationMeta({ lastMode: mode })
    },
    [syncConversationMeta],
  )

  const handleModelSelect = useCallback(
    async (model: ChatModel) => {
      setSelectedModel(model)
      setShowModelPicker(false)
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
      mode: currentMode,
    }

    const nextTitle =
      chatTitle === 'New Chat' && userMessage.content
        ? generateTempTitle(userMessage.content)
        : chatTitle

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
      mode: currentMode,
    }

    const optimisticMessages = [...userMessageList, placeholderAssistant]
    setMessages(optimisticMessages)
    setInputValue('')
    setImageBase64(null)
    await syncConversationMeta({
      title: nextTitle,
      modelId: selectedModel.id,
      askModelIds: [selectedModel.id],
      actModelId: selectedModel.id,
      lastMode: currentMode,
    })
    scrollToBottom()

    try {
      for await (const chunk of chatStream(selectedModel.id, buildApiMessages(userMessageList), {
        mode: currentMode,
        conversationId: activeChat.id,
        turnId: assistantId,
      })) {
        if (abortRef.current) break
        setMessages((current) => applyStreamChunk(current, assistantId, selectedModel, chunk))
        if (chunk.type === 'text' || chunk.type === 'reasoning' || chunk.type === 'tool' || chunk.type === 'file') {
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
      setCurrentMode(refreshed.lastMode || currentMode)
    } else {
      setMessages((current) => applyStreamChunk(current, assistantId, selectedModel, { type: 'done', content: '' }))
    }

    scrollToBottom()
  }, [
    chatTitle,
    currentMode,
    imageBase64,
    inputValue,
    isSending,
    messages,
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
      <View style={[styles.ambientGlow, styles.ambientGlowLeft, { backgroundColor: theme.surface }]} />
      <View style={[styles.ambientGlow, styles.ambientGlowRight, { backgroundColor: theme.surface }]} />

      <View style={styles.screenPadding}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              abortRef.current = true
              router.back()
            }}
            activeOpacity={0.82}
            style={[styles.backButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Feather name="chevron-left" size={20} color={theme.text} />
          </TouchableOpacity>

          <View style={styles.headerCopy}>
              <SectionLabel theme={theme}>Chat</SectionLabel>
              <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
                {chatTitle}
              </Text>
              {projectName ? (
                <Text style={[styles.headerProject, { color: theme.textSecondary }]} numberOfLines={1}>
                  {projectName}
                </Text>
              ) : null}
            </View>

          <IconAction theme={theme} icon="sliders" onPress={() => setShowModelPicker(true)} />
        </View>

        <PanelCard theme={theme}>
          <View style={styles.topCard}>
            <View style={styles.topCardCopy}>
              <Text style={[styles.topCardTitle, { color: theme.text }]}>Shared Overlay conversation flow</Text>
              <Text style={[styles.topCardDescription, { color: theme.textSecondary }]}>
                Mobile now uses the same conversation APIs, model ordering, and ask or act modes as the web app.
              </Text>
            </View>

            <View style={styles.topCardControls}>
              <View style={[styles.modeSwitch, { backgroundColor: theme.background, borderColor: theme.border }]}>
                {(['ask', 'act'] as const).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => {
                      void handleModeChange(mode)
                    }}
                    activeOpacity={0.82}
                    style={[
                      styles.modePill,
                      {
                        backgroundColor: currentMode === mode ? theme.buttonBg : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modePillText,
                        { color: currentMode === mode ? theme.surface : theme.textSecondary },
                      ]}
                    >
                      {mode === 'ask' ? 'Ask' : 'Act'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.modelPill, { backgroundColor: theme.background, borderColor: theme.border }]}
                onPress={() => setShowModelPicker(true)}
                activeOpacity={0.82}
              >
                {selectedModel ? (
                  <>
                    <View
                      style={[
                        styles.providerDot,
                        { backgroundColor: PROVIDER_COLORS[selectedModel.provider] || theme.textSecondary },
                      ]}
                    />
                    <Text style={[styles.modelPillText, { color: theme.text }]} numberOfLines={1}>
                      {selectedModel.name}
                    </Text>
                    <Feather name="chevron-down" size={15} color={theme.textSecondary} />
                  </>
                ) : (
                  <Text style={[styles.modelPillText, { color: theme.textSecondary }]}>No models</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </PanelCard>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <PanelCard theme={theme} padded={false}>
            {messages.length === 0 ? (
              <View style={styles.emptyThread}>
                <View style={[styles.emptyThreadIcon, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <Feather name="message-square" size={28} color={theme.textSecondary} />
                </View>
                <Text style={[styles.emptyThreadTitle, { color: theme.text }]}>Start with a sharper prompt</Text>
                <Text style={[styles.emptyThreadDescription, { color: theme.textSecondary }]}>
                  Choose ask for a direct answer or act for tool-enabled work, then send text, image context, or voice input.
                </Text>

                <View style={styles.suggestionGrid}>
                  {PROMPT_SUGGESTIONS.map((prompt) => (
                    <TouchableOpacity
                      key={prompt}
                      onPress={() => setInputValue(prompt)}
                      activeOpacity={0.82}
                      style={[styles.suggestionCard, { backgroundColor: theme.background, borderColor: theme.border }]}
                    >
                      <Text style={[styles.suggestionText, { color: theme.text }]}>{prompt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
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
                contentContainerStyle={styles.messageList}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={scrollToBottom}
              />
            )}
          </PanelCard>

          <View style={styles.composerWrap}>
            <PanelCard theme={theme}>
              {imageBase64 ? (
                <View style={[styles.attachmentBar, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <Feather name="image" size={15} color={theme.textSecondary} />
                  <Text style={[styles.attachmentText, { color: theme.textSecondary }]}>Image attached</Text>
                  <TouchableOpacity
                    onPress={() => setImageBase64(null)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Feather name="x" size={15} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>
              ) : null}

              {isRecording || isTranscribing ? (
                <View style={[styles.statusBar, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  {isTranscribing ? (
                    <ActivityIndicator size="small" color={theme.textSecondary} />
                  ) : (
                    <View style={styles.recordingDot} />
                  )}
                  <Text style={[styles.statusText, { color: isRecording ? '#EF4444' : theme.textSecondary }]}>
                    {isRecording ? 'Recording voice input…' : 'Transcribing voice input…'}
                  </Text>
                </View>
              ) : null}

              <View style={styles.composerActions}>
                <View style={styles.leftActions}>
                  <IconAction
                    theme={theme}
                    icon="image"
                    onPress={async () => {
                      const result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['images'],
                        base64: true,
                        quality: 0.7,
                      })

                      if (!result.canceled && result.assets[0].base64) {
                        const mimeType = result.assets[0].mimeType || 'image/jpeg'
                        setImageBase64(`data:${mimeType};base64,${result.assets[0].base64}`)
                      }
                    }}
                  />
                  <IconAction
                    theme={theme}
                    icon={isRecording ? 'square' : 'mic'}
                    onPress={() => {
                      void handleVoiceToggle()
                    }}
                    active={isRecording}
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
                      backgroundColor: inputValue.trim() || imageBase64 ? theme.buttonBg : theme.background,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color={theme.surface} />
                  ) : (
                    <Feather
                      name="arrow-up"
                      size={18}
                      color={inputValue.trim() || imageBase64 ? theme.surface : theme.textDisabled}
                    />
                  )}
                </TouchableOpacity>
              </View>

              <TextInput
                value={inputValue}
                onChangeText={setInputValue}
                placeholder={currentMode === 'ask' ? 'Ask Overlay anything…' : 'Tell Overlay what to do…'}
                placeholderTextColor={theme.textDisabled}
                multiline
                maxLength={10000}
                style={[styles.composerInput, { color: theme.text }]}
              />

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptRow}>
                {PROMPT_SUGGESTIONS.map((prompt) => (
                  <TouchableOpacity
                    key={prompt}
                    onPress={() => setInputValue(prompt)}
                    activeOpacity={0.82}
                    style={[styles.promptChip, { backgroundColor: theme.background, borderColor: theme.border }]}
                  >
                    <Text style={[styles.promptChipText, { color: theme.textSecondary }]} numberOfLines={1}>
                      {prompt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </PanelCard>
          </View>
        </KeyboardAvoidingView>
      </View>

      {showModelPicker ? (
        <View style={[styles.overlayScrim, { backgroundColor: isDark ? 'rgba(0,0,0,0.48)' : 'rgba(10,10,10,0.18)' }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowModelPicker(false)} />
          <View style={[styles.modelSheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.modelSheetHeader}>
              <Text style={[styles.modelSheetTitle, { color: theme.text }]}>Choose model</Text>
              <IconAction theme={theme} icon="x" onPress={() => setShowModelPicker(false)} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {sortedModels.map((model) => (
                <TouchableOpacity
                  key={model.id}
                  onPress={() => {
                    void handleModelSelect(model)
                  }}
                  activeOpacity={0.82}
                  style={[
                    styles.modelOption,
                    {
                      backgroundColor: selectedModel?.id === model.id ? theme.background : 'transparent',
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <View style={styles.modelOptionCopy}>
                    <View style={styles.modelOptionTopLine}>
                      <View
                        style={[
                          styles.providerDot,
                          { backgroundColor: PROVIDER_COLORS[model.provider] || theme.textSecondary },
                        ]}
                      />
                      <Text style={[styles.modelOptionName, { color: theme.text }]}>{model.name}</Text>
                    </View>
                    <Text style={[styles.modelOptionDescription, { color: theme.textSecondary }]}>
                      {model.description || 'General purpose model'}
                    </Text>
                    <View style={styles.capabilityRow}>
                      {capabilityTags(model).map((tag) => (
                        <View key={`${model.id}-${tag}`} style={[styles.capabilityTag, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                          <Text style={[styles.capabilityTagText, { color: theme.textSecondary }]}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  {selectedModel?.id === model.id ? <Feather name="check" size={16} color={theme.text} /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
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
  ambientGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 999,
    opacity: 0.18,
  },
  ambientGlowLeft: {
    top: -60,
    left: -90,
  },
  ambientGlowRight: {
    top: 120,
    right: -100,
  },
  screenPadding: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 3,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  headerProject: {
    fontSize: fontSize.sm,
  },
  topCard: {
    gap: spacing.md,
  },
  topCardCopy: {
    gap: 6,
  },
  topCardTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  topCardDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  topCardControls: {
    gap: spacing.sm,
  },
  modeSwitch: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    padding: 4,
    gap: 4,
  },
  modePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
  },
  modePillText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  modelPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  providerDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  modelPillText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    maxWidth: 220,
  },
  flex: {
    flex: 1,
    gap: spacing.lg,
  },
  emptyThread: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyThreadIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyThreadTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  emptyThreadDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  suggestionGrid: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  suggestionCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.md,
  },
  suggestionText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  messageList: {
    paddingVertical: spacing.lg,
  },
  composerWrap: {
    paddingBottom: spacing.sm,
  },
  attachmentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  attachmentText: {
    flex: 1,
    fontSize: fontSize.sm,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#EF4444',
  },
  statusText: {
    fontSize: fontSize.sm,
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    minHeight: 112,
    maxHeight: 180,
    fontSize: fontSize.md,
    lineHeight: 24,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  promptRow: {
    gap: spacing.sm,
  },
  promptChip: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  promptChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  overlayScrim: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  modelSheet: {
    width: '100%',
    maxHeight: '70%',
    borderWidth: 1,
    borderRadius: 24,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modelSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  modelSheetTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  modelOption: {
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  modelOptionCopy: {
    flex: 1,
    gap: 8,
  },
  modelOptionTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modelOptionName: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  modelOptionDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  capabilityTag: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  capabilityTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
})
