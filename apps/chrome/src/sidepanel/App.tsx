import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Menu, MessageSquare, MoreHorizontal, MousePointer2, Plus, Settings, Trash2, PanelLeftClose } from 'lucide-react'
import {
  BrandMark,
  ChatComposer,
  ComprehensiveModelPicker,
  ConversationList,
  type ConversationItem,
  DropdownSelect,
} from '@overlay/chat-react'
import {
  type ActApprovalMode,
  type ActiveRunState,
  type AttachmentDraft,
  type BackendListItem,
  type BrowserScopeMode,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  IMAGE_MODELS,
  VIDEO_MODELS,
  type EntitlementsSnapshot,
  type ExtensionPreferences,
  type GenerationMode,
  type RuntimeBootstrap,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeStreamEvent,
  type StoredConversation,
  activeRunKey,
  getModelsByIntelligence,
} from '@overlay/extension-contracts'
import { ChatInterface } from './ChatInterface'
import { BrowserScopeBar } from './BrowserScopeBar'
import { ActApprovalModeMenu, ActAutonomousWarning } from './ActApprovalModeMenu'
import { ApprovalCardStack } from './ApprovalCard'
import { ControlHUD } from './ControlHUD'
import { TabGroupBadge } from './TabGroupBadge'
import { LocalToolActivity } from './LocalToolActivity'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function isDocumentMime(mimeType: string): boolean {
  return (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType === 'application/json'
  )
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

function makeAttachmentId(): string {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function sendRuntimeMessage(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request) as Promise<RuntimeResponse>
}

function assertNoBearerLeak(payload: unknown) {
  // Dev-only defense-in-depth: strip-in-prod to avoid perf cost on every
  // bootstrap. `process.env.NODE_ENV` is inlined by the bundler.
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return
  try {
    const json = JSON.stringify(payload)
    if (/"accessToken"\s*:\s*"[^"]+"/.test(json) || /"refreshToken"\s*:/.test(json)) {
      // Hard-fail in development so a regression can't ship unnoticed.
      console.error('[overlay] bearer-leak check failed: runtime response contained accessToken/refreshToken')
      throw new Error('Runtime response leaked a Bearer token into the side panel.')
    }
  } catch {
    // Ignore serialization errors (e.g., circular refs) — the check is best-effort.
  }
}

function timeAgo(ts: number): string {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - ts) / 60_000))
  if (diffMinutes < 1) return 'now'
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  return `${Math.floor(diffHours / 24)}d`
}

function toConversationItems(conversations: StoredConversation[]): ConversationItem[] {
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    preview: conversation.preview,
    modifiedLabel: timeAgo(conversation.updatedAt),
  }))
}

function BackendSurfaceSection({
  label,
  items,
  emptyLabel,
}: {
  label: string
  items: BackendListItem[]
  emptyLabel: string
}) {
  return (
    <section className="border-t border-[var(--border)] px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
        <span className="text-[10px] tabular-nums text-[var(--muted-light)]">{items.length}</span>
      </div>
      {items.length > 0 ? (
        <div className="space-y-1">
          {items.slice(0, 5).map((item) => (
            <div
              key={`${label}:${item.id}`}
              className="min-w-0 rounded-md px-2 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
              title={item.subtitle || item.title}
            >
              <p className="truncate">{item.title}</p>
              {item.subtitle ? <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{item.subtitle}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-2 py-1 text-xs text-[var(--muted)]">{emptyLabel}</p>
      )}
    </section>
  )
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<RuntimeBootstrap | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [preferencesForm, setPreferencesForm] = useState<ExtensionPreferences>({
    baseUrl: 'https://getoverlay.io',
    modelId: DEFAULT_MODEL_ID,
    imageModelId: DEFAULT_IMAGE_MODEL_ID,
    videoModelId: DEFAULT_VIDEO_MODEL_ID,
  })
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([])
  const [runMode, setRunMode] = useState<'chat' | 'act'>('chat')
  const [isRecording, setIsRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const conversations = useMemo(() => bootstrap?.conversations ?? [], [bootstrap?.conversations])
  const activeConversation = conversations.find((item) => item.id === activeConversationId) ?? conversations[0]
  const conversationItems = useMemo(() => toConversationItems(conversations), [conversations])
  const textModels = useMemo(() => getModelsByIntelligence(false), [])
  const textModelOptions = useMemo(
    () => textModels.map((m) => ({ value: m.id, label: m.name })),
    [textModels],
  )
  const preferences = bootstrap?.preferences ?? preferencesForm
  const entitlements: EntitlementsSnapshot | null = bootstrap?.entitlements ?? null
  const generationMode: GenerationMode = preferences.generationMode ?? 'text'
  const isPaid = entitlements?.isPaid ?? false
  const voiceEnabled = preferences.voiceEnabled ?? false
  const activeRuns = useMemo(() => bootstrap?.activeRuns ?? {}, [bootstrap?.activeRuns])
  const activeRunsByVariant = useMemo<Record<number, ActiveRunState>>(() => {
    if (!activeConversationId) return {}
    const result: Record<number, ActiveRunState> = {}
    for (const [key, run] of Object.entries(activeRuns)) {
      if (!run) continue
      if (key === activeConversationId) {
        result[run.variantIndex ?? 0] = run
        continue
      }
      if (key.startsWith(`${activeConversationId}#`)) {
        const idx = run.variantIndex ?? Number(key.split('#')[1] ?? 0)
        result[Number.isFinite(idx) ? idx : 0] = run
      }
    }
    return result
  }, [activeRuns, activeConversationId])
  const isRunStreaming = Object.values(activeRunsByVariant).some(
    (run) =>
      run &&
      (run.status === 'streaming' ||
        run.status === 'executing_tool' ||
        run.status === 'awaiting_approval'),
  )
  const browserScope: BrowserScopeMode =
    activeConversation?.browserScope ?? preferences.browserScopeMode ?? 'active-tab'
  const actApprovalMode: ActApprovalMode =
    activeConversation?.actApprovalMode ?? preferences.actApprovalMode ?? 'ask'
  const approvals = useMemo(
    () =>
      (bootstrap?.approvals ?? []).filter(
        (a) => !activeConversationId || a.conversationId === activeConversationId,
      ),
    [bootstrap?.approvals, activeConversationId],
  )
  const controlIndicator = bootstrap?.controlIndicator ?? null
  const windowTabs = bootstrap?.windowTabs ?? []
  const toolHistory = useMemo(() => bootstrap?.toolHistory ?? [], [bootstrap?.toolHistory])
  const scopedToolHistory = useMemo(
    () =>
      !activeConversationId
        ? []
        : toolHistory.filter((e) => e.conversationId === activeConversationId),
    [toolHistory, activeConversationId],
  )
  const mainRef = useRef<HTMLElement | null>(null)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)
  function focusComposer() {
    const ta = mainRef.current?.querySelector<HTMLTextAreaElement>('textarea')
    ta?.focus()
  }
  const accountLabel = bootstrap?.session?.user.email || 'Not connected'
  const displayName = bootstrap?.session?.user.firstName
    ? `${bootstrap.session.user.firstName} ${bootstrap.session.user.lastName || ''}`.trim()
    : accountLabel

  const applyConversationUpdate = useCallback((conversation: StoredConversation, nextActiveConversationId: string | null) => {
    setBootstrap((current) => {
      if (!current) return current
      const nextConversations = [...current.conversations.filter((item) => item.id !== conversation.id), conversation]
        .sort((a, b) => b.updatedAt - a.updatedAt)
      return {
        ...current,
        conversations: nextConversations,
        activeConversationId: nextActiveConversationId,
      }
    })
    setActiveConversationId(nextActiveConversationId)
  }, [])

  const refreshBootstrap = useCallback(async () => {
    const response = await sendRuntimeMessage({ type: 'overlay.runtime.bootstrap' })
    if (!response.ok || response.type !== 'overlay.runtime.bootstrap') {
      throw new Error(response.ok ? 'Failed to refresh bootstrap.' : response.error)
    }
    assertNoBearerLeak(response.bootstrap)
    setBootstrap(response.bootstrap)
    setActiveConversationId(response.bootstrap.activeConversationId)
    setPreferencesForm(response.bootstrap.preferences)
  }, [])

  const refreshEntitlements = useCallback(async () => {
    try {
      const response = await sendRuntimeMessage({ type: 'overlay.runtime.entitlements.refresh' })
      if (!response.ok || response.type !== 'overlay.runtime.entitlements.refreshed') return
      setBootstrap((current) => (current ? { ...current, entitlements: response.entitlements } : current))
    } catch {
      // Silent — entitlements refresh is best-effort.
    }
  }, [])

  useEffect(() => {
    void refreshBootstrap().catch((runtimeError) => {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Failed to load extension runtime.')
    })
  }, [refreshBootstrap])

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'overlay-runtime-stream' })
    const handleStreamEvent = (event: RuntimeStreamEvent) => {
      if (event.type === 'overlay.runtime.stream.conversation.updated') {
        applyConversationUpdate(event.conversation, event.activeConversationId)
        return
      }

      if (event.type === 'overlay.runtime.stream.run.updated') {
        setBootstrap((current) => {
          if (!current) return current
          const nextRuns = { ...current.activeRuns }
          const key = activeRunKey(event.conversationId, event.variantIndex)
          if (event.run === null) {
            delete nextRuns[key]
          } else {
            nextRuns[key] = event.run
          }
          return { ...current, activeRuns: nextRuns }
        })
        return
      }

      if (event.type === 'overlay.runtime.stream.approvals.updated') {
        setBootstrap((current) => (current ? { ...current, approvals: event.approvals } : current))
        return
      }

      if (event.type === 'overlay.runtime.stream.control.updated') {
        setBootstrap((current) => (current ? { ...current, controlIndicator: event.controlIndicator } : current))
        return
      }

      setError(event.error)
    }

    port.onMessage.addListener(handleStreamEvent)
    return () => {
      port.onMessage.removeListener(handleStreamEvent)
      port.disconnect()
    }
  }, [applyConversationUpdate])

  useEffect(() => {
    function handleFocus() {
      if (document.visibilityState === 'hidden') return
      void refreshBootstrap().catch(() => {})
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleFocus)
    }
  }, [refreshBootstrap])

  useEffect(() => {
    if (!moreMenuOpen) return
    function onDoc(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreMenuOpen])

  async function handleSavePreferences() {
    setError(null)
    try {
      const response = await sendRuntimeMessage({
        type: 'overlay.runtime.preferences.save',
        preferences: {
          baseUrl: preferencesForm.baseUrl.trim(),
          modelId: preferencesForm.modelId,
          actModelId: preferencesForm.actModelId,
          imageModelId: preferencesForm.imageModelId,
          videoModelId: preferencesForm.videoModelId,
        },
      })
      if (!response.ok || response.type !== 'overlay.runtime.preferences.saved') {
        throw new Error(response.ok ? 'Failed to save settings.' : response.error)
      }
      await refreshBootstrap()
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Failed to save settings.')
    }
  }

  async function handleCreateConversation() {
    setError(null)
    try {
      const response = await sendRuntimeMessage({ type: 'overlay.runtime.conversations.create' })
      if (!response.ok || response.type !== 'overlay.runtime.conversation.created') {
        throw new Error(response.ok ? 'Failed to create conversation.' : response.error)
      }
      await refreshBootstrap()
      setActiveConversationId(response.conversation.id)
      setSidebarOpen(false)
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Failed to create conversation.')
    }
  }

  async function handleDeleteConversation() {
    if (!activeConversation) return
    setError(null)
    try {
      const response = await sendRuntimeMessage({
        type: 'overlay.runtime.conversations.delete',
        conversationId: activeConversation.id,
      })
      if (!response.ok || response.type !== 'overlay.runtime.conversation.deleted') {
        throw new Error(response.ok ? 'Failed to delete conversation.' : response.error)
      }
      await refreshBootstrap()
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Failed to delete conversation.')
    }
  }

  async function handleSelectConversation(conversationId: string) {
    setActiveConversationId(conversationId)
    setSidebarOpen(false)
    await sendRuntimeMessage({
      type: 'overlay.runtime.conversations.select',
      conversationId,
    })
  }

  async function ensureConversation(): Promise<string> {
    if (activeConversationId) return activeConversationId
    const createResponse = await sendRuntimeMessage({ type: 'overlay.runtime.conversations.create' })
    if (!createResponse.ok || createResponse.type !== 'overlay.runtime.conversation.created') {
      throw new Error(createResponse.ok ? 'Failed to create a conversation.' : createResponse.error)
    }
    applyConversationUpdate(createResponse.conversation, createResponse.conversation.id)
    return createResponse.conversation.id
  }

  const handleSetGenerationMode = useCallback(
    (next: GenerationMode) => {
      setError(null)
      persistPickerPreferences({ ...preferences, generationMode: next })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferences],
  )

  const addFiles = useCallback(async (files: File[]) => {
    const drafts: AttachmentDraft[] = []
    const pendingUploads: Array<{ id: string; file: File }> = []
    for (const file of files) {
      if (isImageMime(file.type)) {
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`Image "${file.name}" exceeds 10 MB.`)
          continue
        }
        try {
          const dataUrl = await fileToDataUrl(file)
          drafts.push({
            id: makeAttachmentId(),
            name: file.name,
            mimeType: file.type,
            kind: 'image',
            dataUrl,
            sizeBytes: file.size,
            status: 'ready',
          })
        } catch {
          setError(`Failed to read image "${file.name}".`)
        }
      } else if (isDocumentMime(file.type) || /\.(md|txt|pdf)$/i.test(file.name)) {
        if (file.size > MAX_DOCUMENT_BYTES) {
          setError(`Document "${file.name}" exceeds 20 MB.`)
          continue
        }
        const id = makeAttachmentId()
        drafts.push({
          id,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          kind: 'document',
          sizeBytes: file.size,
          status: 'uploading',
        })
        pendingUploads.push({ id, file })
      } else {
        setError(`Unsupported file type: ${file.name}`)
      }
    }
    if (drafts.length > 0) {
      setAttachments((current) => [...current, ...drafts])
    }
    for (const { id, file } of pendingUploads) {
      try {
        const dataUrl = await fileToDataUrl(file)
        const base64 = stripDataUrlPrefix(dataUrl)
        const response = await sendRuntimeMessage({
          type: 'overlay.runtime.files.ingest',
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64,
        })
        if (!response.ok || response.type !== 'overlay.runtime.files.ingested') {
          throw new Error(response.ok ? 'Upload failed.' : response.error)
        }
        setAttachments((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'ready',
                  documentId: response.documentId,
                  name: response.indexedFileName || item.name,
                }
              : item,
          ),
        )
      } catch (runtimeError) {
        const message = runtimeError instanceof Error ? runtimeError.message : 'Upload failed.'
        setAttachments((current) =>
          current.map((item) => (item.id === id ? { ...item, status: 'error', error: message } : item)),
        )
        setError(message)
      }
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }, [])

  const hasSession = Boolean(bootstrap?.session)

  useEffect(() => {
    if (!hasSession) return
    const id = window.setInterval(
      () => {
        if (document.visibilityState === 'hidden') return
        void refreshEntitlements()
      },
      5 * 60 * 1000,
    )
    return () => window.clearInterval(id)
  }, [hasSession, refreshEntitlements])

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) {
        event.preventDefault()
        void addFiles(files)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [addFiles])

  const handleStartRecord = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        setIsRecording(false)
        for (const track of stream.getTracks()) track.stop()
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })
        if (blob.size === 0) return
        if (blob.size > MAX_AUDIO_BYTES) {
          setError('Recording exceeds 25 MB.')
          return
        }
        setTranscribing(true)
        try {
          const dataUrl = await fileToDataUrl(blob)
          const base64 = stripDataUrlPrefix(dataUrl)
          const response = await sendRuntimeMessage({
            type: 'overlay.runtime.audio.transcribe',
            mimeType: blob.type,
            base64,
          })
          if (!response.ok || response.type !== 'overlay.runtime.audio.transcribed') {
            throw new Error(response.ok ? 'Transcription failed.' : response.error)
          }
          setDraft((current) => (current ? `${current} ${response.text}`.trim() : response.text))
        } catch (runtimeError) {
          setError(runtimeError instanceof Error ? runtimeError.message : 'Transcription failed.')
        } finally {
          setTranscribing(false)
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Microphone unavailable.')
    }
  }, [])

  const handleStopRecord = useCallback(() => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
  }, [])

  async function handleGenerateMedia() {
    const prompt = draft.trim()
    if (!prompt) return
    if (!isPaid) {
      setError('Image and video generation require a paid plan.')
      return
    }
    setError(null)
    try {
      const conversationId = await ensureConversation()
      const response = await sendRuntimeMessage({
        type: 'overlay.runtime.media.generate',
        conversationId,
        prompt,
        kind: generationMode === 'image' ? 'image' : 'video',
        attachments,
      })
      if (!response.ok || response.type !== 'overlay.runtime.media.generated') {
        throw new Error(response.ok ? 'Generation failed.' : response.error)
      }
      setDraft('')
      setAttachments([])
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Generation failed.')
    }
  }

  async function handleAsk() {
    if (generationMode !== 'text') {
      await handleGenerateMedia()
      return
    }
    const question = draft.trim()
    if (!question) return

    setError(null)
    try {
      const conversationId = await ensureConversation()
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const sourceTabId = tab?.id
      if (sourceTabId == null) {
        throw new Error('Could not determine the active tab for this query.')
      }
      const response = runMode === 'act'
        ? await sendRuntimeMessage({
            type: 'overlay.runtime.act.start',
            conversationId,
            prompt: question,
            scope: browserScope,
            sourceTabId,
            actPolicy: actApprovalMode === 'auto' ? 'autonomous' : 'approval',
            attachments: attachments.length > 0 ? attachments : undefined,
          })
        : await sendRuntimeMessage({
            type: 'overlay.runtime.chat.start',
            conversationId,
            prompt: question,
            scope: browserScope,
            sourceTabId,
            attachments: attachments.length > 0 ? attachments : undefined,
          })
      if (!response.ok || (response.type !== 'overlay.runtime.act.started' && response.type !== 'overlay.runtime.chat.started')) {
        throw new Error(response.ok ? 'Send failed.' : response.error)
      }
      setDraft('')
      setAttachments([])
      const runs = response.type === 'overlay.runtime.act.started' ? [response.run] : response.runs
      setBootstrap((current) =>
        current
          ? {
              ...current,
              activeRuns: {
                ...current.activeRuns,
                ...Object.fromEntries(runs.map((run) => [activeRunKey(conversationId, run.variantIndex), run])),
              },
            }
          : current,
      )
      setActiveConversationId(conversationId)
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Send failed.')
    }
  }

  async function handleStopRun() {
    if (!activeConversationId) return
    setError(null)
    try {
      const response = await sendRuntimeMessage({
        type: runMode === 'act' ? 'overlay.runtime.act.stop' : 'overlay.runtime.chat.stop',
        conversationId: activeConversationId,
      })
      if (!response.ok || (response.type !== 'overlay.runtime.act.stopped' && response.type !== 'overlay.runtime.chat.stopped')) {
        throw new Error(response.ok ? 'Could not stop run.' : response.error)
      }
      setBootstrap((current) => {
        if (!current || !activeConversationId) return current
        const nextRuns = { ...current.activeRuns }
        // Clear all variant runs for this conversation.
        for (const key of Object.keys(nextRuns)) {
          if (key === activeConversationId || key.startsWith(`${activeConversationId}#`)) {
            delete nextRuns[key]
          }
        }
        return { ...current, activeRuns: nextRuns }
      })
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Could not stop run.')
    }
  }

  async function persistConversationSettings(settings: {
    browserScope?: BrowserScopeMode
    actApprovalMode?: ActApprovalMode
  }) {
    if (!activeConversationId) {
      // No conversation yet: stash on preferences so the next Ask inherits it.
      const next: ExtensionPreferences = {
        ...preferences,
        browserScopeMode: settings.browserScope ?? preferences.browserScopeMode,
        actApprovalMode: settings.actApprovalMode ?? preferences.actApprovalMode,
      }
      persistPickerPreferences(next)
      return
    }
    try {
      const response = await sendRuntimeMessage({
        type: 'overlay.runtime.conversation.settings.save',
        conversationId: activeConversationId,
        settings,
      })
      if (!response.ok || response.type !== 'overlay.runtime.conversation.settings.saved') {
        throw new Error(response.ok ? 'Failed to save conversation settings.' : response.error)
      }
      applyConversationUpdate(response.conversation, activeConversationId)
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Failed to save conversation settings.')
    }
  }

  async function handleResolveApproval(
    approvalId: string,
    decision: 'approve' | 'reject' | 'approve-allowlist',
  ) {
    setError(null)
    try {
      const response = await sendRuntimeMessage({
        type: 'overlay.runtime.approval.resolve',
        approvalId,
        decision,
      })
      if (!response.ok || response.type !== 'overlay.runtime.approval.resolved') {
        throw new Error(response.ok ? 'Failed to resolve approval.' : response.error)
      }
      setBootstrap(response.bootstrap)
      setActiveConversationId(response.bootstrap.activeConversationId)
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : 'Failed to resolve approval.')
    }
  }

  function persistPickerPreferences(next: ExtensionPreferences) {
    setPreferencesForm(next)
    void sendRuntimeMessage({ type: 'overlay.runtime.preferences.save', preferences: next }).then(() => refreshBootstrap()).catch(() => {})
  }

  const composerPlaceholder = 'Ask about this page, the tabs in this window, or your selection…'

  return (
    <div className="relative flex h-full overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {sidebarOpen ? (
        <>
          <button
            type="button"
            aria-label="Close conversations"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 z-20 bg-[var(--overlay-scrim)]"
          />
          <aside className="absolute inset-y-0 left-0 z-30 flex w-[260px] flex-col border-r border-[var(--border)] bg-[var(--background)] shadow-[0_30px_70px_rgba(0,0,0,0.08)]">
            <div className="flex h-16 min-h-16 shrink-0 items-center justify-between border-b border-[var(--border)] px-5">
              <BrandMark />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close sidebar"
                title="Close sidebar"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              >
                <PanelLeftClose size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div className="shrink-0 border-b border-[var(--border)] px-3 py-3">
              <button
                type="button"
                onClick={handleCreateConversation}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
              >
                <Plus size={14} strokeWidth={1.75} />
                New chat
              </button>
            </div>
            <ConversationList
              conversations={conversationItems}
              activeId={activeConversationId ?? ''}
              onSelect={(conversationId) => {
                void handleSelectConversation(conversationId)
              }}
            />
            {bootstrap?.parity ? (
              <div className="max-h-[42vh] shrink-0 overflow-y-auto border-t border-[var(--border)]">
                <BackendSurfaceSection label="Projects" items={bootstrap.parity.projects} emptyLabel="No projects yet" />
                <BackendSurfaceSection label="Files" items={[...bootstrap.parity.files, ...bootstrap.parity.outputs]} emptyLabel="No files yet" />
                <BackendSurfaceSection label="Knowledge" items={bootstrap.parity.memories} emptyLabel="No memories yet" />
                <BackendSurfaceSection label="Automations" items={bootstrap.parity.automations} emptyLabel="No automations yet" />
                <BackendSurfaceSection label="Extensions" items={[...bootstrap.parity.integrations, ...bootstrap.parity.skills, ...bootstrap.parity.mcps]} emptyLabel="No extensions connected" />
              </div>
            ) : null}
            <div className="mt-auto shrink-0 border-t border-[var(--border)] p-3">
              <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">{displayName}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{accountLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen((value) => !value)}
                className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              >
                <span className="inline-flex items-center gap-2">
                  <Settings size={14} strokeWidth={1.75} />
                  Account settings
                </span>
                <ExternalLink size={13} strokeWidth={1.75} />
              </button>
              {settingsOpen ? (
                <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Overlay Host</p>
                    <input
                      value={preferencesForm.baseUrl}
                      onChange={(event) => setPreferencesForm((current) => ({ ...current, baseUrl: event.target.value }))}
                      placeholder="https://getoverlay.io"
                      className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Model</p>
                    <div className="mt-2">
                      <DropdownSelect
                        value={preferencesForm.modelId}
                        options={textModelOptions}
                        onChange={(modelId) => setPreferencesForm((current) => ({ ...current, modelId }))}
                        aria-label="Default ask model"
                        buttonClassName="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleSavePreferences()
                      }}
                      className="min-w-0 flex-1 rounded-lg bg-[var(--foreground)] px-3 py-2 text-sm font-medium text-[var(--background)] transition-colors hover:opacity-80"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void sendRuntimeMessage({ type: 'overlay.runtime.auth.open-sign-in' }).then((response) => {
                          if (!response.ok || response.type !== 'overlay.runtime.auth.open-sign-in') {
                            setError(response.ok ? 'Could not start sign-in.' : response.error)
                            return
                          }
                          void chrome.tabs.create({ url: response.url })
                        })
                      }}
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                    >
                      Connect
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void refreshBootstrap()
                      }}
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                    >
                      Refresh
                    </button>
                  </div>
                  <p className="text-[11px] leading-5 text-[var(--muted)]">
                    Connect opens Overlay sign-in in a new tab. After you land on your account page, the extension saves your session locally—no Overlay tab has to stay open. Press Refresh if the sidebar does not update.
                  </p>
                </div>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}

      <main ref={mainRef} className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-30 shrink-0 border-b border-[var(--border)] bg-[var(--background)]">
          <div className="flex items-center justify-between gap-1.5 px-3 py-2 md:gap-2 md:px-4">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open chats"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            >
              <Menu size={15} strokeWidth={1.75} />
            </button>
            <ComprehensiveModelPicker
              generationMode={generationMode}
              preferences={preferences}
              onPreferencesChange={persistPickerPreferences}
              chatModels={textModels}
              imageModels={IMAGE_MODELS}
              videoModels={VIDEO_MODELS}
              disabled={isRunStreaming}
              className="min-w-0 flex-1"
            />
            {isRunStreaming ? (
              <span
                className="overlay-stream-marker overlay-stream-marker--standalone shrink-0"
                title="Streaming"
                aria-label="Streaming"
              />
            ) : null}
            {browserScope !== 'active-tab' ? (
              <span className="hidden max-w-[5rem] truncate rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)] sm:inline-block">
                {browserScope.replace('-', ' ')}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                void handleCreateConversation()
              }}
              aria-label="New chat"
              title="New chat"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            >
              <Plus size={15} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => {
                void handleDeleteConversation()
              }}
              disabled={!activeConversation}
              aria-label="Delete current conversation"
              title="Delete chat"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
            <div className="relative shrink-0" ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setMoreMenuOpen((o) => !o)}
                aria-label="More options"
                aria-expanded={moreMenuOpen}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              >
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </button>
              {moreMenuOpen ? (
                <div className="absolute right-0 top-full z-50 mt-1 w-[min(100vw-1.5rem,18rem)] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">Browser scope</p>
                  <div className="mt-2">
                    <BrowserScopeBar
                      value={browserScope}
                      onChange={(next) => {
                        void persistConversationSettings({ browserScope: next })
                      }}
                      disabled={isRunStreaming}
                      windowTabCount={windowTabs.length}
                    />
                  </div>
                  {browserScope !== 'active-tab' ? (
                    <div className="mt-3">
                      <TabGroupBadge scope={browserScope} windowTabs={windowTabs} />
                    </div>
                  ) : null}
                  {scopedToolHistory.length > 0 ? (
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">
                        Recent actions ({scopedToolHistory.length})
                      </p>
                      <LocalToolActivity
                        entries={scopedToolHistory}
                        conversationId={activeConversationId}
                        limit={8}
                        embedded
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {controlIndicator ? (
            <div className="pointer-events-none absolute left-0 right-0 top-2 z-20 flex justify-center px-3 md:px-4">
              <div className="pointer-events-auto w-full max-w-lg">
                <ControlHUD indicator={controlIndicator} />
              </div>
            </div>
          ) : null}

          <ChatInterface
            conversation={activeConversation}
            activeRunsByVariant={activeRunsByVariant}
            appBaseUrl={preferences.baseUrl}
            userFirstName={bootstrap?.session?.user.firstName ?? null}
            onEmptyStarterPick={(text) => {
              setDraft(text)
              focusComposer()
            }}
            onFocusComposer={focusComposer}
          />

          {approvals.length > 0 ? (
            <div className="pointer-events-none absolute bottom-[11rem] left-0 right-0 z-20 flex justify-center px-3 md:bottom-[12rem] md:px-4">
              <div className="pointer-events-auto w-full max-w-lg border border-[var(--border)] bg-[var(--background)]/95 shadow-lg backdrop-blur">
                <ApprovalCardStack
                  approvals={approvals}
                  onResolve={(approvalId, decision) => {
                    void handleResolveApproval(approvalId, decision)
                  }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              className="border-t px-4 py-2 text-xs"
              style={{
                background: 'var(--chat-alert-error-bg)',
                borderTopColor: 'var(--chat-alert-error-border)',
                color: 'var(--chat-alert-error-text)',
              }}
            >
              {error}
            </div>
          ) : null}

          {!isPaid && generationMode !== 'text' ? (
            <div className="px-3 pt-1 text-[11px] text-[var(--chat-alert-error-text)] md:px-4">
              Upgrade to a paid plan to generate images and video.
            </div>
          ) : null}
          {runMode === 'act' && actApprovalMode === 'auto' ? (
            <div className="px-3 pt-1 md:px-4">
              <ActAutonomousWarning />
            </div>
          ) : null}

          <ChatComposer
            toolbarAboveTextarea={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setRunMode('chat')}
                    disabled={isRunStreaming}
                    className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors ${
                      runMode === 'chat'
                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                        : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
                    } disabled:opacity-50`}
                  >
                    <MessageSquare size={12} strokeWidth={1.75} />
                    Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setRunMode('act')}
                    disabled={isRunStreaming}
                    className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors ${
                      runMode === 'act'
                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                        : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
                    } disabled:opacity-50`}
                  >
                    <MousePointer2 size={12} strokeWidth={1.75} />
                    Act
                  </button>
                </div>
                {runMode === 'act' ? (
                  <ActApprovalModeMenu
                    value={actApprovalMode}
                    onChange={(next) => {
                      void persistConversationSettings({ actApprovalMode: next })
                    }}
                    disabled={isRunStreaming}
                  />
                ) : null}
              </div>
            }
            attachments={attachments}
            onAddFiles={(files) => {
              void addFiles(files)
            }}
            onRemoveAttachment={removeAttachment}
            generationMode={generationMode}
            onGenerationModeChange={handleSetGenerationMode}
            value={draft}
            placeholder={composerPlaceholder}
            disabled={false}
            loading={isRunStreaming}
            canStop={isRunStreaming}
            onChange={setDraft}
            onSubmit={() => {
              void handleAsk()
            }}
            onStop={() => {
              void handleStopRun()
            }}
            voiceEnabled={voiceEnabled}
            isRecording={isRecording}
            transcribing={transcribing}
            onVoiceStart={() => {
              void handleStartRecord()
            }}
            onVoiceStop={handleStopRecord}
          />
        </div>
      </main>
    </div>
  )
}
