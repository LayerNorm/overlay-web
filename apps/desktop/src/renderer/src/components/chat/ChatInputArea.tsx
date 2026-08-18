/**
 * ChatInputArea — the chat composer.
 *
 * Mirrors the web app's ChatComposer (src/features/chat/components/ChatComposer.tsx):
 * rounded-2xl card, contentEditable MentionInput with inline chips, a 36px
 * controls row (+ attach menu with collision flip, @ mention button, tool
 * chips) and a solid send/stop button. Styled with Tailwind + shared CSS
 * variables inside a `.shared-chat-scope` wrapper.
 */

import React, {
  forwardRef,
  useState,
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  useMemo,
  type ReactNode
} from 'react'
import {
  X,
  Camera,
  Plus,
  AtSign,
  FileText,
  FolderOpen,
  Send,
  Check,
  Image as ImageIcon
} from 'lucide-react'
import type { GenerationMode, VideoSubMode } from '@overlay/chat-core'
import type { ChatModel, Screenshot } from './types'
import { CUSTOM_AUTH_BASE_URL } from '../../services/auth-service'
import type { PanelTheme } from '../../hooks/usePanelTheme'
import { MentionInput, type Mention, type MentionInputHandle } from './MentionInput'
import { REQUESTED_TOOL_OPTIONS, type RequestedToolId } from './requested-tools'
import { ModelDropdown } from './ModelDropdown'
import { Tooltip } from '../ui/Tooltip'
import { useSubscription } from '../../hooks/useSubscription'
import { panelThemeToSharedCssVars } from './themeBridge'
import { screenshotUrl } from '../../utils/chatMediaPersistence'
import { useAppBootstrap } from '../../contexts/AppBootstrapContext'
import { DesktopMediaComposerControls } from './DesktopMediaComposerControls'
import {
  canSubmitDesktopMediaDraft,
  useDesktopMediaComposerState
} from './useDesktopMediaComposerState'

import overlayLogoUrl from '../../../../../resources/logos/logo-big-no-bg.png'

const AGENT_TRIGGER = '@agent'

export interface ChatSendOptions {
  requestedTools: RequestedToolId[]
  memoryEnabled: boolean
  mentions?: Mention[]
  generationMode: GenerationMode
  mediaModelIds?: string[]
  videoSubMode?: VideoSubMode
}

export interface ChatInputAreaHandle {
  focus: () => void
  clear: () => void
  getValue: () => string
  setValue: (value: string) => void
  insertText: (value: string) => void
  getMentions: () => Mention[]
  setMentions: (mentions: Mention[]) => void
  getScreenshots: () => Screenshot[]
  setScreenshots: (screenshots: Screenshot[]) => void
  getElement: () => HTMLElement | null
}

interface ChatInputAreaProps {
  theme: PanelTheme
  models: ChatModel[]
  selectedModels: ChatModel[]
  onModelSelect: (model: ChatModel) => void
  supportsVision: boolean
  placeholder?: string
  dropdownDirection?: 'up' | 'down'
  onSend: (
    message: string,
    screenshots: Screenshot[],
    isAgentMode?: boolean,
    options?: ChatSendOptions
  ) => void
  /**
   * Optional seed text. Draft text is owned by this component so typing does not
   * re-render the surrounding chat panel. Prefer the imperative handle for
   * programmatic updates (reply, paste from bridge, clear).
   */
  initialValue?: string
  /** @deprecated Use the imperative handle instead of controlled inputValue. */
  inputValue?: string
  /** @deprecated Use the imperative handle instead of controlled onInputChange. */
  onInputChange?: (value: string) => void
  screenshots?: Screenshot[]
  onScreenshotsChange?: (screenshots: Screenshot[]) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  // External ref for focusing the editor
  textareaRef?: React.RefObject<HTMLDivElement | null>
  // When true, the middle spacer acts as a window drag region
  embedded?: boolean
  // Memory toggle
  memoryEnabled?: boolean
  onToggleMemory?: () => void
  // Search toggle (web search via AI Gateway)
  searchEnabled?: boolean
  onToggleSearch?: () => void
  // Agent mode
  agentModeEnabled?: boolean
  onAgentModeChange?: (enabled: boolean) => void
  // Chat mode. Kept for model picker behavior; the visible ask/write toggle is intentionally removed.
  chatMode?: 'ask' | 'write'
  onChatModeChange?: (mode: 'ask' | 'write') => void
  // Chat ID for document association
  chatId?: string
  // Mentions (@ references)
  mentions?: Mention[]
  onMentionsChange?: (mentions: Mention[]) => void
  folderId?: string
  // Container ref for dropdown boundary detection (prevents overflow)
  containerRef?: React.RefObject<HTMLElement | null>
  // Force single selection (no checkboxes) even in ask mode - used for embedded panels
  forceSingleSelect?: boolean
  // Streaming state - when true, shows stop button instead of send
  isStreaming?: boolean
  // Callback when stop button is clicked
  onStop?: () => void
  // Working folder for agent sandboxed environment
  workingFolder?: string | null
  onWorkingFolderChange?: (folder: string | null) => void
  // When false, hides the inline model selector (the view header hosts it instead)
  showModelSelector?: boolean
  // Embedded sidebars can use the header's model picker and omit media-only controls.
  showMediaControls?: boolean
  showScreenshotControl?: boolean
}

const ICON_BUTTON_CLASS =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]'

function AttachMenuButton({
  active,
  disabled,
  onClick,
  icon,
  label,
  suffix,
  showSwitch,
  checked,
  neutralWhenActive
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  suffix?: string
  showSwitch?: boolean
  checked?: boolean
  neutralWhenActive?: boolean
}): React.ReactElement<any> {
  const activeClass =
    active && !neutralWhenActive
      ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
      : 'text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
        disabled ? 'cursor-not-allowed text-[var(--muted-light)] opacity-60' : activeClass
      }`}
    >
      {icon}
      <span>{label}</span>
      {showSwitch ? (
        <span
          className={`ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
            active ? 'bg-[var(--foreground)]' : 'bg-[var(--border)]'
          }`}
        >
          <span
            className={`h-3 w-3 rounded-full bg-[var(--surface-elevated)] transition-transform ${
              active ? 'translate-x-3' : ''
            }`}
          />
        </span>
      ) : checked ? (
        <Check size={11} strokeWidth={1.8} className="ml-auto shrink-0 text-[var(--foreground)]" />
      ) : suffix ? (
        <span className="ml-auto max-w-[6.75rem] truncate text-[10px] text-[var(--muted-light)]">
          {suffix}
        </span>
      ) : null}
    </button>
  )
}

function ToolRequestChip({
  label,
  icon,
  onClear
}: {
  label: string
  icon: ReactNode
  onClear: () => void
}): React.ReactElement<any> {
  return (
    <div className="group flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-xs font-medium text-[var(--foreground)]">
      <button
        type="button"
        onClick={onClear}
        className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
        aria-label={`Remove ${label}`}
      >
        <span className="absolute opacity-100 transition-opacity group-hover:opacity-0">
          {icon}
        </span>
        <X
          size={10}
          strokeWidth={1.8}
          className="absolute opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
      <span>{label}</span>
    </div>
  )
}

export const ChatInputArea = forwardRef<ChatInputAreaHandle, ChatInputAreaProps>(
  function ChatInputArea(
    {
      theme,
      models,
      selectedModels,
      onModelSelect,
      supportsVision,
      placeholder = 'Type a message...',
      dropdownDirection: _dropdownDirection = 'down',
      onSend,
      initialValue = '',
      inputValue: controlledInputValue,
      onInputChange,
      screenshots: controlledScreenshots,
      onScreenshotsChange,
      onKeyDown: externalKeyDown,
      textareaRef: externalEditorRef,
      embedded,
      memoryEnabled,
      onToggleMemory,
      searchEnabled,
      onToggleSearch,
      agentModeEnabled = false,
      onAgentModeChange,
      chatMode,
      chatId,
      mentions: controlledMentions,
      onMentionsChange,
      folderId,
      containerRef,
      forceSingleSelect = false,
      isStreaming = false,
      onStop,
      workingFolder,
      onWorkingFolderChange,
      showModelSelector = true,
      showMediaControls = true,
      showScreenshotControl = true
    },
    ref
  ): React.ReactElement<any> {
    // Subscription state for upgrade tip
    const subscription = useSubscription()
    const { bootstrap, imageModels, videoModels, uiSettings } = useAppBootstrap()
    const mediaComposer = useDesktopMediaComposerState({
      imageModels,
      videoModels,
      defaultImageModelId: bootstrap?.defaults?.imageModelId ?? uiSettings?.defaultImageModelId,
      defaultVideoModelId: bootstrap?.defaults?.videoModelId ?? uiSettings?.defaultVideoModelId,
      isFreeTier: subscription.tier === 'free'
    })
    const {
      generationMode,
      setGenerationMode,
      selectedImageModelIds,
      selectedVideoModelIds,
      videoSubMode
    } = mediaComposer
    void _dropdownDirection
    void searchEnabled
    void onToggleSearch
    const isPremiumModelSelected = selectedModels.length > 0 && selectedModels[0].cost !== 0
    const showUpgradeTip =
      generationMode === 'text' && subscription.tier === 'free' && isPremiumModelSelected
    const canAttachImages = generationMode !== 'text' || supportsVision

    // Draft text is local by default so typing does not re-render the host chat panel.
    // Legacy controlled props still work for gradual migration.
    const isControlledText = controlledInputValue !== undefined
    const [internalInputValue, setInternalInputValue] = useState(initialValue)
    const inputValueRef = useRef(isControlledText ? controlledInputValue : initialValue)
    const [internalScreenshots, setInternalScreenshots] = useState<Screenshot[]>([])
    const [internalMentions, setInternalMentions] = useState<Mention[]>([])
    const [showModelDropdown, setShowModelDropdown] = useState(false)
    const [showPlusDropdown, setShowPlusDropdown] = useState(false)
    const [plusMenuDirection, setPlusMenuDirection] = useState<'up' | 'down'>('up')
    const [temporaryMemoryEnabled, setTemporaryMemoryEnabled] = useState(false)
    const [requestedTools, setRequestedTools] = useState<RequestedToolId[]>([])
    const [previewImage, setPreviewImage] = useState<{ src: string; name?: string } | null>(null)
    const [isMentionPopupVisible, setIsMentionPopupVisible] = useState(false)
    const inputValue = isControlledText ? controlledInputValue : internalInputValue
    inputValueRef.current = inputValue

    const setDraftValue = useCallback(
      (next: string | ((previous: string) => string)) => {
        const resolved = typeof next === 'function' ? next(inputValueRef.current) : next
        inputValueRef.current = resolved
        if (isControlledText) {
          onInputChange?.(resolved)
        } else {
          setInternalInputValue(resolved)
        }
      },
      [isControlledText, onInputChange]
    )

    const screenshots = controlledScreenshots ?? internalScreenshots
    const mentions = controlledMentions ?? internalMentions
    const mentionsRef = useRef(mentions)
    mentionsRef.current = mentions

    const updateScreenshots = useCallback(
      (newScreenshots: Screenshot[]) => {
        if (onScreenshotsChange) {
          onScreenshotsChange(newScreenshots)
        } else {
          setInternalScreenshots(newScreenshots)
        }
      },
      [onScreenshotsChange]
    )

    const updateMentions = useCallback(
      (newMentions: Mention[]) => {
        if (onMentionsChange) {
          onMentionsChange(newMentions)
        } else {
          setInternalMentions(newMentions)
        }
      },
      [onMentionsChange]
    )

    const editorRef = useRef<MentionInputHandle>(null)
    /** Mentions currently represented as chips inside the editor. */
    const editorMentionIdsRef = useRef<Set<string>>(new Set())
    const plusDropdownRef = useRef<HTMLDivElement>(null)
    const modelDropdownRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const isTemporaryChat = !chatId
    const effectiveMemoryEnabled = isTemporaryChat
      ? temporaryMemoryEnabled
      : (memoryEnabled ?? true)

    // Compute the effective placeholder with Claude hint for agent modes
    const isAgentModeActive = agentModeEnabled || chatMode === 'write'
    const effectivePlaceholder =
      isAgentModeActive && placeholder.includes('task')
        ? `${placeholder} Claude or Kimi models work best for agents.`
        : placeholder

    // Bridge the external "textarea" ref to the contentEditable editor element
    useEffect(() => {
      if (!externalEditorRef) return
      externalEditorRef.current = editorRef.current?.getElement() ?? null
    })

    const focusEditor = useCallback(() => {
      editorRef.current?.focus()
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          focusEditor()
        },
        clear: () => {
          setDraftValue('')
          editorRef.current?.clear()
          editorMentionIdsRef.current = new Set()
          updateScreenshots([])
          updateMentions([])
          setRequestedTools([])
        },
        getValue: () => inputValueRef.current,
        setValue: (value: string) => {
          setDraftValue(value)
          editorRef.current?.setPlainText(value)
          editorMentionIdsRef.current = new Set()
          requestAnimationFrame(() => focusEditor())
        },
        insertText: (value: string) => {
          const next = inputValueRef.current ? `${inputValueRef.current}${value}` : value
          setDraftValue(next)
          editorRef.current?.setPlainText(next)
          requestAnimationFrame(() => focusEditor())
        },
        getMentions: () => mentionsRef.current,
        setMentions: (next) => updateMentions(next),
        getScreenshots: () => screenshots,
        setScreenshots: (next) => updateScreenshots(next),
        getElement: () => editorRef.current?.getElement() ?? null
      }),
      [focusEditor, screenshots, setDraftValue, updateMentions, updateScreenshots]
    )

    // Close the plus dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent): void => {
        if (plusDropdownRef.current && !plusDropdownRef.current.contains(event.target as Node)) {
          setShowPlusDropdown(false)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Editor text changes: keep draft state in sync and detect @agent trigger
    const handleEditorChange = useCallback(
      (text: string) => {
        const trimmed = text.trim().toLowerCase()
        if (trimmed.startsWith(AGENT_TRIGGER) && !agentModeEnabled && onAgentModeChange) {
          onAgentModeChange(true)
          const newValue = text.replace(/^\s*@agent\s*/i, '')
          setDraftValue(newValue)
          editorRef.current?.setPlainText(newValue)
          return
        }
        setDraftValue(text)
      },
      [agentModeEnabled, onAgentModeChange, setDraftValue]
    )

    // Editor chip changes: merge with externally-attached mentions (documents
    // added via the + menu are not chips inside the editor).
    const handleEditorMentionsChange = useCallback(
      (editorMentions: Mention[]) => {
        const previousEditorIds = editorMentionIdsRef.current
        const externals = mentionsRef.current.filter((m) => !previousEditorIds.has(m.id))
        editorMentionIdsRef.current = new Set(editorMentions.map((m) => m.id))
        const merged = [...externals, ...editorMentions]
        const changed =
          merged.length !== mentionsRef.current.length ||
          merged.some((m, i) => mentionsRef.current[i]?.id !== m.id)
        if (changed) updateMentions(merged)
      },
      [updateMentions]
    )

    const externalMentions = useMemo(
      () => mentions.filter((m) => !editorMentionIdsRef.current.has(m.id)),
      [mentions]
    )

    const handleSendMessage = useCallback((): void => {
      const draft = inputValueRef.current
      if (
        canSubmitDesktopMediaDraft({
          generationMode,
          prompt: draft,
          attachmentCount: screenshots.length,
          selectedImageModelIds,
          selectedVideoModelIds,
          videoSubMode
        })
      ) {
        const effectiveAgentMode = agentModeEnabled || chatMode === 'write'
        onSend(draft.trim(), screenshots, effectiveAgentMode, {
          requestedTools,
          memoryEnabled: effectiveMemoryEnabled,
          mentions: mentionsRef.current.length > 0 ? [...mentionsRef.current] : undefined,
          generationMode,
          mediaModelIds:
            generationMode === 'image'
              ? selectedImageModelIds
              : generationMode === 'video'
                ? selectedVideoModelIds
                : undefined,
          videoSubMode: generationMode === 'video' ? videoSubMode : undefined
        })
        setDraftValue('')
        editorRef.current?.clear()
        editorMentionIdsRef.current = new Set()
        updateScreenshots([])
        updateMentions([])
        setRequestedTools([])
        if (isTemporaryChat) {
          setTemporaryMemoryEnabled(false)
        }
      }
    }, [
      agentModeEnabled,
      chatMode,
      effectiveMemoryEnabled,
      generationMode,
      isTemporaryChat,
      onSend,
      requestedTools,
      selectedImageModelIds,
      selectedVideoModelIds,
      screenshots,
      setDraftValue,
      updateMentions,
      updateScreenshots,
      videoSubMode
    ])

    const addRequestedTool = (toolId: RequestedToolId): void => {
      setRequestedTools((prev) => (prev.includes(toolId) ? prev : [...prev, toolId]))
      if (toolId === 'memory' && !effectiveMemoryEnabled) {
        if (isTemporaryChat) {
          setTemporaryMemoryEnabled(true)
        } else {
          onToggleMemory?.()
        }
      }
      setShowPlusDropdown(false)
      focusEditor()
    }

    const removeRequestedTool = (toolId: RequestedToolId): void => {
      setRequestedTools((prev) => prev.filter((id) => id !== toolId))
    }

    const handleToggleMemory = (): void => {
      const willEnableMemory = !effectiveMemoryEnabled
      if (!willEnableMemory) {
        setRequestedTools((prev) => prev.filter((id) => id !== 'memory'))
      }
      if (isTemporaryChat) {
        setTemporaryMemoryEnabled((prev) => !prev)
      } else {
        onToggleMemory?.()
      }
    }

    const handleEditorKeyDown = useCallback(
      (e: React.KeyboardEvent): void => {
        if (externalKeyDown) {
          externalKeyDown(e)
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented && !isMentionPopupVisible) {
          e.preventDefault()
          handleSendMessage()
        }
      },
      [externalKeyDown, handleSendMessage, isMentionPopupVisible]
    )

    const handleFileAttachment = (): void => {
      if (!canAttachImages) return
      fileInputRef.current?.click()
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const files = e.target.files
      if (!files || files.length === 0) return

      const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const newScreenshots: Screenshot[] = []
      let loadedCount = 0

      imageFiles.forEach((file) => {
        const reader = new FileReader()
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string
          newScreenshots.push({
            dataUrl,
            displayId: `file-${Date.now()}-${Math.random()}`,
            name: file.name
          })
          loadedCount++
          if (loadedCount === imageFiles.length) {
            updateScreenshots([...screenshots, ...newScreenshots])
          }
        }
        reader.readAsDataURL(file)
      })

      e.target.value = ''
    }

    const captureScreenshot = async (): Promise<void> => {
      if (!canAttachImages) return
      try {
        const capturedScreenshots = await window.bridge.captureScreenshots()
        if (capturedScreenshots && capturedScreenshots.length > 0) {
          updateScreenshots(capturedScreenshots)
        }
      } catch (error) {
        console.error('Failed to capture screenshot:', error)
      }
    }

    const removeScreenshot = useCallback(
      (displayId: string): void => {
        updateScreenshots(screenshots.filter((s) => s.displayId !== displayId))
      },
      [screenshots, updateScreenshots]
    )

    const attachDocument = useCallback(async (): Promise<void> => {
      try {
        const dialogResult = await window.bridge.document.ingestDialog({
          chatId,
          folderId
        })
        if (dialogResult.success && dialogResult.document?.id && dialogResult.document?.filename) {
          const docId = dialogResult.document.id
          const docName = dialogResult.document.filename
          const newMention: Mention = {
            id: docId,
            type: 'document',
            title: docName,
            preview: 'Attached document',
            filename: docName
          }
          updateMentions([...mentionsRef.current, newMention])
        }
      } catch (err) {
        console.error('[ChatInputArea] Failed to ingest document:', err)
      }
    }, [chatId, folderId, updateMentions])

    const handlePlusToggle = (event: React.MouseEvent<HTMLButtonElement>): void => {
      const rect = event.currentTarget.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      setPlusMenuDirection(spaceBelow < 340 && spaceAbove > spaceBelow ? 'up' : 'down')
      setShowPlusDropdown((value) => !value)
    }

    const scopeStyle = useMemo(() => panelThemeToSharedCssVars(theme, overlayLogoUrl), [theme])

    const hasSendableContent = canSubmitDesktopMediaDraft({
      generationMode,
      prompt: inputValue,
      attachmentCount: screenshots.length,
      selectedImageModelIds,
      selectedVideoModelIds,
      videoSubMode
    })

    return (
      <div className="shared-chat-scope" style={scopeStyle as React.CSSProperties}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Image preview modal */}
        {previewImage && (
          <div
            onClick={() => setPreviewImage(null)}
            className="fixed inset-0 z-[1000] flex cursor-pointer items-center justify-center bg-black/85"
          >
            <img
              src={previewImage.src}
              alt={previewImage.name || 'Preview'}
              className="max-h-[90%] max-w-[90%] rounded-lg object-contain"
            />
          </div>
        )}

        <div className="overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[background-color,border-color,box-shadow,color] duration-300">
          <div className="p-2.5 sm:p-3">
            {/* Screenshot thumbnails */}
            {screenshots.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {screenshots.map((screenshot) => (
                  <div
                    key={screenshot.displayId}
                    className="relative h-16 w-16 cursor-pointer overflow-hidden rounded-lg border border-[var(--border)]"
                    onClick={() =>
                      setPreviewImage({ src: screenshotUrl(screenshot), name: screenshot.name })
                    }
                  >
                    <img
                      src={screenshotUrl(screenshot)}
                      alt={screenshot.name || 'Screenshot'}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeScreenshot(screenshot.displayId)
                      }}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-opacity hover:bg-black/80"
                      aria-label="Remove screenshot"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Externally attached mentions (documents from the + menu) */}
            {externalMentions.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {externalMentions.map((mention) => (
                  <span
                    key={mention.id}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-xs font-medium text-[var(--foreground)]"
                  >
                    <FileText
                      size={11}
                      strokeWidth={1.75}
                      className="shrink-0 text-[var(--muted)]"
                    />
                    <span className="max-w-[150px] truncate">{mention.title}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateMentions(mentionsRef.current.filter((m) => m.id !== mention.id))
                      }
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
                      aria-label={`Remove ${mention.title}`}
                    >
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* ContentEditable editor with inline mention chips */}
            <MentionInput
              ref={editorRef}
              value={inputValue}
              onChange={handleEditorChange}
              onMentionsChange={handleEditorMentionsChange}
              onKeyDown={handleEditorKeyDown}
              onUploadFile={() => void attachDocument()}
              placeholder={effectivePlaceholder}
              folderId={folderId}
              workingFolder={workingFolder}
              onPopupVisibleChange={setIsMentionPopupVisible}
            />

            {/* Controls row */}
            <div className="mt-2 flex min-h-9 items-center gap-2">
              {/* Plus / attach menu */}
              <div ref={plusDropdownRef} className="relative shrink-0">
                <Tooltip content="Add attachments & options">
                  <button
                    type="button"
                    onClick={handlePlusToggle}
                    className={ICON_BUTTON_CLASS}
                    aria-label="Open attachment and tools menu"
                  >
                    <Plus
                      size={18}
                      strokeWidth={1.75}
                      className={`transition-transform duration-200 ${showPlusDropdown ? 'rotate-45' : ''}`}
                    />
                  </button>
                </Tooltip>
                {showPlusDropdown && (
                  <div
                    className={`absolute left-0 z-20 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg ${
                      plusMenuDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
                    }`}
                  >
                    <AttachMenuButton
                      onClick={() => {
                        setShowPlusDropdown(false)
                        handleFileAttachment()
                      }}
                      disabled={!canAttachImages}
                      icon={<ImageIcon size={13} strokeWidth={1.75} />}
                      label="Add photos"
                      suffix={canAttachImages ? 'Images' : 'Needs vision model'}
                    />
                    <AttachMenuButton
                      onClick={() => {
                        setShowPlusDropdown(false)
                        void attachDocument()
                      }}
                      icon={<FileText size={13} strokeWidth={1.75} />}
                      label="Add documents"
                      suffix="PDF, docs, text"
                    />
                    <AttachMenuButton
                      onClick={() => {
                        setShowPlusDropdown(false)
                        editorRef.current?.openMentionPopup()
                      }}
                      icon={<AtSign size={13} strokeWidth={1.75} />}
                      label="Add mentions"
                      suffix="Notes, chats, files"
                    />
                    <div className="my-1 border-t border-[var(--border)]" />
                    {REQUESTED_TOOL_OPTIONS.map((tool) => {
                      const Icon = tool.icon
                      const isSelected = requestedTools.includes(tool.id)
                      const isUnavailable = tool.id === 'memory' && !effectiveMemoryEnabled
                      return (
                        <AttachMenuButton
                          key={tool.id}
                          active={isSelected}
                          onClick={() => addRequestedTool(tool.id)}
                          icon={<Icon size={13} strokeWidth={1.75} />}
                          label={tool.label}
                          suffix={
                            isSelected ? undefined : isUnavailable ? 'Enables memory' : undefined
                          }
                          checked={isSelected}
                        />
                      )
                    })}
                    {(onToggleMemory || isTemporaryChat) && (
                      <>
                        <div className="my-1 border-t border-[var(--border)]" />
                        <AttachMenuButton
                          active={effectiveMemoryEnabled}
                          onClick={handleToggleMemory}
                          icon={<Check size={13} strokeWidth={1.75} className="opacity-0" />}
                          label="Memory"
                          showSwitch
                          neutralWhenActive
                        />
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* @ mention button */}
              <Tooltip content="Reference files, chats, or notes">
                <button
                  type="button"
                  onClick={() => editorRef.current?.openMentionPopup()}
                  className={ICON_BUTTON_CLASS}
                  aria-label="Insert mention"
                >
                  <AtSign size={16} strokeWidth={1.75} />
                </button>
              </Tooltip>

              {/* Camera/Screenshot button */}
              {showScreenshotControl ? (
                <Tooltip
                  content={
                    canAttachImages
                      ? 'Capture screenshot'
                      : 'Select a vision model to capture screenshots'
                  }
                >
                  <button
                    type="button"
                    onClick={() => void captureScreenshot()}
                    disabled={!canAttachImages}
                    className={`${ICON_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent`}
                    aria-label="Capture screenshot"
                  >
                    <Camera size={16} strokeWidth={1.75} />
                  </button>
                </Tooltip>
              ) : null}

              {/* Working folder */}
              {workingFolder ? (
                <button
                  type="button"
                  onClick={() => onWorkingFolderChange?.(null)}
                  className="group flex h-7 max-w-40 shrink-0 items-center gap-1.5 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
                  title={workingFolder}
                >
                  <FolderOpen
                    size={12}
                    strokeWidth={1.75}
                    className="shrink-0 text-[var(--muted)]"
                  />
                  <span className="truncate">
                    {workingFolder.split('/').pop() || workingFolder}
                  </span>
                  <X
                    size={10}
                    strokeWidth={1.8}
                    className="shrink-0 text-[var(--muted)] group-hover:text-[var(--foreground)]"
                  />
                </button>
              ) : (
                onWorkingFolderChange && (
                  <Tooltip content="Work in folder">
                    <button
                      type="button"
                      onClick={async () => {
                        const result = await window.bridge.pickWorkingFolder()
                        if (!result.cancelled && result.path) {
                          onWorkingFolderChange?.(result.path)
                        }
                      }}
                      className={ICON_BUTTON_CLASS}
                      aria-label="Choose working folder"
                    >
                      <FolderOpen size={16} strokeWidth={1.75} />
                    </button>
                  </Tooltip>
                )
              )}

              {/* Tool request chips */}
              {requestedTools.length > 0 && (
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {REQUESTED_TOOL_OPTIONS.filter((tool) => requestedTools.includes(tool.id)).map(
                    (tool) => {
                      const Icon = tool.icon
                      return (
                        <ToolRequestChip
                          key={tool.id}
                          label={tool.label}
                          icon={<Icon size={11} strokeWidth={1.75} />}
                          onClear={() => removeRequestedTool(tool.id)}
                        />
                      )
                    }
                  )}
                </div>
              )}

              {/* Spacer (window drag region when embedded) */}
              <div
                className="h-7 min-w-3 flex-1"
                style={embedded ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
              />

              {showMediaControls ? (
                <DesktopMediaComposerControls
                  generationMode={generationMode}
                  onGenerationModeChange={(nextMode) => {
                    setGenerationMode(nextMode)
                    setShowModelDropdown(false)
                  }}
                  imageModels={imageModels}
                  videoModels={videoModels}
                  selectedImageModelIds={selectedImageModelIds}
                  selectedVideoModelIds={selectedVideoModelIds}
                  imageModelSelectionMode={mediaComposer.imageModelSelectionMode}
                  videoModelSelectionMode={mediaComposer.videoModelSelectionMode}
                  onImageModelSelectionModeChange={mediaComposer.setImageModelSelectionMode}
                  onVideoModelSelectionModeChange={mediaComposer.setVideoModelSelectionMode}
                  onToggleImageModel={mediaComposer.toggleImageModel}
                  onToggleVideoModel={mediaComposer.toggleVideoModel}
                  videoSubMode={videoSubMode}
                  onVideoSubModeChange={mediaComposer.setVideoSubMode}
                  isFreeTier={subscription.tier === 'free'}
                  disabled={isStreaming}
                />
              ) : null}

              {/* Upgrade tip for free users with premium model selected */}
              {showUpgradeTip && (
                <a
                  href={`${CUSTOM_AUTH_BASE_URL}/pricing`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1 rounded-md border border-[#eab308]/30 bg-[#eab308]/15 px-2 py-1 text-[11px] font-medium text-[#eab308] no-underline transition-colors hover:bg-[#eab308]/25"
                >
                  Upgrade
                </a>
              )}

              {/* Model selector */}
              {showModelSelector && generationMode === 'text' && (
                <ModelDropdown
                  models={models}
                  selectedModels={selectedModels}
                  showDropdown={showModelDropdown}
                  setShowDropdown={setShowModelDropdown}
                  setSelectedModels={(newModels) => {
                    const added = newModels.find((m) => !selectedModels.some((s) => s.id === m.id))
                    const removed = selectedModels.find(
                      (s) => !newModels.some((m) => m.id === s.id)
                    )
                    const changedModel = added || removed
                    if (changedModel) {
                      onModelSelect(changedModel)
                    }
                  }}
                  dropdownRef={modelDropdownRef as React.RefObject<HTMLDivElement | null>}
                  theme={theme}
                  hasDocuments={mentions.some((m) => m.type === 'document')}
                  isAgentMode={agentModeEnabled || chatMode === 'write'}
                  allowMultiSelect={!forceSingleSelect && !agentModeEnabled && chatMode !== 'write'}
                  containerRef={containerRef}
                />
              )}

              {/* Send / Stop button */}
              {isStreaming && onStop ? (
                <Tooltip content="Stop response">
                  <button
                    type="button"
                    onClick={onStop}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-opacity hover:opacity-80"
                    aria-label="Stop response"
                  >
                    <div className="h-3.5 w-3.5 rounded-sm bg-current" />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content="Send (↵) · new line (⇧↵)">
                  <button
                    type="button"
                    onClick={handleSendMessage}
                    disabled={!hasSendableContent}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Send message"
                  >
                    <Send size={17} strokeWidth={1.75} />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
)
