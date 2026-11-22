import { useHeaderHeight } from '@react-navigation/elements'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { hapticImpact } from '../../lib/haptics'
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
import { NativePersonalChatTranscript, type NativeTranscriptScope, type NativeTranscriptScrollIntent, type TrustedReplyTarget } from './NativePersonalChatTranscript'
import { toNativeChatTranscriptView, type NativeChatTranscriptRuntime } from '../../lib/toNativeChatTranscriptView'
import { Composer, type ComposerReplyContext, type PendingDocument } from './Composer'
import { ChatActionsSheet } from './ChatActionsSheet'
import { createSkill } from '../../services/integrationsService'
import type { AssistantVisualBlock, DraftModalState } from '@overlay/chat-core'
import { DrawerSidebar } from './DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import { useDrawer } from '../../contexts/DrawerContext'
import { FloatingSearchBar } from '../ui/FloatingSearchBar'
import { ListRow, Section } from '../ui/primitives'
import { useAppSession } from '../../contexts/AppSessionContext'
import { UpgradePrompt } from '../auth/UpgradePrompt'
import { useAuth } from '../../contexts/AuthContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import * as DocumentPicker from 'expo-document-picker'

function partialPartsFromBlocks(blocks: readonly AssistantVisualBlock[] | undefined, content: string): Array<Record<string, unknown>> {
  const parts = (blocks ?? []).flatMap((block): Array<Record<string, unknown>> => {
    switch (block.kind) {
      case 'text': return [{ type: 'text', text: block.text, storageOmittedParts: 0 }]
      case 'reasoning': return [{ type: 'reasoning', text: block.text }]
      case 'tool': return [{ type: 'tool-invocation', id: block.key, toolInvocation: {
        toolCallId: block.key, toolName: block.name, state: block.state,
        toolInput: block.toolInput, toolOutput: block.toolOutput,
      } }]
      case 'file': return [{ type: 'file', url: block.url, ...(block.mediaType ? { mediaType: block.mediaType } : {}) }]
      case 'source': return [{
        type: 'source', id: block.sourceId, text: block.title ?? block.sourceId,
        ...(block.url ? { url: block.url } : {}),
        ...(block.mediaType ? { mediaType: block.mediaType } : {}),
        ...(block.filename ? { fileName: block.filename } : {}),
      }]
      case 'generated-ui': return [{ ...block.part }]
    }
  })
  if (content && !parts.some(part => part.type === 'text')) parts.unshift({ type: 'text', text: content, storageOmittedParts: 0 })
  return parts
}

export function buildStopPartialPayload(message: Message | undefined, modelId?: string) {
  const response = modelId ? message?.responses?.findLast(candidate => candidate.modelId === modelId) : undefined
  const content = response ? response.content : message?.content ?? ''
  const blocks = response ? response.blocks : message?.blocks
  const parts = partialPartsFromBlocks(blocks, content)
  return {
    ...(content ? { partialContent: content } : {}),
    ...(parts.length ? { partialParts: parts } : {}),
  }
}


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
  if (chunk.type === 'error') chunk = { ...chunk, content: 'This response could not be completed.' }
  return messages.map((message) => {
    if (message.id !== assistantId) return message
    const response = message.responses?.[0] || {
      modelId: selectedModel.id,
      modelName: selectedModel.name,
      provider: selectedModel.provider,
      content: '',
      isLoading: true,
    }
    const blocks = chunk.type === 'error'
      ? (response.blocks ?? message.blocks ?? [])
      : appendPersonalBlock(response.blocks ?? message.blocks ?? [], chunk)
    message = { ...message, blocks, responses: [{ ...response, blocks }] }

    if (chunk.type === 'text') {
      const content = `${message.content}${chunk.content}`
      return {
        ...message,
        content,
        responses: [
          {
            ...response,
            blocks,
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
      const content = message.content || ''
      return {
        ...message,
        content,
        isStreaming: false,
        status: 'error',
        responses: [
          {
            ...response,
            blocks,
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
        isStreaming: false,
        status: 'completed',
        responses: [
          {
            ...response,
            blocks,
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

function userSafeTransportError(_error: unknown, fallback: string): string {
  return fallback
}

function conversationStopLockKey(workspaceId: string | null, conversationId: string): string {
  return JSON.stringify([workspaceId, conversationId])
}

type OwnedDraftPromotion = {
  workspaceId: string | null
  sourceRouteKind: 'detail'
  sourceRouteId: string
  clientId: string
  conversationId: string
}

function ownedPromotionMatchesChat(promotion: OwnedDraftPromotion, chat: Chat | null): boolean {
  if (!chat || chat.id !== promotion.conversationId) return false
  return typeof chat.clientId !== 'string' || chat.clientId === promotion.clientId
}

let lastOpenedWriteQueue: Promise<void> = Promise.resolve()
export function ChatScreen(props: { conversationId?: string; newChatIntent?: string; routeKind: 'tab' | 'detail' }): React.ReactElement {
  const { activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  return <ChatScreenOwner key={`${user?.id ?? 'signed-out'}:${activeWorkspaceId ?? 'no-workspace'}`} {...props} />
}

function ChatScreenOwner({
  conversationId,
  newChatIntent,
  routeKind,
}: {
  conversationId?: string
  newChatIntent?: string
  routeKind: 'tab' | 'detail'
}): React.ReactElement {
  const router = useRouter()
  const navigation = useNavigation<{ setParams: (params: { id?: string; newChatIntent?: string | undefined }) => void }>()
  const { theme, isDark } = useTheme()
  const { openDrawer, drawerVisible } = useDrawer()
  const { entitlements, chatModels, imageModels, videoModels, uiSettings, capabilities } = useAppSession()
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth()
  const { favoriteIds, toggleFavorite } = useFavoriteModels(user?.id)
  const [autoSelected, setAutoSelected] = useState(true)
  const nativeReady = useNativeDataReady()
  const { activeWorkspaceId } = useWorkspace()
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()
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
  const currentRun = execution?.workspaceId === activeWorkspaceId && execution.run?.conversationId === activeChatId &&
    (routeKind !== 'detail' || conversationId === activeChatId) ? execution.run : null
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
  const [actionsChat, setActionsChat] = useState<ChatMeta | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [showingCachedCopy, setShowingCachedCopy] = useState(false)

  const chatRef = useRef<Chat | null>(null)
  const textInputRef = useRef<TextInput>(null)
  const abortRef = useRef(false)
  const sendLockTurnIdRef = useRef<string | null>(null)
  const activeDataSendRef = useRef<{ turnId: string; workspaceId: string; conversationId: string; modelId: string; cancel: () => void } | null>(null)
  const sendLockOwnerRef = useRef<{ turnId: string; workspaceId: string; conversationId: string; modelId: string; cancel: () => void } | null>(null)
  const conversationStopLocksRef = useRef(new Map<string, number>())
  const stopLockSequenceRef = useRef(0)
  const composerRevisionRef = useRef(0)
  const approvalFlightRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const ownerEpochRef = useRef(0)
  const dataEpochRef = useRef(0)
  const focusEpochRef = useRef(0)
  const isFocusedRef = useRef(false)
  const operationControllersRef = useRef(new Map<string, { controller: AbortController; interactive: boolean }>() )
  const committedWorkspaceRef = useRef(activeWorkspaceId)
  const committedSessionRef = useRef({ userId: user?.id ?? null, workspaceId: activeWorkspaceId, ready: nativeReady })
  const routeIdentityRef = useRef({ workspaceId: activeWorkspaceId, routeKind, conversationId })
  const committedMessagesRef = useRef(messages)
  const committedAuthorityRef = useRef(false)
  const nativeDraftSaveRef = useRef<((state: DraftModalState, scope: NativeTranscriptScope) => Promise<void>) | null>(null)
  const initializedRouteKeyRef = useRef<string | null>(null)
  const completedRouteKeyRef = useRef<string | null>(null)
  const readinessResumeRouteRef = useRef<string | null>(null)
  const ownedDraftPromotionRef = useRef<OwnedDraftPromotion | null>(null)
  const invalidateOperations = useCallback((interactiveOnly = false) => {
    for (const [name, operation] of operationControllersRef.current) {
      if (!interactiveOnly || operation.interactive) {
        operation.controller.abort()
        operationControllersRef.current.delete(name)
      }
    }
  }, [])
  const clearConversationScope = useCallback(() => {
    abortRef.current = true
    pendingTurn.current = null
    hasAutoScrolledRef.current = false
    chatRef.current = null
    setActiveChatId(null)
    setMessages([])
    setChatTitle('New chat')
    setShowingCachedCopy(false)
    setIsSending(false)
    sendLockTurnIdRef.current = null
    activeDataSendRef.current = null
    sendLockOwnerRef.current = null
    approvalFlightRef.current = null
    setApprovalSubmitting(false)
    setInputValue('')
    setImageBase64(null)
    setPendingDocuments([])
    setMentions([])
    setReplyContext(null)
    setAttachmentError(null)
    setExecution(null)
    setGenerationKind(null)
  }, [])
  const beginOperation = useCallback((name: string, chatId: string | null = chatRef.current?.id ?? null, interactive = true) => {
    operationControllersRef.current.get(name)?.controller.abort()
    const controller = new AbortController()
    const operationRecord = { controller, interactive }
    operationControllersRef.current.set(name, operationRecord)
    const ownerEpoch = ownerEpochRef.current
    const dataEpoch = dataEpochRef.current
    const focusEpoch = focusEpochRef.current
    let finished = false
    const workspaceId = committedWorkspaceRef.current
    const allowedChatIds = new Set(chatId ? [chatId] : [])
    const isCurrent = () => !finished && mountedRef.current && !controller.signal.aborted && ownerEpochRef.current === ownerEpoch &&
      dataEpochRef.current === dataEpoch && committedWorkspaceRef.current === workspaceId &&
      Boolean(workspaceId) && committedSessionRef.current.ready &&
      committedSessionRef.current.userId === (user?.id ?? null) &&
      committedSessionRef.current.workspaceId === workspaceId && getRequestWorkspaceId() === workspaceId &&
      (!interactive || (isFocusedRef.current && focusEpochRef.current === focusEpoch)) &&
      (!chatId || allowedChatIds.has(chatRef.current?.id ?? ''))
    return {
      workspaceId,
      signal: controller.signal,
      isCurrent,
      adoptConversation: (id: string) => allowedChatIds.add(id),
      finish: () => {
        finished = true
        if (operationControllersRef.current.get(name) === operationRecord) operationControllersRef.current.delete(name)
      },
      cancel: () => {
        finished = true
        controller.abort()
        if (operationControllersRef.current.get(name) === operationRecord) operationControllersRef.current.delete(name)
      },
    }
  }, [user?.id])
  const chatActionsOperationRef = useRef<ReturnType<typeof beginOperation> | null>(null)
  const persistLastOpenedChat = useCallback((chatId: string, workspaceId: string) => {
    const ownerEpoch = ownerEpochRef.current
    const dataEpoch = dataEpochRef.current
    const focusEpoch = focusEpochRef.current
    const write = lastOpenedWriteQueue.catch(() => {}).then(async () => {
      const promotion = ownedDraftPromotionRef.current
      const route = routeIdentityRef.current
      const routeOwnsChat = route.routeKind === 'tab' || route.conversationId === chatId || (
        promotion?.workspaceId === workspaceId &&
        promotion.sourceRouteKind === route.routeKind &&
        promotion.sourceRouteId === route.conversationId &&
        promotion.conversationId === chatId &&
        ownedPromotionMatchesChat(promotion, chatRef.current)
      )
      if (!mountedRef.current || ownerEpochRef.current !== ownerEpoch || dataEpochRef.current !== dataEpoch ||
        focusEpochRef.current !== focusEpoch || !isFocusedRef.current || committedWorkspaceRef.current !== workspaceId ||
        getRequestWorkspaceId() !== workspaceId || chatRef.current?.id !== chatId || !routeOwnsChat) return
      await setLastOpenedChatId(chatId, workspaceId).catch(() => {})
    })
    lastOpenedWriteQueue = write
  }, [])
  useLayoutEffect(() => {
    const previous = routeIdentityRef.current
    const previousSession = committedSessionRef.current
    const promotion = ownedDraftPromotionRef.current
    const ownDraftPromotion = promotion?.workspaceId === activeWorkspaceId &&
      promotion.sourceRouteKind === previous.routeKind && promotion.sourceRouteId === previous.conversationId &&
      promotion.sourceRouteKind === routeKind && promotion.conversationId === conversationId &&
      ownedPromotionMatchesChat(promotion, chatRef.current)
    const scopeChanged = previous.workspaceId !== activeWorkspaceId || previous.routeKind !== routeKind ||
      (previous.conversationId !== conversationId && !ownDraftPromotion)
    committedWorkspaceRef.current = activeWorkspaceId
    committedSessionRef.current = { userId: user?.id ?? null, workspaceId: activeWorkspaceId, ready: nativeReady }
    routeIdentityRef.current = { workspaceId: activeWorkspaceId, routeKind, conversationId }
    const sessionChanged = previousSession.userId !== (user?.id ?? null) ||
      previousSession.workspaceId !== activeWorkspaceId || (previousSession.ready && !nativeReady)
    const readinessLost = previousSession.ready && !nativeReady && !scopeChanged &&
      previousSession.userId === (user?.id ?? null)
    if (readinessLost) {
      readinessResumeRouteRef.current = [previous.workspaceId, previous.routeKind, previous.conversationId ?? 'tab-root'].join(':')
    } else if (scopeChanged || sessionChanged) {
      readinessResumeRouteRef.current = null
    }
    if (scopeChanged || sessionChanged) {
      if (!ownDraftPromotion || sessionChanged) {
        initializedRouteKeyRef.current = null
        completedRouteKeyRef.current = null
        ownedDraftPromotionRef.current = null
      }
      dataEpochRef.current += 1
      invalidateOperations()
      if (readinessLost) {
        abortRef.current = true
        pendingTurn.current = null
        hasAutoScrolledRef.current = false
        chatRef.current = null
        setActiveChatId(null)
        setMessages([])
        setExecution(null)
        setIsSending(false)
        sendLockTurnIdRef.current = null
        activeDataSendRef.current = null
        sendLockOwnerRef.current = null
        approvalFlightRef.current = null
        setApprovalSubmitting(false)
        setPendingDocuments(current => current.filter(document => document.status !== 'uploading'))
        setAttachmentError(null)
      } else {
        clearConversationScope()
      }
      setModelPickerVisible(false)
      setActionsChat(null)
      setOptionsOpen(false)
      setIsLoading(true)
    }
  }, [activeWorkspaceId, clearConversationScope, conversationId, invalidateOperations, nativeReady, routeKind, user?.id])
  useLayoutEffect(() => {
    committedMessagesRef.current = messages
  }, [messages])
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      ownerEpochRef.current += 1
      invalidateOperations()
    }
  }, [invalidateOperations])
  useFocusEffect(useCallback(() => {
    isFocusedRef.current = true
    focusEpochRef.current += 1
    const activeChat = chatRef.current
    const workspaceId = committedWorkspaceRef.current
    if (activeChat && workspaceId && !activeChat.id.startsWith('chat-')) {
      persistLastOpenedChat(activeChat.id, workspaceId)
    }
    return () => {
      isFocusedRef.current = false
      focusEpochRef.current += 1
      invalidateOperations(true)
      setModelPickerVisible(false)
      setActionsChat(null)
      setOptionsOpen(false)
      setApprovalSubmitting(false)
      approvalFlightRef.current = null
      setPendingDocuments(current => current.filter(document => document.status !== 'uploading'))
    }
  }, [invalidateOperations, persistLastOpenedChat]))
  const pendingTurn = useRef<{ conversationId: string; signature: string; turnId: string; userMessageId?: string } | null>(null)
  const presetRetryRef = useRef<{ signature: string; turnId: string; userMessageId: string } | null>(null)
  const hasAutoScrolledRef = useRef(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [transcriptScrollIntent, setTranscriptScrollIntent] = useState<NativeTranscriptScrollIntent | null>(null)
  const transcriptIntentId = useRef(0)
  const requestTranscriptEnd = useCallback((kind: 'initial-end' | 'submission' = 'submission') => {
    transcriptIntentId.current += 1
    if (kind === 'submission') hasAutoScrolledRef.current = true
    setTranscriptScrollIntent({ id: `chat-scroll-${transcriptIntentId.current}`, kind })
  }, [])
  const runtimeTurnId = currentRun?.turnId
  const runtimeStatus = currentRun?.status
  const runtimeError = runtimeStatus === 'failed' ? 'This response could not be completed.' : undefined
  const transcriptRuntime = useMemo(() => {
    if (runtimeTurnId && runtimeStatus) {
      const status: NativeChatTranscriptRuntime['status'] = runtimeStatus === 'queued' ? 'submitted'
        : runtimeStatus === 'running' || runtimeStatus.startsWith('waiting_for_') ? 'streaming'
          : runtimeStatus === 'completed' ? 'completed'
            : runtimeStatus === 'failed' ? 'failed' : 'cancelled'
      return {
        activeTurnId: runtimeTurnId,
        status,
        interrupted: runtimeStatus === 'cancelled',
        ...(runtimeError ? { error: runtimeError } : {}),
      }
    }
    const activeMessage = [...messages].reverse().find((message) => message.responses?.some((response) => response.isLoading))
    return activeMessage?.turnId ? { activeTurnId: activeMessage.turnId, status: 'streaming' as const } : undefined
  }, [messages, runtimeError, runtimeStatus, runtimeTurnId])
  const transcriptView = useMemo(() => toNativeChatTranscriptView(messages, transcriptRuntime), [messages, transcriptRuntime])
  const referencedModelKey = useMemo(() => [...new Set(transcriptView.exchanges.flatMap((exchange) => [
    exchange.selectedModelId,
    ...exchange.responses.map((response) => response.modelId),
    ...(exchange.media?.results.map(result => result.modelUsed) ?? []),
  ].filter((id): id is string => Boolean(id))))].sort().join('\u0000'), [transcriptView])
  const publicModelLabels = useMemo(() => {
    const referencedIds = new Set(referencedModelKey ? referencedModelKey.split('\u0000') : [])
    const modelCatalog = [...availableModels, ...imageModels, ...videoModels]
    const uniqueModels = [...new Map(modelCatalog.map(model => [model.id, model])).values()]
    return uniqueModels.filter((model) => referencedIds.has(model.id)).slice(0, 100).flatMap((model) => {
      const id = model.id.slice(0, 128)
      const name = model.name.slice(0, 128)
      return id && name ? [{ id, name }] : []
    })
  }, [availableModels, imageModels, referencedModelKey, videoModels])
  const ownedPromotion = ownedDraftPromotionRef.current
  const routeMatchesCurrentChat = routeKind !== 'detail' || conversationId === activeChatId ||
    (conversationId === 'new' && Boolean(activeChatId?.startsWith('chat-') && chatRef.current?.id === activeChatId)) ||
    Boolean(
      ownedPromotion?.workspaceId === activeWorkspaceId &&
      ownedPromotion.sourceRouteKind === routeKind &&
      ownedPromotion.sourceRouteId === conversationId &&
      ownedPromotion.conversationId === activeChatId &&
      ownedPromotionMatchesChat(ownedPromotion, chatRef.current),
    )
  const transcriptAuthorityActive = Boolean(
    nativeReady && activeWorkspaceId && getRequestWorkspaceId() === activeWorkspaceId && activeChatId && routeMatchesCurrentChat,
  )
  useLayoutEffect(() => {
    committedAuthorityRef.current = transcriptAuthorityActive
  }, [transcriptAuthorityActive])
  const isTranscriptScopeCurrent = useCallback((scope: NativeTranscriptScope) =>
    scope.isCurrent() && committedAuthorityRef.current && scope.workspaceId === committedWorkspaceRef.current &&
    scope.conversationId === chatRef.current?.id && getRequestWorkspaceId() === committedWorkspaceRef.current,
  [])
  const handleTranscriptReply = useCallback((target: TrustedReplyTarget, scope: NativeTranscriptScope) => {
    if (!isTranscriptScopeCurrent(scope)) return
    const currentMessages = committedMessagesRef.current
    let text: string | undefined
    if (target.target.kind === 'user') {
      const userId = target.target.userId
      text = currentMessages.find((message) => message.id === userId)?.content
    } else if (target.target.kind === 'response') {
      const currentExchange = toNativeChatTranscriptView(currentMessages).exchanges
        .find((exchange) => exchange.turnId === target.exchange.turnId)
      const responseId = target.target.responseId
      const currentResponse = currentExchange?.responses.find((response) => response.id === responseId)
      text = currentResponse?.blocks.map((block) => block.kind === 'text' ? block.text : '').join('')
    } else {
      const turnId = target.exchange.turnId
      text = currentMessages.find((message) => message.role === 'user' && message.turnId === turnId)?.content
    }
    if (!text?.trim() || !isTranscriptScopeCurrent(scope)) return
    const replyText = target.target.kind === 'media' ? text : text.trim()
    composerRevisionRef.current += 1
    setReplyContext({
      snippet: target.target.kind === 'media' ? replyText.slice(0, 120) : (replyText.length > 160 ? `${replyText.slice(0, 160)}…` : replyText),
      bodyForModel: target.target.kind === 'media' && target.mediaResult
        ? `[Prior ${target.mediaResult.type} generation request]\n${replyText.slice(0, 12000)}`
        : replyText.slice(0, 16000),
      replyToTurnId: target.exchange.turnId,
    })
    textInputRef.current?.focus()
  }, [isTranscriptScopeCurrent])
  const handleTranscriptJump = useCallback((parentExchangeId: string, scope: NativeTranscriptScope) => {
    if (!isTranscriptScopeCurrent(scope)) return
    setSearchQuery('')
    transcriptIntentId.current += 1
    setTranscriptScrollIntent({ id: `chat-reply-${transcriptIntentId.current}`, kind: 'reply', exchangeId: parentExchangeId })
  }, [isTranscriptScopeCurrent])
  const handleNativeSaveDraft = useCallback((state: DraftModalState, scope: NativeTranscriptScope) => {
    const save = nativeDraftSaveRef.current
    if (!save || !isTranscriptScopeCurrent(scope)) return Promise.reject(new Error('This draft is no longer current.'))
    return save(state, scope)
  }, [isTranscriptScopeCurrent])

  const composerFooterInset = getComposerBottomInset(
    keyboardVisible,
    insets.bottom,
    spacing.md,
    spacing.sm,
    // KAV overrides the container paddingBottom; preserve the closed Android gutter here.
    Platform.OS === 'android' ? spacing.sm : 0,
  )

  const handleOpenDrawer = useCallback(() => {
    textInputRef.current?.blur()
    Keyboard.dismiss()
    openDrawer()
  }, [openDrawer])

  const refreshHistory = useCallback(async () => {
    const operation = beginOperation('history-refresh', null, false)
    try {
      const nextHistory = await loadChatsMeta(operation.workspaceId ?? undefined).catch(() => null)
      if (!operation.isCurrent()) return []
      if (nextHistory) setHistory(nextHistory)
      return nextHistory ?? []
    } finally {
      operation.finish()
    }
  }, [beginOperation])

  const syncConversationMeta = useCallback(
    async (overrides: Partial<Chat> = {}, existingOperation?: ReturnType<typeof beginOperation>) => {
      const currentChat = chatRef.current
      if (!currentChat) return
      const operation = existingOperation ?? beginOperation(`metadata:${currentChat.id}`, currentChat.id)
      if (!operation.isCurrent()) {
        if (!existingOperation) operation.finish()
        return
      }

      const resolvedModelId = overrides.modelId || selectedModel?.id || currentChat.modelId
      const nextChat: Chat = {
        ...currentChat,
        ...overrides,
        title: overrides.title ?? currentChat.title,
        updatedAt: Date.now(),
        modelId: resolvedModelId,
        askModelIds: resolvedModelId ? [resolvedModelId] : currentChat.askModelIds,
        actModelId: resolvedModelId || currentChat.actModelId,
        lastMode: 'act',
      }

      chatRef.current = nextChat
      setChatTitle(nextChat.title)
      try {
        if (nextChat.id.startsWith('chat-') && !nextChat.clientId) return
        await saveChat(nextChat, operation.workspaceId ?? undefined).catch(() => {})
        if (!operation.isCurrent()) return
        await refreshHistory()
      } finally {
        if (!existingOperation) operation.finish()
      }
    },
    [beginOperation, refreshHistory, selectedModel?.id],
  )

  const hydrateConversation = useCallback(
    async (chatId: string, models: ChatModel[], options: { switching?: boolean; preserveComposer?: boolean; operation?: ReturnType<typeof beginOperation> } = {}) => {
      const operation = options.operation ?? beginOperation(`hydrate:${chatId}`, null)
      const ownsOperation = !options.operation
      if (!operation.isCurrent()) {
        if (ownsOperation) operation.finish()
        return false
      }
      if (chatId.startsWith('chat-')) {
        if (operation.isCurrent() && routeKind === 'detail') router.replace('/chat/new')
        if (ownsOperation) operation.finish()
        return false
      }
      if (options.switching) {
        setIsSwitchingChat(true)
      }

      try {
        const chat = await loadChat(chatId, operation.workspaceId ?? undefined)
        if (!operation.isCurrent()) return false
        if (!chat) {
          if (routeKind === 'detail') router.replace('/chat/new')
          return false
        }

        // DMs and channels have their own room surfaces — a shared link or
        // agent-DM route landing on /chat/[id] redirects instead of rendering
        // a multiplayer room as a personal chat.
        if (chat.conversationType === 'dm' || chat.conversationType === 'channel') {
          if (!operation.isCurrent()) return false
          const pathname = chat.conversationType === 'dm' ? '/dm/[id]' : '/channel/[id]'
          router.replace({ pathname, params: { id: chat.id } })
          return false
        }

        if (!operation.isCurrent()) return false
        chatRef.current = chat
        setActiveChatId(chat.id)
        setChatTitle(chat.title)
        hasAutoScrolledRef.current = false
        setMessages(chat.messages)
        setShowingCachedCopy(chat.restoredFromCache === true)
        if (!options.preserveComposer) {
          setInputValue('')
          setImageBase64(null)
          setPendingDocuments([])
          setAttachmentError(null)
          setMentions([])
          setReplyContext(null)
          setGenerationKind(null)
        }
        setExecution(null)
        if (!operation.isCurrent()) return false
        if (operation.workspaceId && isFocusedRef.current) persistLastOpenedChat(chat.id, operation.workspaceId)

        const preferredModelId = chat.actModelId || chat.askModelIds?.[0] || chat.modelId
        const nextSelected =
          models.find((model) => model.id === preferredModelId) ||
          models[0] ||
          null
        setSelectedModel(nextSelected)
        setAutoSelected(false)
        return true
      } finally {
        if (options.switching && operation.isCurrent()) {
          setIsSwitchingChat(false)
        }
        if (ownsOperation) operation.finish()
      }
    },
    [beginOperation, persistLastOpenedChat, routeKind, router],
  )

  const createConversation = useCallback(
    async (models: ChatModel[], options: { replaceRoute?: boolean; preserveComposer?: boolean; operation?: ReturnType<typeof beginOperation> } = {}) => {
      const operation = options.operation ?? beginOperation('create-conversation', null)
      const ownsOperation = !options.operation
      if (!operation.isCurrent()) {
        if (ownsOperation) operation.finish()
        return null
      }
      const isFreeTier = entitlements?.tier === 'free'
      const preferredId = uiSettings.defaultActModelId || await getLastSelectedModelId(operation.workspaceId ?? undefined).catch(() => null)
      if (!operation.isCurrent()) {
        if (ownsOperation) operation.finish()
        return null
      }
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

      if (!operation.isCurrent()) {
        if (ownsOperation) operation.finish()
        return null
      }
      chatRef.current = created
      setActiveChatId(created.id)
      setChatTitle(created.title)
      setMessages([])
      setShowingCachedCopy(false)
      if (!options.preserveComposer) {
        setMentions([])
        setReplyContext(null)
        setPendingDocuments([])
        setAttachmentError(null)
        setGenerationKind(null)
      }
      setExecution(null)
      setAutoSelected(true)
      setSelectedModel(
        models.find((model) => model.id === created.modelId) ||
          models[0] ||
          null,
      )
      if (!options.preserveComposer) {
        setInputValue('')
        setImageBase64(null)
      }
      if (ownsOperation) operation.finish()
      return created
    },
    [beginOperation, entitlements?.tier, uiSettings.defaultActModelId],
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

  const startsNewChat = routeKind === 'tab' && Boolean(newChatIntent)
  const handledNewChatIntentRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!startsNewChat || !newChatIntent) {
      handledNewChatIntentRef.current = null
      return
    }
    if (handledNewChatIntentRef.current === newChatIntent) return
    handledNewChatIntentRef.current = newChatIntent
    dataEpochRef.current += 1
    invalidateOperations()
    clearConversationScope()
  }, [clearConversationScope, invalidateOperations, newChatIntent, startsNewChat])

  useEffect(() => {
    if (!nativeReady || !activeWorkspaceId) {
      initializedRouteKeyRef.current = null
      completedRouteKeyRef.current = null
      return
    }
    const baseRouteKey = `${activeWorkspaceId}:${routeKind}:${conversationId ?? 'tab-root'}`
    const routeKey = startsNewChat ? `${baseRouteKey}:new-chat:${newChatIntent}` : baseRouteKey
    const ownedPromotion = ownedDraftPromotionRef.current
    const promotionCaughtUp = ownedPromotion?.workspaceId === activeWorkspaceId &&
      ownedPromotion.sourceRouteKind === routeKind && ownedPromotion.conversationId === conversationId &&
      ownedPromotionMatchesChat(ownedPromotion, chatRef.current)
    if (promotionCaughtUp) {
      ownedDraftPromotionRef.current = null
      initializedRouteKeyRef.current = routeKey
      completedRouteKeyRef.current = routeKey
      return
    }
    if (completedRouteKeyRef.current === routeKey || initializedRouteKeyRef.current === routeKey) return
    initializedRouteKeyRef.current = routeKey
    const preserveComposer = readinessResumeRouteRef.current === routeKey
    if (ownedPromotion) ownedDraftPromotionRef.current = null
    const operation = beginOperation('initialize-route', null, false)

    async function resolveModels(): Promise<ChatModel[]> {
      if (chatModels.length > 0) return orderedChatModels(chatModels)
      return getAvailableModels()
    }

    async function resolvePreferredModel(models: ChatModel[]): Promise<ChatModel | null> {
      const isFreeTier = entitlements?.tier === 'free'
      const persistedId = uiSettings.defaultActModelId || await getLastSelectedModelId(operation.workspaceId ?? undefined).catch(() => null)
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
        if (!operation.isCurrent()) return

        setAvailableModels(models)
        const preferred = await resolvePreferredModel(models)
        if (!operation.isCurrent()) return
        setSelectedModel(preferred)

        if (conversationId === 'new') {
          await createConversation(models, { operation, preserveComposer })
          if (operation.isCurrent() && preserveComposer) readinessResumeRouteRef.current = null
          return
        }

        if (conversationId) {
          const didHydrate = await hydrateConversation(conversationId, models, { operation, preserveComposer })
          if (didHydrate && operation.isCurrent() && preserveComposer) readinessResumeRouteRef.current = null
          return
        }

        if (startsNewChat) {
          await createConversation(models, { operation, preserveComposer })
          if (operation.isCurrent() && preserveComposer) readinessResumeRouteRef.current = null
          return
        }

        const lastOpenedChatId = await getLastOpenedChatId(operation.workspaceId ?? undefined)
        if (!operation.isCurrent()) return
        if (lastOpenedChatId && !lastOpenedChatId.startsWith('chat-')) {
          const didHydrate = await hydrateConversation(lastOpenedChatId, models, { operation, preserveComposer }).catch(() => false)
          if (didHydrate) {
            if (operation.isCurrent() && preserveComposer) readinessResumeRouteRef.current = null
            return
          }
        }

        await createConversation(models, { operation, preserveComposer })
        if (operation.isCurrent() && preserveComposer) readinessResumeRouteRef.current = null
      } catch {
        if (operation.isCurrent()) {
          if (routeKind === 'detail' && conversationId && conversationId !== 'new') {
            router.replace('/chat/new')
            return
          }
          const models = await resolveModels().catch(() => [])
          if (!operation.isCurrent()) return
          const preferred = await resolvePreferredModel(models)
          if (!operation.isCurrent()) return
          await createConversation(models, { operation, preserveComposer })
          if (preferred && operation.isCurrent()) setSelectedModel(preferred)
        }
      } finally {
        if (operation.isCurrent()) {
          completedRouteKeyRef.current = startsNewChat ? baseRouteKey : routeKey
          if (startsNewChat) navigation.setParams({ newChatIntent: undefined })
          setIsLoading(false)
        }
        operation.finish()
      }
    }

    void initialize()
    return () => {
      if (completedRouteKeyRef.current !== routeKey && initializedRouteKeyRef.current === routeKey) {
        initializedRouteKeyRef.current = null
      }
      operation.cancel()
    }
  }, [
    nativeReady,
    activeWorkspaceId,
    chatModels,
    conversationId,
    createConversation,
    clearConversationScope,
    entitlements?.tier,
    hydrateConversation,
    invalidateOperations,
    navigation,
    newChatIntent,
    routeKind,
    startsNewChat,
    router,
    uiSettings.defaultActModelId,
    beginOperation,
  ])

  useEffect(() => {
    let isMounted = true
    if (chatModels.length > 0) {
      void orderedChatModels(chatModels).then((models) => {
        if (!isMounted || !mountedRef.current) return
        setAvailableModels(models)
        setSelectedModel((current) => current ? models.find((model) => model.id === current.id) ?? current : current)
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
    let active = true
    const ownerEpoch = ownerEpochRef.current
    const workspaceId = activeWorkspaceId
    const stop = subscribeChats('personal', (chats) => {
      if (!active || !mountedRef.current || ownerEpochRef.current !== ownerEpoch ||
        committedWorkspaceRef.current !== workspaceId || getRequestWorkspaceId() !== workspaceId) return
      setHistory(chats)
    }, workspaceId)
    return () => { active = false; stop() }
  }, [nativeReady, activeWorkspaceId])

  useEffect(() => {
    if (!nativeReady || !activeWorkspaceId || !activeChatId || !/^[0-9a-z]{20,40}$/.test(activeChatId) ||
      isTemporary || isSending || !routeMatchesCurrentChat) return
    let active = true
    const dataEpoch = dataEpochRef.current
    const workspaceId = activeWorkspaceId
    let lastReadMessageId: string | undefined
    const stop = subscribePersonalChat(activeChatId, chat => {
      if (!active || !mountedRef.current || dataEpochRef.current !== dataEpoch ||
        committedWorkspaceRef.current !== workspaceId || getRequestWorkspaceId() !== workspaceId ||
        chatRef.current?.id !== activeChatId || !routeMatchesCurrentChat) return
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
        const readOperation = beginOperation(`read-marker:${chat.id}`, chat.id, false)
        if (!readOperation.isCurrent()) {
          readOperation.finish()
          return
        }
        void setPersonalChatRead(chat.id, false, lastMessageId, workspaceId, readOperation.signal)
          .catch(() => undefined)
          .finally(() => readOperation.finish())
      }
    }, workspaceId)
    return () => { active = false; stop() }
  }, [beginOperation, nativeReady, activeWorkspaceId, activeChatId, isTemporary, isSending, routeMatchesCurrentChat])

  useEffect(() => {
    if (!nativeReady || !activeWorkspaceId || !activeChatId || !/^[0-9a-z]{20,40}$/.test(activeChatId) ||
      isTemporary || !routeMatchesCurrentChat) return
    let active = true
    const workspaceId = activeWorkspaceId
    const dataEpoch = dataEpochRef.current
    try {
      const stop = watchPersonalExecution(workspaceId, activeChatId, run => {
        if (active && mountedRef.current && dataEpochRef.current === dataEpoch &&
          committedWorkspaceRef.current === workspaceId && getRequestWorkspaceId() === workspaceId &&
          chatRef.current?.id === activeChatId && routeMatchesCurrentChat) setExecution({ workspaceId, run })
      }, error => {
        if (active && mountedRef.current && dataEpochRef.current === dataEpoch &&
          committedWorkspaceRef.current === workspaceId && getRequestWorkspaceId() === workspaceId &&
          chatRef.current?.id === activeChatId && routeMatchesCurrentChat) setAttachmentError(userSafeTransportError(error, 'The conversation status could not be refreshed.'))
      })
      return () => { active = false; stop() }
    } catch (error) { void Promise.resolve().then(() => { if (active && dataEpochRef.current === dataEpoch && committedWorkspaceRef.current === workspaceId && getRequestWorkspaceId() === workspaceId) setAttachmentError(userSafeTransportError(error, 'The conversation status could not be refreshed.')) }) }
    return () => { active = false }
  }, [nativeReady, activeWorkspaceId, activeChatId, isTemporary, routeMatchesCurrentChat])

  const handleSubmitApproval = useCallback(
    async (approved: boolean) => {
      const run = currentRun
      if (!activeChatId || !routeMatchesCurrentChat || !run?.approval || run.status !== 'waiting_for_approval') return
      const flightKey = `${activeChatId}:${run.id}:${run.approval.token}`
      if (approvalFlightRef.current === flightKey) return
      approvalFlightRef.current = flightKey
      const operation = beginOperation(`approval:${activeChatId}:${run.id}`, activeChatId)
      if (!operation.isCurrent()) {
        approvalFlightRef.current = null
        operation.finish()
        return
      }
      setApprovalSubmitting(true)
      try {
        await submitRunApproval({
          conversationId: activeChatId,
          agentRunId: run.id,
          token: run.approval.token,
          approved,
        }, { workspaceId: operation.workspaceId ?? undefined, signal: operation.signal })
      } catch {
        if (operation.isCurrent()) Alert.alert('Could not submit approval', 'Please try again.')
      } finally {
        if (operation.isCurrent()) setApprovalSubmitting(false)
        if (approvalFlightRef.current === flightKey) approvalFlightRef.current = null
        operation.finish()
      }
    },
    [activeChatId, beginOperation, currentRun, routeMatchesCurrentChat],
  )

  const scrollToBottom = useCallback(() => {
    requestTranscriptEnd('submission')
  }, [requestTranscriptEnd])
  useEffect(() => {
    if (hasAutoScrolledRef.current || isLoading || !transcriptAuthorityActive || messages.length === 0) return
    hasAutoScrolledRef.current = true
    requestTranscriptEnd('initial-end')
  }, [activeChatId, isLoading, messages.length, requestTranscriptEnd, transcriptAuthorityActive])

  const openConversation = useCallback(
    async (chatId: string) => {
      if (chatId === activeChatId) return
      if (routeKind === 'detail') {
        const operation = beginOperation(`navigate-chat:${chatId}`, activeChatId)
        if (!operation.isCurrent()) { operation.finish(); return }
        router.replace({
          pathname: '/chat/[id]',
          params: {
            id: chatId,
          },
        })
        operation.finish()
        return
      }

      dataEpochRef.current += 1
      invalidateOperations()
      clearConversationScope()
      setIsLoading(true)
      setIsSwitchingChat(true)
      const operation = beginOperation(`open-chat:${chatId}`, null)
      try {
        await hydrateConversation(chatId, availableModels, { switching: true, operation })
      } finally {
        if (operation.isCurrent()) setIsLoading(false)
        operation.finish()
      }
    },
    [activeChatId, availableModels, beginOperation, clearConversationScope, hydrateConversation, invalidateOperations, routeKind, router],
  )

  const startFreshConversation = useCallback(async () => {
    if (routeKind === 'detail' && conversationId !== 'new') {
      const operation = beginOperation('navigate-new-chat', activeChatId)
      if (!operation.isCurrent()) { operation.finish(); return }
      router.replace({
        pathname: '/chat/[id]',
        params: {
          id: 'new',
        },
      })
      operation.finish()
      return
    }

    dataEpochRef.current += 1
    invalidateOperations()
    clearConversationScope()
    const operation = beginOperation('create-fresh-chat', null)
    try {
      await createConversation(availableModels, { operation })
    } finally {
      if (operation.isCurrent()) setIsLoading(false)
      operation.finish()
    }
  }, [activeChatId, availableModels, beginOperation, clearConversationScope, conversationId, createConversation, invalidateOperations, routeKind, router])

  const adoptServerConversation = useCallback(async (
    chat: Chat,
    serverId: string,
    operation: ReturnType<typeof beginOperation>,
  ): Promise<Chat> => {
    if (!serverId || serverId.startsWith('chat-')) throw new Error('Chat changed. Reopen it to send.')
    if (chat.id.startsWith('chat-')) {
      if (!operation.isCurrent() || chatRef.current?.id !== chat.id) throw new Error('Chat changed. Reopen it to send.')
      const next: Chat = { ...chat, id: serverId, clientId: chat.clientId ?? chat.id }
      operation.adoptConversation(serverId)
      const activeSend = activeDataSendRef.current
      if (activeSend?.cancel === operation.cancel && activeSend.conversationId === chat.id) activeSend.conversationId = serverId
      const route = routeIdentityRef.current
      const ownsDetailDraftRoute = route.routeKind === 'detail' && route.conversationId === 'new'
      ownedDraftPromotionRef.current = ownsDetailDraftRoute ? {
        workspaceId: operation.workspaceId,
        sourceRouteKind: 'detail',
        sourceRouteId: 'new',
        clientId: next.clientId ?? chat.id,
        conversationId: serverId,
      } : null
      chatRef.current = next
      setActiveChatId(serverId)
      if (pendingTurn.current?.turnId) pendingTurn.current.conversationId = serverId
      if (!operation.isCurrent() || chatRef.current?.id !== serverId) throw new Error('Chat changed. Reopen it to send.')
      if (ownsDetailDraftRoute) navigation.setParams({ id: serverId })
      if (operation.workspaceId && isFocusedRef.current) persistLastOpenedChat(serverId, operation.workspaceId)
      return next
    }
    if (chat.id !== serverId) throw new Error('Chat changed. Reopen it to send.')
    return chat
  }, [navigation, persistLastOpenedChat])

  // Draft chats are client-side only until the first send. Mirrors web's
  // PENDING_FIRST_CHAT_ID flow: POST /conversations with the draft's id as
  // clientId so the act turn (which also carries `conversationClientId`)
  // lands on the same server row, then adopt the real conversation id.
  const ensureServerConversation = useCallback(
    async (chat: Chat, operation: ReturnType<typeof beginOperation>, modelId?: string): Promise<Chat> => {
      if (!operation.isCurrent()) throw new Error('Chat changed. Reopen it to send.')
      if (!chat.id.startsWith('chat-') || chat.clientId) return chat
      const created = await createNewChat(modelId ?? chat.actModelId ?? chat.modelId, {
        clientId: chat.id,
        title: chat.title,
        workspaceId: operation.workspaceId ?? undefined,
        signal: operation.signal,
      })
      if (!operation.isCurrent() || chatRef.current?.id !== chat.id) throw new Error('Chat changed. Reopen it to send.')
      return adoptServerConversation(chat, created.id, operation)
    },
    [adoptServerConversation],
  )

  const handleStopGeneration = useCallback(async () => {
    const activeChat = chatRef.current
    if (!activeChat?.id) return
    const workspaceId = committedWorkspaceRef.current
    const activeSend = activeDataSendRef.current
    const activeTurnId = activeSend?.workspaceId === workspaceId && activeSend.conversationId === activeChat.id
      ? activeSend.turnId
      : pendingTurn.current?.conversationId === activeChat.id ? pendingTurn.current.turnId : null
    const run = currentRun?.conversationId === activeChat.id && currentRun.turnId === activeTurnId ? currentRun : null
    const assistantMessageId = run?.assistantMessageId
    const messageId = assistantMessageId && /^[a-z0-9]{20,40}$/i.test(assistantMessageId) ? assistantMessageId : undefined
    const activeSendOwnsChat = activeSend?.workspaceId === workspaceId && activeSend.conversationId === activeChat.id
    const turnMessages = activeTurnId === null ? [] : committedMessagesRef.current.filter(message =>
      message.role === 'assistant' && message.turnId === activeTurnId,
    )
    const partialMessage = (activeSendOwnsChat
      ? committedMessagesRef.current.find(message => message.role === 'assistant' && message.id === activeSend.turnId)
      : undefined) ?? (messageId
        ? committedMessagesRef.current.find(message => message.role === 'assistant' && message.id === messageId)
        : turnMessages.length === 1 ? turnMessages[0] : undefined)
    const partialModelId = activeSendOwnsChat ? activeSend.modelId : partialMessage?.selectedModelId
    const partialPayload = buildStopPartialPayload(partialMessage, partialModelId)
    if (activeSend && activeSend.workspaceId === workspaceId && activeSend.conversationId === activeChat.id) {
      activeSend.cancel()
      if (activeDataSendRef.current === activeSend) activeDataSendRef.current = null
      if (sendLockOwnerRef.current === activeSend) {
        sendLockOwnerRef.current = null
        sendLockTurnIdRef.current = null
      }
    }
    abortRef.current = true
    pendingTurn.current = null
    setIsSending(false)
    setMessages(current => current.map(message => {
      if (activeTurnId && message.turnId !== activeTurnId && message.id !== messageId) return message
      const interrupted = message.isStreaming || message.responses?.some(response => response.isLoading) === true
      return {
        ...message,
        isStreaming: false,
        status: interrupted ? 'interrupted' : message.status,
        responses: message.responses?.map(response => ({
          ...response,
          isLoading: false,
          status: response.isLoading ? 'interrupted' : response.status,
        })),
      }
    }))

    const shouldStopServerConversation = Boolean(workspaceId && !isTemporary && !activeChat.id.startsWith('chat-'))
    if (!shouldStopServerConversation || !workspaceId) return
    const stopLockKey = conversationStopLockKey(workspaceId, activeChat.id)
    if (conversationStopLocksRef.current.has(stopLockKey)) return
    const stopLockToken = ++stopLockSequenceRef.current
    if (!messageId) conversationStopLocksRef.current.set(stopLockKey, stopLockToken)
    const operation = beginOperation(`stop-generation:${stopLockKey}`, activeChat.id, false)
    try {
      if (!operation.isCurrent()) return
      await stopConversation(activeChat.id, messageId, {
        workspaceId,
        signal: operation.signal,
        ...partialPayload,
      })
      if (operation.isCurrent()) {
        setMessages(current => current.map(message => {
          if (activeTurnId && message.turnId !== activeTurnId && message.id !== messageId) return message
          return { ...message, responses: message.responses?.map(response => ({ ...response, isLoading: false })) }
        }))
      }
    } catch {
      if (operation.isCurrent() && (!activeDataSendRef.current || activeDataSendRef.current.turnId === activeTurnId)) {
        setAttachmentError('Could not stop. The response may still be running.')
      }
    } finally {
      if (!messageId && conversationStopLocksRef.current.get(stopLockKey) === stopLockToken) conversationStopLocksRef.current.delete(stopLockKey)
      operation.finish()
    }
  }, [beginOperation, currentRun, isTemporary])

  const pickImage = useCallback(async () => {
    const operation = beginOperation('image-picker')
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!operation.isCurrent()) return
      if (status !== 'granted') {
        Alert.alert('Photo Library Access Needed', 'Please allow photo access in Settings to attach images.')
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.7,
      })
      if (!operation.isCurrent()) return
      if (!result.canceled && result.assets[0]?.base64) {
        const mimeType = result.assets[0].mimeType || 'image/jpeg'
        composerRevisionRef.current += 1
        setImageBase64(`data:${mimeType};base64,${result.assets[0].base64}`)
      }
    } finally {
      operation.finish()
    }
  }, [beginOperation])

  const pickImageFromCamera = useCallback(async () => {
    const operation = beginOperation('image-picker')
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (!operation.isCurrent()) return
      if (status !== 'granted') {
        Alert.alert('Camera access needed', 'Please allow camera access in Settings.')
        return
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.7,
      })
      if (!operation.isCurrent()) return
      if (!result.canceled && result.assets[0]?.base64) {
        const mimeType = result.assets[0].mimeType || 'image/jpeg'
        composerRevisionRef.current += 1
        setImageBase64(`data:${mimeType};base64,${result.assets[0].base64}`)
      }
    } finally {
      operation.finish()
    }
  }, [beginOperation])

  const queueDocumentUpload = useCallback(async (uri: string, name: string, mimeType: string, pickerOperation?: ReturnType<typeof beginOperation>) => {
    if (pickerOperation && !pickerOperation.isCurrent()) return
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const operation = beginOperation(`document-upload:${clientId}`)
    if (!operation.isCurrent()) {
      operation.finish()
      return
    }
    composerRevisionRef.current += 1
    setAttachmentError(null)
    setPendingDocuments((prev) => [...prev, { clientId, name, fileIds: [], status: 'uploading' }])
    try {
      const result = await uploadDocument(uri, name, mimeType, {
        workspaceId: operation.workspaceId ?? undefined,
        signal: operation.signal,
      })
      if (!operation.isCurrent()) return
      setPendingDocuments((prev) =>
        prev.map((d) =>
          d.clientId === clientId
            ? { ...d, status: 'ready', fileIds: result.ids, name: result.name }
            : d,
        ),
      )
    } catch (err) {
      if (!operation.isCurrent()) return
      const msg = userSafeTransportError(err, 'Could not index file')
      setPendingDocuments((prev) =>
        prev.map((d) => (d.clientId === clientId ? { ...d, status: 'error', error: msg } : d)),
      )
    } finally {
      operation.finish()
    }
  }, [beginOperation])

  const pickFile = useCallback(async () => {
    const operation = beginOperation('document-picker', chatRef.current?.id ?? null, false)
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
      if (!operation.isCurrent() || result.canceled) return
      const asset = result.assets[0]
      if (!asset) return
      const mimeType = asset.mimeType ?? 'application/octet-stream'
      await queueDocumentUpload(asset.uri, asset.name, mimeType, operation)
    } finally {
      operation.finish()
    }
  }, [beginOperation, queueDocumentUpload])

  const handleModelSelect = useCallback(
    async (model: ChatModel) => {
      const operation = beginOperation('text-model-selection')
      if (!operation.isCurrent()) {
        operation.finish()
        return
      }
      setSelectedModel(model)
      setModelPickerVisible(false)
      try {
        await setLastSelectedModelId(model.id, operation.workspaceId ?? undefined).catch(() => {})
        if (!operation.isCurrent()) return
        await syncConversationMeta({
          modelId: model.id,
          askModelIds: [model.id],
          actModelId: model.id,
        }, operation)
      } finally {
        operation.finish()
      }
    },
    [beginOperation, syncConversationMeta],
  )

  const handleMediaSend = useCallback(
    async (kind: 'image' | 'video') => {
      if (sendLockTurnIdRef.current) return
      const activeChat = chatRef.current
      if (activeChat && conversationStopLocksRef.current.has(conversationStopLockKey(committedWorkspaceRef.current, activeChat.id))) return
      if (!activeChat || isSending || messages.some(message => message.responses?.some(response => response.isLoading))) return
      const modelId = kind === 'image'
        ? (selectedImageModelId ?? imageModels[0]?.id)
        : (selectedVideoModelId ?? videoModels[0]?.id)
      if (!modelId) {
        setAttachmentError(`No ${kind} model is available on this account.`)
        return
      }
      if (!inputValue.trim() && !imageBase64) return

      const operation = beginOperation('media-send', activeChat.id, false)
      const mediaWorkspaceId = operation.workspaceId
      if (!operation.isCurrent() || !mediaWorkspaceId || mediaWorkspaceId !== getRequestWorkspaceId()) {
        operation.finish()
        return
      }
      const capturedInput = inputValue
      const capturedImage = imageBase64
      const capturedReply = replyContext

      hapticImpact()
      Keyboard.dismiss()
      setIsSending(true)
      setAttachmentError(null)

      const signature = JSON.stringify([mediaWorkspaceId, kind, modelId, capturedInput, capturedImage, capturedReply])
      const retryTurn = pendingTurn.current?.conversationId === activeChat.id && pendingTurn.current.signature === signature
        ? pendingTurn.current
        : null
      const turnId = retryTurn?.turnId ?? generateMessageId()
      const userMessageId = retryTurn?.userMessageId ?? generateMessageId()
      sendLockTurnIdRef.current = turnId
      pendingTurn.current = { conversationId: activeChat.id, signature, turnId, userMessageId }
      const sendOwner = { turnId, workspaceId: mediaWorkspaceId, conversationId: activeChat.id, modelId, cancel: operation.cancel }
      activeDataSendRef.current = sendOwner
      sendLockOwnerRef.current = sendOwner
      const promptText = capturedReply?.bodyForModel
        ? `${capturedInput.trim()}\n\n---\n[User is replying in thread to prior content]\n${capturedReply.bodyForModel}`
        : capturedInput.trim()
      const userMessage: Message = {
        id: userMessageId,
        turnId,
        role: 'user',
        content: capturedInput.trim(),
        timestamp: Date.now(),
        imageData: capturedImage || undefined,
        contentType: kind,
        mode: 'act',
        replyToTurnId: capturedReply?.replyToTurnId,
        replySnippet: capturedReply?.snippet,
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
      const clearedComposerRevision = ++composerRevisionRef.current
      setInputValue('')
      setImageBase64(null)
      setReplyContext(null)
      setGenerationKind(null)
      scrollToBottom()

      // Generation endpoints need a real conversationId — create the server
      // row for drafts first (same pending-first-send flow as text sends).
      let sendChat = activeChat
      let generationFailed = false
      try {
        if (!isTemporary) {
          try {
            sendChat = await ensureServerConversation(activeChat, operation, modelId)
          } catch (error) {
            if (!operation.isCurrent()) throw error
          }
        }
        let sendConversationId = sendChat.id.startsWith('chat-') ? undefined : sendChat.id
        if (!operation.isCurrent() || chatRef.current?.id !== sendChat.id) return
        if (pendingTurn.current?.turnId === turnId) pendingTurn.current.conversationId = sendChat.id
        if (!isTemporary) {
          const result = await submitPersonalTurn({
            conversationId: sendConversationId as PersonalTurn['conversationId'],
            clientId: sendConversationId ? undefined : sendChat.id,
            turnId, modelId, mode: 'act', contentType: kind,
            parts: [...(capturedImage ? [{ type: 'file' as const, url: capturedImage, mediaType: capturedImage.match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg' }] : []), { type: 'text', text: capturedInput.trim() }],
            replyToTurnId: capturedReply?.replyToTurnId,
            replySnippet: capturedReply?.snippet,
          }, mediaWorkspaceId, operation.signal)
          if (!operation.isCurrent()) return
          sendChat = await adoptServerConversation(sendChat, result.conversationId, operation)
          sendConversationId = sendChat.id
          if (!operation.isCurrent()) return
        }
        if (!operation.isCurrent() || chatRef.current?.id !== sendChat.id || pendingTurn.current?.turnId !== turnId) return
        const result = kind === 'image'
          ? await generateImage({
              prompt: promptText,
              modelId,
              conversationId: isTemporary ? undefined : sendConversationId,
              temporaryChat: isTemporary || undefined,
              turnId,
              imageUrl: capturedImage ?? undefined,
              workspaceId: mediaWorkspaceId,
              signal: operation.signal,
            })
          : await generateVideo({
              prompt: promptText,
              modelId,
              conversationId: isTemporary ? undefined : sendConversationId,
              temporaryChat: isTemporary || undefined,
              turnId,
              imageUrl: capturedImage ?? undefined,
              workspaceId: mediaWorkspaceId,
              signal: operation.signal,
            })
          if (!operation.isCurrent() || chatRef.current?.id !== sendChat.id || pendingTurn.current?.turnId !== turnId) return
          setMessages((current) =>
            current.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    ...(result.url ? { generatedFiles: [...(m.generatedFiles ?? []), { url: result.url, mediaType: kind === 'image' ? 'image/png' : 'video/mp4' }] } : {}),
                    ...(result.outputId ? { outputs: [...(m.outputs ?? []).filter((output) => output._id !== result.outputId), {
                      _id: result.outputId, type: kind, status: 'completed', prompt: promptText, modelId,
                      ...(result.url ? { url: result.url } : {}), createdAt: Date.now(), turnId,
                    }] } : {}),
                    status: 'completed',
                    responses: [{ ...m.responses![0], isLoading: false }],
                  }
                : m,
            ),
          )
        if (!isTemporary) {
          const refreshed = await loadChat(sendChat.id, mediaWorkspaceId).catch(() => null)
          if (!operation.isCurrent() || pendingTurn.current?.turnId !== turnId) return
          if (refreshed && chatRef.current?.id === sendChat.id) {
            chatRef.current = refreshed
            setChatTitle(refreshed.title)
            setMessages(refreshed.messages)
            setShowingCachedCopy(refreshed.restoredFromCache === true)
          }
          if (operation.isCurrent()) await refreshHistory().catch(() => {})
        }
      } catch (error) {
        if (!operation.isCurrent() || chatRef.current?.id !== sendChat.id || pendingTurn.current?.turnId !== turnId) return
        if (composerRevisionRef.current === clearedComposerRevision) {
          composerRevisionRef.current += 1
          setGenerationKind(kind)
          setInputValue(capturedInput)
          setImageBase64(capturedImage)
          setReplyContext(capturedReply)
        }
        generationFailed = true
        const message = userSafeTransportError(error, `${kind === 'image' ? 'Image' : 'Video'} generation failed. Please try again.`)
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  status: 'error',
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
        if (!generationFailed && pendingTurn.current?.turnId === turnId) pendingTurn.current = null
        if (sendLockOwnerRef.current === sendOwner) {
          sendLockOwnerRef.current = null
          sendLockTurnIdRef.current = null
          if (operation.isCurrent()) setIsSending(false)
        }
        if (activeDataSendRef.current === sendOwner) activeDataSendRef.current = null
        operation.finish()
      }
    },
    [
      ensureServerConversation,
      adoptServerConversation,
      beginOperation,
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
      composerRevisionRef.current += 1
      setGenerationKind(kind)
      if (kind === 'image' && modelId) setSelectedImageModelId(modelId)
      if (kind === 'video' && modelId) setSelectedVideoModelId(modelId)
    },
    [],
  )

  const handleSend = useCallback(async () => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push('/auth-flow?force=true')
      return
    }
    if (sendLockTurnIdRef.current) return

    const activeChat = chatRef.current
    if (activeChat && conversationStopLocksRef.current.has(conversationStopLockKey(committedWorkspaceRef.current, activeChat.id))) return
    const hasReadyDocs = pendingDocuments.some((d) => d.status === 'ready')
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

      const operation = beginOperation('chat-send', activeChat.id, false)
    const workspaceAtSend = operation.workspaceId
    if (!operation.isCurrent() || !workspaceAtSend || workspaceAtSend !== getRequestWorkspaceId()) {
      operation.finish()
      return
    }
    const capturedInput = inputValue
    const capturedImage = imageBase64
    const readyDocs = pendingDocuments.filter((d) => d.status === 'ready')
    const indexedAttachments: IndexedAttachment[] = readyDocs.map((d) => ({ name: d.name, fileIds: d.fileIds }))
    const indexedFileNames = readyDocs.map((d) => d.name)
    const sentMentions = mentions
    const sentReply = replyContext
    const sentRequestMode = requestMode
    const sentToolIds = selectedToolIds.length ? [...selectedToolIds] : undefined
    const sentMemoryEnabled = isTemporary ? false : memoryEnabled
    const sentModel = selectedModel

    const signature = JSON.stringify([workspaceAtSend, capturedInput, capturedImage, sentModel.id, sentRequestMode, indexedAttachments, sentMentions, sentReply])
    const assistantId = pendingTurn.current?.conversationId === activeChat.id && pendingTurn.current.signature === signature
      ? pendingTurn.current.turnId
      : generateMessageId()
    sendLockTurnIdRef.current = assistantId
    abortRef.current = false
    pendingTurn.current = { conversationId: activeChat.id, signature, turnId: assistantId }
    const sendOwner = { turnId: assistantId, workspaceId: workspaceAtSend, conversationId: activeChat.id, modelId: sentModel.id, cancel: operation.cancel }
    activeDataSendRef.current = sendOwner
    sendLockOwnerRef.current = sendOwner

    hapticImpact()
    textInputRef.current?.blur()
    Keyboard.dismiss()
    abortRef.current = false
    setIsSending(true)
    setAttachmentError(null)

    let fileContext = ''
    if (indexedFileNames.length > 0) {
      fileContext = `\n\n[Indexed documents: ${indexedFileNames.join(', ')}]`
    }

    const userMessage: Message = {
      id: generateMessageId(),
      turnId: assistantId,
      role: 'user',
      content: capturedInput.trim() + fileContext,
      timestamp: Date.now(),
      imageData: capturedImage || undefined,
      mode: 'act',
      replyToTurnId: sentReply?.replyToTurnId,
      replySnippet: sentReply?.snippet,
      mentions: sentMentions.length > 0 ? sentMentions : undefined,
      indexedDocuments: indexedFileNames.length ? indexedFileNames : undefined,
      indexedAttachments: indexedAttachments.length ? indexedAttachments : undefined,
    }

    const nextTitle = getNextTitle(chatTitle, capturedInput.trim() || indexedFileNames[0] || '')
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
          modelId: sentModel.id,
          modelName: sentModel.name,
          provider: sentModel.provider,
          content: '',
          isLoading: true,
        },
      ],
      mode: 'act',
      isStreaming: true,
    }

    setMessages([...userMessageList, placeholderAssistant])
    const clearedComposerRevision = ++composerRevisionRef.current
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
    let failed = false
    scrollToBottom()

    try {
      let sendChat = activeChat
      if (!isTemporary) {
        try {
          sendChat = await ensureServerConversation(activeChat, operation, sentModel.id)
        } catch (error) {
          if (!operation.isCurrent()) throw error
        }
        if (!operation.isCurrent() || chatRef.current?.id !== sendChat.id) return
        if (!sendChat.id.startsWith('chat-')) {
          await syncConversationMeta({
            title: nextTitle,
            modelId: sentModel.id,
            askModelIds: [sentModel.id],
            actModelId: sentModel.id,
            lastMode: 'act',
          }, operation).catch(() => {})
          if (!operation.isCurrent()) return
        }
      }
      const stillDraft = sendChat.id.startsWith('chat-')
      if (pendingTurn.current?.turnId === assistantId) pendingTurn.current.conversationId = sendChat.id

      for await (const chunk of chatStream(sentModel.id, buildApiMessages(userMessageList), {
        workspaceId: workspaceAtSend ?? undefined,
        conversationId: isTemporary || stillDraft ? undefined : sendChat.id,
        conversationClientId: isTemporary || !stillDraft ? undefined : sendChat.id,
        turnId: assistantId,
        temporaryChat: isTemporary || undefined,
        requestMode: sentRequestMode,
        requestedToolIds: sentToolIds,
        memoryEnabled: sentMemoryEnabled,
        mentions: sentMentions.length > 0 ? sentMentions.map(mentionToRequestBody) : undefined,
        replyContextForModel: sentReply?.bodyForModel,
        indexedFileNames: indexedFileNames.length > 0 ? indexedFileNames : undefined,
        indexedAttachments: indexedAttachments.length > 0 ? indexedAttachments : undefined,
        signal: operation.signal,
      })) {
        if (!operation.isCurrent() || chatRef.current?.id !== sendChat.id || pendingTurn.current?.turnId !== assistantId) break
        if (chunk.type === 'start' && chunk.metadata && typeof chunk.metadata === 'object' && 'conversationId' in chunk.metadata && typeof chunk.metadata.conversationId === 'string') {
          const serverId = chunk.metadata.conversationId
          if (sendChat.id.startsWith('chat-')) {
            sendChat = await adoptServerConversation(sendChat, serverId, operation)
            if (!operation.isCurrent()) break
          } else if (serverId !== sendChat.id) {
            throw new Error('Chat changed. Reopen it to send.')
          }
        }
        const scopedChunk = chunk.type === 'error'
          ? { ...chunk, content: userSafeTransportError(new Error(chunk.content), 'Could not send. Please try again.') }
          : chunk
        if (scopedChunk.type === 'error') failed = true
        setMessages((current) => applyStreamChunk(current, assistantId, sentModel, scopedChunk))
      }
      if (!operation.isCurrent() || pendingTurn.current?.turnId !== assistantId) return
      if (failed) {
        if (composerRevisionRef.current === clearedComposerRevision) {
          composerRevisionRef.current += 1
          setInputValue(capturedInput)
          setImageBase64(capturedImage)
          setPendingDocuments(readyDocs)
          setMentions(sentMentions)
          setReplyContext(sentReply)
        }
        setAttachmentError('Could not send. Your draft is ready to retry.')
        return
      }
      pendingTurn.current = null

      if (!isTemporary) {
        const refreshed = await loadChat(sendChat.id, workspaceAtSend).catch(() => null)
        if (!operation.isCurrent()) return
        if (refreshed && !pendingTurn.current && chatRef.current?.id === sendChat.id) {
          chatRef.current = refreshed
          setChatTitle(refreshed.title)
          setMessages(refreshed.messages)
          setShowingCachedCopy(refreshed.restoredFromCache === true)
        } else {
          setMessages((current) => applyStreamChunk(current, assistantId, sentModel, { type: 'done', content: '' }))
        }
        if (operation.isCurrent()) await refreshHistory()
      } else {
        setMessages((current) => applyStreamChunk(current, assistantId, sentModel, { type: 'done', content: '' }))
      }
    } catch (error) {
      if (!operation.isCurrent()) return
      failed = true
      setMessages((current) =>
        applyStreamChunk(current, assistantId, sentModel, {
          type: 'error',
          content: userSafeTransportError(error, 'Could not send. Please try again.'),
        }),
      )
      if (composerRevisionRef.current === clearedComposerRevision) {
        composerRevisionRef.current += 1
        setInputValue(capturedInput)
        setImageBase64(capturedImage)
        setPendingDocuments(readyDocs)
        setMentions(sentMentions)
        setReplyContext(sentReply)
      }
      setAttachmentError('Could not send. Your draft is ready to retry.')
    } finally {
      if (sendLockOwnerRef.current === sendOwner) {
        sendLockOwnerRef.current = null
        sendLockTurnIdRef.current = null
        if (operation.isCurrent()) setIsSending(false)
      }
      if (activeDataSendRef.current === sendOwner) activeDataSendRef.current = null
      operation.finish()
    }
  }, [
    beginOperation,
    chatTitle,
    ensureServerConversation,
    adoptServerConversation,
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

  const sendPresetMessage = useCallback(async (text: string, scope: NativeTranscriptScope, saveOperation: ReturnType<typeof beginOperation>) => {
    if (!isTranscriptScopeCurrent(scope) || !saveOperation.isCurrent()) throw new Error('This draft is no longer current.')
    if (sendLockTurnIdRef.current || isSending) throw new Error('A message is already being sent.')
    const chat = chatRef.current
    const model = selectedModel
    const workspaceId = saveOperation.workspaceId
    if (!chat || !model || !workspaceId || getRequestWorkspaceId() !== workspaceId) throw new Error('This chat is no longer available.')
    if (conversationStopLocksRef.current.has(conversationStopLockKey(workspaceId, chat.id))) throw new Error('A message is already being stopped.')

    const signature = JSON.stringify([workspaceId, chat.id, model.id, text])
    const retry = presetRetryRef.current?.signature === signature ? presetRetryRef.current : null
    const turnId = retry?.turnId ?? generateMessageId()
    const userMessage: Message = { id: retry?.userMessageId ?? generateMessageId(), turnId, role: 'user', content: text, timestamp: Date.now(), mode: 'act' }
    const assistant: Message = {
      id: turnId, turnId, role: 'assistant', content: '', timestamp: Date.now(), selectedModelId: model.id,
      responses: [{ modelId: model.id, modelName: model.name, provider: model.provider, content: '', isLoading: true }],
      mode: 'act', isStreaming: true,
    }
    const requestMessages = [...messages.filter(message => message.turnId !== turnId), userMessage]
    const dataOperation = beginOperation('preset-send', chat.id, false)
    if (!dataOperation.isCurrent()) {
      dataOperation.finish()
      throw new Error('This chat is no longer available.')
    }
    const sendOwner = { turnId, workspaceId, conversationId: chat.id, modelId: model.id, cancel: dataOperation.cancel }
    activeDataSendRef.current = sendOwner
    sendLockOwnerRef.current = sendOwner
    const handoff = new Promise<void>((resolve, reject) => {
      let handedOff = false
      let streamFinished = false
      const work = (async () => {
        let sendChat = chat
        sendLockTurnIdRef.current = turnId
        presetRetryRef.current = { signature, turnId, userMessageId: userMessage.id }
        pendingTurn.current = { conversationId: chat.id, signature, turnId }
        setIsSending(true)
        setMessages(current => [...current.filter(message => message.turnId !== turnId), userMessage, assistant])
        requestTranscriptEnd('submission')
        try {
          for await (const chunk of chatStream(model.id, buildApiMessages(requestMessages), {
            workspaceId,
            conversationId: isTemporary || chat.id.startsWith('chat-') ? undefined : chat.id,
            conversationClientId: isTemporary || !chat.id.startsWith('chat-') ? undefined : chat.id,
            turnId,
            temporaryChat: isTemporary || undefined,
            requestMode: 'chat',
            memoryEnabled: isTemporary ? false : memoryEnabled,
            signal: dataOperation.signal,
          })) {
            if (!dataOperation.isCurrent() || chatRef.current?.id !== sendChat.id) throw new Error('This chat is no longer current.')
            if (!handedOff && (!scope.isCurrent() || !saveOperation.isCurrent())) throw new Error('This draft is no longer current.')
            if (chunk.type === 'start' && chunk.metadata && typeof chunk.metadata === 'object' && 'conversationId' in chunk.metadata && typeof chunk.metadata.conversationId === 'string') {
              const serverId = chunk.metadata.conversationId
              if (chat.id.startsWith('chat-')) {
                sendChat = await adoptServerConversation(chat, serverId, dataOperation)
                await saveChat(sendChat, workspaceId)
                if (!dataOperation.isCurrent()) throw new Error('This chat is no longer current.')
              } else if (serverId !== sendChat.id) {
                throw new Error('Chat changed. Reopen it to send.')
              }
            }
            const scopedChunk = chunk.type === 'error'
              ? { ...chunk, content: userSafeTransportError(new Error(chunk.content), 'Could not send. Please try again.') }
              : chunk
            setMessages(current => applyStreamChunk(current, turnId, model, scopedChunk))
            if (scopedChunk.type === 'error') throw new Error(scopedChunk.content)
            if (!handedOff && (chunk.type === 'start' || isTemporary)) {
              handedOff = true
              resolve()
            }
          }
          streamFinished = true
          if (!handedOff) { handedOff = true; resolve() }
          if (!dataOperation.isCurrent()) return
          setMessages(current => applyStreamChunk(current, turnId, model, { type: 'done', content: '' }))
          presetRetryRef.current = null
          pendingTurn.current = null
          if (!isTemporary) {
            const refreshed = await loadChat(sendChat.id, workspaceId).catch(() => null)
            if (dataOperation.isCurrent() && refreshed && chatRef.current?.id === sendChat.id) {
              chatRef.current = refreshed
              setChatTitle(refreshed.title)
              setMessages(refreshed.messages)
              setShowingCachedCopy(refreshed.restoredFromCache === true)
            }
          }
        } catch (error) {
          const safeError = userSafeTransportError(error, 'Could not send. Please retry.')
          if (!streamFinished && dataOperation.isCurrent()) {
            setMessages(current => applyStreamChunk(current, turnId, model, { type: 'error', content: safeError }))
          }
          if (!handedOff) { handedOff = true; reject(new Error(safeError)) }
        } finally {
          if (sendLockOwnerRef.current === sendOwner) {
            sendLockOwnerRef.current = null
            sendLockTurnIdRef.current = null
            if (dataOperation.isCurrent()) setIsSending(false)
          }
          if (activeDataSendRef.current === sendOwner) activeDataSendRef.current = null
          dataOperation.finish()
        }
      })()
      void work
    })
    await handoff
  }, [adoptServerConversation, beginOperation, isSending, isTemporary, isTranscriptScopeCurrent, memoryEnabled, messages, requestTranscriptEnd, selectedModel])

  const handleSaveDraft = useCallback(async (state: DraftModalState, scope: NativeTranscriptScope) => {
    if (!isTranscriptScopeCurrent(scope)) throw new Error('This draft is no longer current.')
    const chat = chatRef.current
    const operation = beginOperation(`draft-save:${scope.mountNonce}`, chat?.id ?? null)
    try {
      if (!operation.isCurrent() || !isTranscriptScopeCurrent(scope)) throw new Error('This draft is no longer current.')
      if (state.kind === 'skill') {
        await createSkill({ name: state.draft.name, description: state.draft.description, instructions: state.draft.instructions, enabled: true }, {
          workspaceId: operation.workspaceId ?? undefined,
          signal: operation.signal,
        })
        if (!operation.isCurrent() || !isTranscriptScopeCurrent(scope)) throw new Error('This draft is no longer current.')
        return
      }
      const schedule = state.draft.schedule.kind === 'interval'
        ? `Every ${state.draft.schedule.intervalMinutes} minutes`
        : state.draft.schedule.kind === 'daily'
          ? `Daily at ${String(state.draft.schedule.hourUTC).padStart(2, '0')}:${String(state.draft.schedule.minuteUTC).padStart(2, '0')} UTC`
          : state.draft.schedule.kind === 'weekly'
            ? `Weekly on day ${state.draft.schedule.dayOfWeekUTC} at ${String(state.draft.schedule.hourUTC).padStart(2, '0')}:${String(state.draft.schedule.minuteUTC).padStart(2, '0')} UTC`
            : `Monthly on day ${state.draft.schedule.dayOfMonthUTC} at ${String(state.draft.schedule.hourUTC).padStart(2, '0')}:${String(state.draft.schedule.minuteUTC).padStart(2, '0')} UTC`
      const preset = [
        `Create an automation from this approved draft: ${state.draft.name}`,
        state.draft.description ? `Description: ${state.draft.description}` : '',
        `Instructions:\n${state.draft.instructions}`,
        `Schedule: ${schedule}`,
        `Time zone: ${state.draft.timezone || 'UTC'}`,
        state.draft.detectedIntegrations.length ? `Integrations: ${state.draft.detectedIntegrations.join(', ')}` : '',
        state.draft.missingFields.length ? `Still to confirm: ${state.draft.missingFields.join(', ')}` : '',
      ].filter(Boolean).join('\n\n')
      await sendPresetMessage(preset, scope, operation)
    } finally {
      operation.finish()
    }
  }, [beginOperation, isTranscriptScopeCurrent, sendPresetMessage])

  useLayoutEffect(() => {
    nativeDraftSaveRef.current = handleSaveDraft
  }, [handleSaveDraft])

  const sortedModels = useMemo(() => availableModels, [availableModels])

  // The upgrade modal is now only shown when a user explicitly taps a locked
  // premium model. Auto-opening it on every free-tier session is removed for
  // App Store compliance and to avoid a confusing initial popup.

  const renderedActionChatId = actionsChat?.id
  const renderedActionOperation = actionsChat ? chatActionsOperationRef.current : null

  if (isLoading || startsNewChat) {
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
          enabled={Platform.OS !== 'android' || keyboardVisible}
          keyboardVerticalOffset={headerHeight}
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
              <EmptyPersonalChat theme={theme} onSuggest={text => { composerRevisionRef.current += 1; setInputValue(text); textInputRef.current?.focus() }} />
            ) : (
              <NativePersonalChatTranscript
                view={transcriptView}
                workspaceId={activeWorkspaceId}
                conversationId={activeChatId ?? 'new'}
                query={searchQuery}
                scrollIntent={transcriptScrollIntent}
                authorityActive={transcriptAuthorityActive}
                publicModelLabels={publicModelLabels}
                onReply={handleTranscriptReply}
                onJumpToReply={handleTranscriptJump}
                onSaveDraft={handleNativeSaveDraft}
              />
            )}
          </View>

          <View style={[styles.composerSurface, { paddingBottom: composerFooterInset }, !transcriptAuthorityActive && { display: 'none' }]}>
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
              onChangeInput={(value) => { composerRevisionRef.current += 1; setInputValue(value) }}
              onSend={() => void handleSend()}
              onStop={() => void handleStopGeneration()}
              isSending={isSending || messages.some(message => message.responses?.some(response => response.isLoading))}
              isTemporary={isTemporary}
              capabilities={capabilities}
              imageBase64={imageBase64}
              onClearImage={() => { composerRevisionRef.current += 1; setImageBase64(null) }}
              onPickImage={() => {
                void pickImage()
              }}
              onPickCamera={() => void pickImageFromCamera()}
              onPickFile={() => void pickFile()}
              pendingDocuments={pendingDocuments}
              onRemoveDocument={(clientId) => { composerRevisionRef.current += 1; setPendingDocuments((prev) => prev.filter((d) => d.clientId !== clientId)) }}
              attachmentError={attachmentError}
              mentions={mentions}
              onAddMention={(item) => { composerRevisionRef.current += 1; setMentions((current) => [...current, item]) }}
              onRemoveMention={(item) =>
                (composerRevisionRef.current += 1, setMentions((current) =>
                  current.filter((m) => !(m.id === item.id && m.type === item.type)),
                ))
              }
              requestMode={requestMode}
              onChangeRequestMode={(mode) => { composerRevisionRef.current += 1; setRequestMode(mode) }}
              replyContext={replyContext}
              onClearReply={() => { composerRevisionRef.current += 1; setReplyContext(null) }}
              generationKind={generationKind}
              selectedImageModelId={selectedImageModelId}
              selectedVideoModelId={selectedVideoModelId}
              imageModels={imageModels}
              videoModels={videoModels}
              onSelectGeneration={handleSelectGeneration}
              selectedToolIds={selectedToolIds}
              onToggleTool={(id) => { composerRevisionRef.current += 1; handleToggleTool(id) }}
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
          if (model) { setGenerationKind(null); setAutoSelected(true); void handleModelSelect(model).catch(error => setAttachmentError(userSafeTransportError(error, 'Could not select this model.'))) }
        }} onSelect={(mode, id) => {
          if (mode !== 'text') { handleSelectGeneration(mode, id); setModelPickerVisible(false); return }
          const model = availableModels.find(model => model.id === id)
          if (!model) return
          if (entitlements?.tier === 'free' && model.cost > 0) { setModelPickerVisible(false); setUpgradeVisible(true); return }
          setAutoSelected(false); setGenerationKind(null); void handleModelSelect(model).catch(error => setAttachmentError(userSafeTransportError(error, 'Could not select this model.')))
        }} />
      </ChatSheet>

      <ChatSheet theme={theme} visible={optionsOpen} onClose={() => setOptionsOpen(false)} title="Chat options">
        <Section theme={theme}>
          <ListRow theme={theme} icon="shield" title="Temporary chat" subtitle={isTemporary ? 'On. Nothing from this chat is saved.' : 'Off'} onPress={isSending || messages.some(message => message.responses?.some(response => response.isLoading)) ? undefined : () => { setIsTemporary(value => !value); setOptionsOpen(false) }} />
          {history.some(chat => chat.id === activeChatId) ? <ListRow theme={theme} icon="more-horizontal" title="Conversation actions" onPress={() => {
            const target = history.find(chat => chat.id === activeChatId) ?? null
            chatActionsOperationRef.current?.finish()
            chatActionsOperationRef.current = target ? beginOperation(`chat-actions:${target.id}`, activeChatId) : null
            setOptionsOpen(false)
            setActionsChat(target)
          }} /> : null}
        </Section>
      </ChatSheet>

      <UpgradePrompt
        visible={upgradeVisible}
        theme={theme}
        onClose={() => setUpgradeVisible(false)}
      />

      <ChatActionsSheet
        theme={theme}
        visible={actionsChat !== null}
        chat={actionsChat}
        onClose={() => {
          const operation = renderedActionOperation
          if (!operation || chatActionsOperationRef.current !== operation) return
          operation.finish()
          chatActionsOperationRef.current = null
          setActionsChat(null)
        }}
        onChanged={() => {
          const chatId = renderedActionChatId
          const operation = renderedActionOperation
          if (!operation || chatActionsOperationRef.current !== operation || !operation.isCurrent()) return
          void refreshHistory().then((next) => {
            if (chatActionsOperationRef.current !== operation || !operation.isCurrent()) return
            const updated = chatId ? next.find((c) => c.id === chatId) : null
            if (updated?.title && chatRef.current?.id === chatId) {
              setChatTitle(updated.title)
              if (chatRef.current) chatRef.current = { ...chatRef.current, title: updated.title }
            }
          }).catch(() => {}).finally(() => operation.finish())
        }}
        onDeleted={() => {
          const operation = renderedActionOperation
          if (!operation || chatActionsOperationRef.current !== operation || !operation.isCurrent()) return
          operation.finish()
          chatActionsOperationRef.current = null
          void startFreshConversation()
        }}
        onArchived={() => {
          const operation = renderedActionOperation
          if (!operation || chatActionsOperationRef.current !== operation || !operation.isCurrent()) return
          operation.finish()
          chatActionsOperationRef.current = null
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
