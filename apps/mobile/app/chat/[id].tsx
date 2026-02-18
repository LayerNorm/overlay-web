import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  NativeSyntheticEvent,
  TextInputSelectionChangeEventData
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../../hooks/useTheme'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { spacing, fontSize } from '../../constants/theme'
import {
  Chat,
  Message,
  ChatModel,
  PROVIDER_COLORS,
  generateMessageId,
  generateTempTitle
} from '../../services/chatTypes'
import { loadChat, saveChat, createNewChat } from '../../services/chatStorage'
import { chatStream, getAvailableModels } from '../../services/aiService'
import { MessageBubble } from '../../components/chat/MessageBubble'
import { DictationAccessoryStrip } from '../../components/voice/DictationAccessoryStrip'
import {
  TextSelectionRange,
  deleteBackwardAtSelection,
  formatTranscriptForInsertion,
  insertTextAtSelection
} from '../../services/textInputEditing'

const CHAT_VOICE_ACCESSORY_ID = 'chat-voice-accessory'
const USES_ACCESSORY_STRIP = Platform.OS === 'ios'

export default function ChatConversationScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { theme, isDark } = useTheme()

  const [, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null)
  const [availableModels, setAvailableModels] = useState<ChatModel[]>([])
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [imageBase64, setImageBase64] = useState<string | null>(null)

  const flatListRef = useRef<FlatList>(null)
  const messageInputRef = useRef<TextInput>(null)
  const chatRef = useRef<Chat | null>(null)
  const abortRef = useRef(false)
  const inputValueRef = useRef('')
  const inputSelectionRef = useRef<TextSelectionRange>({ start: 0, end: 0 })

  const {
    isRecording,
    isProcessing: isTranscribing,
    error: voiceError,
    startRecording,
    stopRecording,
    toggleRecording
  } = useVoiceInput()

  useEffect(() => {
    inputValueRef.current = inputValue
  }, [inputValue])

  const syncInputSelection = useCallback((cursor: number) => {
    inputSelectionRef.current = { start: cursor, end: cursor }
    requestAnimationFrame(() => {
      messageInputRef.current?.setNativeProps({
        selection: { start: cursor, end: cursor }
      })
    })
  }, [])

  const applyInputEdit = useCallback((nextText: string, cursor: number) => {
    inputValueRef.current = nextText
    setInputValue(nextText)
    syncInputSelection(cursor)
  }, [syncInputSelection])

  const insertTextInComposer = useCallback((text: string) => {
    const edit = insertTextAtSelection(
      inputValueRef.current,
      inputSelectionRef.current,
      text
    )
    applyInputEdit(edit.nextText, edit.nextSelection.start)
  }, [applyInputEdit])

  const deleteBackwardInComposer = useCallback(() => {
    const edit = deleteBackwardAtSelection(inputValueRef.current, inputSelectionRef.current)
    applyInputEdit(edit.nextText, edit.nextSelection.start)
  }, [applyInputEdit])

  const insertTranscript = useCallback((transcript: string) => {
    const selection = inputSelectionRef.current
    const current = inputValueRef.current
    const formatted = formatTranscriptForInsertion(transcript, current.slice(selection.end))
    if (!formatted) {
      return
    }

    const edit = insertTextAtSelection(current, selection, formatted)
    applyInputEdit(edit.nextText, edit.nextSelection.start)
  }, [applyInputEdit])

  const handleMicTap = useCallback(async () => {
    const result = await toggleRecording()
    if (result?.text) {
      insertTranscript(result.text)
    }
  }, [insertTranscript, toggleRecording])

  const handleMicHoldStart = useCallback(async () => {
    if (isTranscribing || isRecording) {
      return
    }
    await startRecording()
  }, [isRecording, isTranscribing, startRecording])

  const handleMicHoldEnd = useCallback(async () => {
    if (isTranscribing) {
      return
    }
    const result = await stopRecording()
    if (result?.text) {
      insertTranscript(result.text)
    }
  }, [insertTranscript, isTranscribing, stopRecording])

  const handleComposerSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      inputSelectionRef.current = event.nativeEvent.selection
    },
    []
  )

  const handleComposerTextChange = useCallback((text: string) => {
    inputValueRef.current = text
    setInputValue(text)
  }, [])

  useEffect(() => {
    async function init(): Promise<void> {
      const models = await getAvailableModels()
      setAvailableModels(models)
      if (models.length > 0) {
        setSelectedModel(models[0])
      }

      let loadedChat: Chat | null = null
      if (id === 'new') {
        loadedChat = await createNewChat(models[0]?.id)
      } else {
        loadedChat = await loadChat(id)
      }

      if (loadedChat) {
        setChat(loadedChat)
        chatRef.current = loadedChat
        setMessages(loadedChat.messages)
        if (loadedChat.modelId) {
          const m = models.find((model) => model.id === loadedChat.modelId)
          if (m) setSelectedModel(m)
        }
      }
      setIsLoading(false)
    }
    init()
  }, [id])

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true })
    }, 100)
  }, [])

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() && !imageBase64) return
    if (!selectedModel || !chatRef.current) return
    if (isSending) return

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setIsSending(true)
    abortRef.current = false

    const userMessage: Message = {
      id: generateMessageId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: Date.now(),
      imageData: imageBase64 || undefined
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInputValue('')
    inputValueRef.current = ''
    inputSelectionRef.current = { start: 0, end: 0 }
    setImageBase64(null)
    scrollToBottom()

    // Update title from first message
    if (chatRef.current.title === 'New Chat' && updatedMessages.length === 1) {
      chatRef.current.title = generateTempTitle(userMessage.content)
      setChat({ ...chatRef.current })
    }

    // Create placeholder assistant message
    const assistantMsgId = generateMessageId()
    const assistantMessage: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      selectedModelId: selectedModel.id,
      responses: [{
        modelId: selectedModel.id,
        modelName: selectedModel.name,
        provider: selectedModel.provider,
        content: '',
        isLoading: true
      }]
    }

    const withAssistant = [...updatedMessages, assistantMessage]
    setMessages(withAssistant)
    scrollToBottom()

    // Build conversation history for API
    const apiMessages = updatedMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      imageData: m.imageData
    }))

    let fullContent = ''
    try {
      const stream = chatStream(selectedModel.id, apiMessages)
      for await (const chunk of stream) {
        if (abortRef.current) break

        if (chunk.type === 'text') {
          fullContent += chunk.content
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: fullContent,
                    responses: [{
                      modelId: selectedModel.id,
                      modelName: selectedModel.name,
                      provider: selectedModel.provider,
                      content: fullContent,
                      isLoading: true
                    }]
                  }
                : m
            )
          )
          scrollToBottom()
        } else if (chunk.type === 'error') {
          fullContent = `Error: ${chunk.content}`
        }
      }
    } catch (error) {
      fullContent = `Error: ${String(error)}`
    }

    // Finalize message
    const finalMessages = withAssistant.map((m) =>
      m.id === assistantMsgId
        ? {
            ...m,
            content: fullContent,
            responses: [{
              modelId: selectedModel.id,
              modelName: selectedModel.name,
              provider: selectedModel.provider,
              content: fullContent,
              isLoading: false
            }]
          }
        : m
    )
    setMessages(finalMessages)

    // Save chat
    const chatToSave: Chat = {
      ...chatRef.current!,
      messages: finalMessages,
      updatedAt: Date.now(),
      modelId: selectedModel.id
    }
    chatRef.current = chatToSave
    setChat(chatToSave)
    await saveChat(chatToSave)

    setIsSending(false)
    scrollToBottom()
  }, [inputValue, imageBase64, selectedModel, messages, isSending, scrollToBottom])

  const handleCopy = useCallback(async (content: string) => {
    await Clipboard.setStringAsync(content)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }, [])

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    const filtered = messages.filter((m) => m.id !== messageId)
    setMessages(filtered)
    if (chatRef.current) {
      chatRef.current.messages = filtered
      chatRef.current.updatedAt = Date.now()
      await saveChat(chatRef.current)
    }
  }, [messages])

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7
    })

    if (!result.canceled && result.assets[0].base64) {
      const mimeType = result.assets[0].mimeType || 'image/jpeg'
      setImageBase64(`data:${mimeType};base64,${result.assets[0].base64}`)
    }
  }, [])

  const handleGoBack = useCallback(() => {
    abortRef.current = true
    router.back()
  }, [router])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={handleGoBack} style={styles.backButton} activeOpacity={0.7}>
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.modelButton}
          onPress={() => setShowModelPicker(true)}
          activeOpacity={0.7}
        >
          {selectedModel && (
            <View style={styles.modelButtonContent}>
              <View
                style={[
                  styles.providerDot,
                  { backgroundColor: PROVIDER_COLORS[selectedModel.provider] || theme.textSecondary }
                ]}
              />
              <Text style={[styles.modelName, { color: theme.text }]} numberOfLines={1}>
                {selectedModel.name}
              </Text>
              <Feather name="chevron-down" size={14} color={theme.textSecondary} />
            </View>
          )}
          {!selectedModel && (
            <Text style={[styles.modelName, { color: theme.textSecondary }]}>No models</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.headerAction} activeOpacity={0.7}>
          <Feather name="more-horizontal" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="message-square" size={40} color={theme.textDisabled} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              Start a conversation
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
                onCopy={handleCopy}
                onDelete={handleDeleteMessage}
              />
            )}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToBottom}
          />
        )}

        {/* Input */}
        <View style={[styles.inputContainer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
          {!USES_ACCESSORY_STRIP && isRecording && (
            <View style={[styles.recordingBar, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording... tap mic to stop</Text>
            </View>
          )}
          {!USES_ACCESSORY_STRIP && isTranscribing && (
            <View style={[styles.recordingBar, { backgroundColor: theme.surface }]}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
              <Text style={[styles.recordingText, { color: theme.textSecondary }]}>Transcribing...</Text>
            </View>
          )}
          {imageBase64 && (
            <View style={[styles.imagePreview, { backgroundColor: theme.surface }]}>
              <Feather name="image" size={14} color={theme.textSecondary} />
              <Text style={[styles.imagePreviewText, { color: theme.textSecondary }]}>
                Image attached
              </Text>
              <TouchableOpacity onPress={() => setImageBase64(null)}>
                <Feather name="x" size={14} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.inputRow}>
            <TouchableOpacity
              onPress={handlePickImage}
              style={styles.attachButton}
              activeOpacity={0.7}
            >
              <Feather name="image" size={20} color={theme.textSecondary} />
            </TouchableOpacity>

            {!USES_ACCESSORY_STRIP && (
              <TouchableOpacity
                onPress={handleMicTap}
                disabled={isTranscribing}
                style={[
                  styles.micButton,
                  {
                    backgroundColor: isRecording
                      ? '#EF4444'
                      : theme.buttonBg
                  }
                ]}
                activeOpacity={0.7}
              >
                {isTranscribing ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : (
                  <Feather
                    name={isRecording ? 'square' : 'mic'}
                    size={isRecording ? 14 : 18}
                    color={isRecording ? '#FFFFFF' : theme.toggleThumb}
                  />
                )}
              </TouchableOpacity>
            )}

            <TextInput
              ref={messageInputRef}
              style={[styles.textInput, { color: theme.text, backgroundColor: theme.surface }]}
              placeholder="Type a message..."
              placeholderTextColor={theme.textDisabled}
              value={inputValue}
              onChangeText={handleComposerTextChange}
              onSelectionChange={handleComposerSelectionChange}
              inputAccessoryViewID={USES_ACCESSORY_STRIP ? CHAT_VOICE_ACCESSORY_ID : undefined}
              multiline
              maxLength={10000}
              returnKeyType="default"
            />

            <TouchableOpacity
              onPress={handleSend}
              disabled={(!inputValue.trim() && !imageBase64) || isSending}
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    inputValue.trim() || imageBase64 ? theme.buttonBg : theme.surface
                }
              ]}
              activeOpacity={0.7}
            >
              <Feather
                name="arrow-up"
                size={18}
                color={inputValue.trim() || imageBase64 ? '#FFFFFF' : theme.textDisabled}
              />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <DictationAccessoryStrip
        accessoryID={CHAT_VOICE_ACCESSORY_ID}
        theme={theme}
        isRecording={isRecording}
        isProcessing={isTranscribing}
        error={voiceError}
        onMicTap={handleMicTap}
        onMicHoldStart={handleMicHoldStart}
        onMicHoldEnd={handleMicHoldEnd}
        onInsertText={insertTextInComposer}
        onDeleteBackward={deleteBackwardInComposer}
        onReturn={() => insertTextInComposer('\n')}
      />

      {/* Model Picker Overlay — header stays visible, chat blurred beneath */}
      {showModelPicker && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Blur layer behind header — covers only the messages/input area */}
          <TouchableOpacity
            style={[
              styles.blurOverlay,
              { backgroundColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)' }
            ]}
            activeOpacity={1}
            onPress={() => setShowModelPicker(false)}
          />

          {/* Model selector panel — positioned below header */}
          <View style={[styles.modelPanel, { backgroundColor: theme.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Select Model</Text>
              <TouchableOpacity onPress={() => setShowModelPicker(false)}>
                <Feather name="x" size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll}>
              {availableModels.length === 0 && (
                <View style={styles.noModels}>
                  <Text style={[styles.noModelsText, { color: theme.textSecondary }]}>
                    No API keys configured. Add them in Settings.
                  </Text>
                </View>
              )}
              {(['groq', 'google', 'openai', 'anthropic', 'xai'] as const).map((provider) => {
                const providerModels = availableModels.filter((m) => m.provider === provider)
                if (providerModels.length === 0) return null
                return (
                  <View key={provider}>
                    <View style={styles.providerHeader}>
                      <View
                        style={[
                          styles.providerDotLarge,
                          { backgroundColor: PROVIDER_COLORS[provider] }
                        ]}
                      />
                      <Text style={[styles.providerName, { color: theme.textSecondary }]}>
                        {provider.charAt(0).toUpperCase() + provider.slice(1)}
                      </Text>
                    </View>
                    {providerModels.map((model) => (
                      <TouchableOpacity
                        key={model.id}
                        style={[
                          styles.modelOption,
                          selectedModel?.id === model.id && { backgroundColor: theme.surface }
                        ]}
                        onPress={() => {
                          setSelectedModel(model)
                          setShowModelPicker(false)
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.modelOptionContent}>
                          <Text style={[styles.modelOptionName, { color: theme.text }]}>
                            {model.name}
                          </Text>
                          {model.description && (
                            <Text
                              style={[styles.modelOptionDesc, { color: theme.textSecondary }]}
                            >
                              {model.description}
                            </Text>
                          )}
                        </View>
                        {selectedModel?.id === model.id && (
                          <Feather name="check" size={16} color={theme.buttonBg} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )
              })}
            </ScrollView>
          </View>
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  flex: {
    flex: 1
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1
  },
  backButton: {
    padding: spacing.sm
  },
  modelButton: {
    flex: 1,
    alignItems: 'center'
  },
  modelButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16
  },
  providerDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  modelName: {
    fontSize: fontSize.sm,
    fontWeight: '500'
  },
  headerAction: {
    padding: spacing.sm
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  emptyText: {
    fontSize: fontSize.md
  },
  messagesList: {
    paddingVertical: spacing.md
  },
  inputContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1
  },
  imagePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8
  },
  imagePreviewText: {
    flex: 1,
    fontSize: fontSize.xs
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8
  },
  attachButton: {
    padding: 8,
    justifyContent: 'center'
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  textInput: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: fontSize.md,
    maxHeight: 120,
    minHeight: 40
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden'
  },
  modelPanel: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    maxHeight: '60%',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600'
  },
  modalScroll: {
    paddingBottom: 40
  },
  noModels: {
    padding: spacing.xl,
    alignItems: 'center'
  },
  noModelsText: {
    fontSize: fontSize.md,
    textAlign: 'center'
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  },
  providerDotLarge: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  providerName: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md
  },
  modelOptionContent: {
    flex: 1,
    gap: 2
  },
  modelOptionName: {
    fontSize: fontSize.md,
    fontWeight: '500'
  },
  modelOptionDesc: {
    fontSize: fontSize.xs
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444'
  },
  recordingText: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: '#EF4444'
  }
})
