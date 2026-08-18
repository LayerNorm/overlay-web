import React, { useState, useRef, useEffect, useCallback } from 'react'
import { X, Plus } from 'lucide-react'
import type { ChatModel } from '../chat/types'
import type { Mention } from '../chat/MentionInput'
import { ChatInputArea } from '../chat/ChatInputArea'
import {
  EmbeddedChatTranscript,
  type EmbeddedChatItem,
  type EmbeddedPlanStep
} from '../chat/EmbeddedChatTranscript'
import {
  indexBrowserSessionSnapshot,
  indexMentionReferences,
  runAfterUi,
  runInBackground
} from '../../utils/knowledgeIndexing'
import { useAppBootstrap } from '../../contexts/AppBootstrapContext'
import { filterToEnabledChatModels } from '../../utils/enabledChatModels'

// ── Types ──────────────────────────────────────────────────────────────────────

export type BrowserChatMode = 'ask' | 'act'

export interface BrowserAgentStep {
  type:
    | 'plan'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'text'
    | 'done'
    | 'error'
    | 'max_steps_reached'
  plan?: string
  thinking?: string
  tool?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  text?: string
  error?: string
  step?: number
  timestamp: number
}

export type BrowserChatItem = EmbeddedChatItem

// Task plan step for tracking agent progress
export type TaskPlanStep = EmbeddedPlanStep

interface BrowserAgentChatProps {
  theme: {
    text: string
    textSecondary: string
    background: string
    surface: string
    border: string
    isDark: boolean
  }
  onClose: () => void
  activeTabId: string | null
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function BrowserAgentChat({
  theme,
  onClose,
  activeTabId
}: BrowserAgentChatProps): React.ReactElement<any> {
  const { chatModels, bootstrap } = useAppBootstrap()
  // Chat state - persist Ask/Act toggle across sessions
  const [chatMode, setChatMode] = useState<BrowserChatMode>(() => {
    const saved = localStorage.getItem('browserAgent.chatMode')
    return saved === 'act' || saved === 'ask' ? saved : 'ask'
  })
  const [chatInput, setChatInput] = useState('')

  // Persist chatMode changes to localStorage
  useEffect(() => {
    localStorage.setItem('browserAgent.chatMode', chatMode)
  }, [chatMode])
  const [chatItems, setChatItems] = useState<BrowserChatItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const chatMessagesEndRef = useRef<HTMLDivElement>(null)

  // Model state
  const [models, setModels] = useState<ChatModel[]>([])
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null)

  // Container ref for dropdown boundary detection
  const chatContainerRef = useRef<HTMLDivElement>(null)

  // Agent state for Act mode
  const agentCancelRef = useRef<(() => void) | null>(null)
  const [taskPlan, setTaskPlan] = useState<TaskPlanStep[]>([])
  const [completedStepCount, setCompletedStepCount] = useState(0)
  const [maxStepsReached, setMaxStepsReached] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [mentions, setMentions] = useState<Mention[]>([])

  // Conversation history for context continuity across messages
  const [conversationHistory, setConversationHistory] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([])

  // Session management state
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<
    Array<{ id: string; title: string; createdAt: number; updatedAt: number; mode: 'ask' | 'act' }>
  >([])

  // Placeholders based on mode
  const placeholder =
    chatMode === 'ask' ? 'Ask overlay about this page...' : 'Describe a task to overlay agent.'

  const indexCurrentSessionForKnowledge = useCallback(async (): Promise<void> => {
    if (!currentSessionId || conversationHistory.length === 0) return

    const existingSession = await window.bridge.browserChatSessions.get(currentSessionId)
    const sessionTitle =
      existingSession?.title ||
      conversationHistory.find((message) => message.role === 'user')?.content.slice(0, 50) ||
      'New Chat'

    await indexBrowserSessionSnapshot({
      id: currentSessionId,
      title: sessionTitle,
      messages: conversationHistory,
      createdAt: existingSession?.createdAt,
      updatedAt: existingSession?.updatedAt
    })
  }, [currentSessionId, conversationHistory])

  // Load models from the enabled catalog only
  useEffect(() => {
    try {
      const enabledModels = filterToEnabledChatModels(
        chatModels.filter((m) => !m.disabled),
        bootstrap?.uiSettings?.enabledChatModelIds
      )
      setModels(enabledModels)

      // Select default model
      const savedModelId = localStorage.getItem('browserChat.selectedModelId')
      let modelToSelect: ChatModel | undefined

      if (savedModelId) {
        modelToSelect = enabledModels.find((m) => m.id === savedModelId)
      }

      if (!modelToSelect) {
        modelToSelect =
          enabledModels.find((m) => m.id === bootstrap?.defaults?.chatModelId) ||
          enabledModels.find((m) => m.supportsVision && m.provider === 'groq') ||
          enabledModels.find((m) => m.provider === 'groq') ||
          enabledModels[0]
      }

      if (modelToSelect) {
        setSelectedModel(modelToSelect)
      }
    } catch (error) {
      console.error('Failed to load models:', error)
    }
  }, [chatModels, bootstrap?.defaults?.chatModelId, bootstrap?.uiSettings?.enabledChatModelIds])

  // Persist selected model
  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem('browserChat.selectedModelId', selectedModel.id)
    }
  }, [selectedModel])

  // Scroll to bottom on new messages
  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatItems])

  // Load sessions on mount
  useEffect(() => {
    const loadSessions = async (): Promise<void> => {
      try {
        const sessionList = await window.bridge.browserChatSessions.list()
        setSessions(
          sessionList.map((s) => ({
            id: s.id,
            title: s.title,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            mode: s.mode
          }))
        )
      } catch (error) {
        console.error('[BrowserAgentChat] Failed to load sessions:', error)
      }
    }
    loadSessions()
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      runInBackground(indexCurrentSessionForKnowledge, 'Failed to index browser session on unload')
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [indexCurrentSessionForKnowledge])

  // Auto-save session when conversation history changes
  useEffect(() => {
    if (conversationHistory.length === 0) return

    const saveSession = async (): Promise<void> => {
      try {
        if (currentSessionId) {
          await window.bridge.browserChatSessions.update(currentSessionId, {
            messages: conversationHistory,
            mode: chatMode
          })
        } else {
          const newSession = await window.bridge.browserChatSessions.create(chatMode)
          setCurrentSessionId(newSession.id)
          await window.bridge.browserChatSessions.update(newSession.id, {
            messages: conversationHistory
          })
          // Refresh sessions list
          const sessionList = await window.bridge.browserChatSessions.list()
          setSessions(
            sessionList.map((s) => ({
              id: s.id,
              title: s.title,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
              mode: s.mode
            }))
          )
        }
      } catch (error) {
        console.error('[BrowserAgentChat] Failed to save session:', error)
      }
    }
    saveSession()
  }, [conversationHistory, currentSessionId, chatMode])

  // Load a session from history
  const loadSession = useCallback(
    async (sessionId: string) => {
      try {
        if (currentSessionId && currentSessionId !== sessionId) {
          runInBackground(indexCurrentSessionForKnowledge, 'Failed to index browser session')
        }
        const session = await window.bridge.browserChatSessions.get(sessionId)
        if (session) {
          setCurrentSessionId(session.id)
          setChatMode(session.mode)
          setConversationHistory(session.messages)
          // Rebuild chat items from messages
          const items: BrowserChatItem[] = session.messages.map((msg) =>
            msg.role === 'user'
              ? { type: 'user' as const, text: msg.content }
              : { type: 'text' as const, text: msg.content }
          )
          setChatItems(items)
          setShowHistory(false)
        }
      } catch (error) {
        console.error('[BrowserAgentChat] Failed to load session:', error)
      }
    },
    [currentSessionId, indexCurrentSessionForKnowledge]
  )

  // Delete a session
  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await window.bridge.browserChatSessions.delete(sessionId)
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        if (currentSessionId === sessionId) {
          setCurrentSessionId(null)
          setChatItems([])
          setConversationHistory([])
        }
      } catch (error) {
        console.error('[BrowserAgentChat] Failed to delete session:', error)
      }
    },
    [currentSessionId]
  )

  // Start new chat
  const startNewChat = useCallback(() => {
    runInBackground(indexCurrentSessionForKnowledge, 'Failed to index browser session')
    setCurrentSessionId(null)
    setChatItems([])
    setTaskPlan([])
    setCompletedStepCount(0)
    setMaxStepsReached(false)
    setConversationHistory([])
    setShowHistory(false)
  }, [indexCurrentSessionForKnowledge])

  // Handle Ask mode - uses browser agent to read page content and answer questions
  const handleAskMode = useCallback(
    async (userMessage: string, attachedMentions: Mention[] = []) => {
      if (!activeTabId) return

      setChatItems((prev) => [...prev, { type: 'user', text: userMessage }])
      setIsLoading(true)
      runAfterUi(
        () => indexMentionReferences(attachedMentions),
        'Failed to index browser mention references'
      )

      let mentionContext = ''
      if (attachedMentions.length > 0) {
        const mentionContents: string[] = []
        for (const mention of attachedMentions) {
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
              mentionContents.push(`[Referenced Document: ${mention.title}]`)
            }
          } catch (err) {
            console.error('[BrowserAgentChat] Failed to fetch mention content:', err)
          }
        }
        if (mentionContents.length > 0) {
          mentionContext = mentionContents.join('\n\n')
        }
      }

      const executionMessage = mentionContext ? `${mentionContext}\n\n${userMessage}` : userMessage

      try {
        const { cancel } = window.bridge.runBrowserAgentStream(
          executionMessage,
          (event) => {
            // Handle history update event - update conversation history for context continuity
            if (event.type === 'history_update' && event.messages) {
              setConversationHistory(
                event.messages.map((m: { role: string; content: string }) => ({
                  role: m.role as 'user' | 'assistant',
                  content: m.content
                }))
              )
            } else if (event.type === 'tool_start' && event.tool) {
              setChatItems((prev) => [
                ...prev,
                {
                  type: 'tool_call' as const,
                  tool: event.tool || '',
                  toolInput: event.toolInput,
                  isLoading: true
                }
              ])
            } else if (event.type === 'tool_result' && event.tool) {
              setChatItems((prev) => {
                const items = [...prev]
                for (let i = items.length - 1; i >= 0; i--) {
                  const item = items[i]
                  if (item.type === 'tool_call' && item.tool === event.tool && item.isLoading) {
                    items[i] = { ...item, toolResult: event.toolResult, isLoading: false }
                    break
                  }
                }
                return items
              })
            } else if (event.type === 'text' && event.text) {
              const cleanedText = (event.text || '')
                .replace(/^[-─—=_*]{3,}\s*$/gm, '')
                .replace(/\n[-─—=_*]{3,}\n/g, '\n')
                .replace(/^\s*---+\s*$/gm, '')
                .replace(/\n{2,}/g, '\n')
                .trim()

              if (cleanedText) {
                setChatItems((prev) => {
                  const lastItem = prev[prev.length - 1]
                  if (lastItem?.type === 'text') {
                    const mergedText = lastItem.text + '\n' + cleanedText
                    return [...prev.slice(0, -1), { type: 'text' as const, text: mergedText }]
                  }
                  return [...prev, { type: 'text' as const, text: cleanedText }]
                })
              }
            } else if (event.type === 'error' && event.error) {
              // Map error codes to user-friendly messages
              let errorMessage = event.error || 'Unknown error'
              if (event.error === 'premium_model_not_allowed') {
                errorMessage =
                  'This model requires a Pro or Max subscription. Please upgrade or select a free model.'
              } else if (event.error === 'daily_limit_exceeded') {
                errorMessage =
                  "You've reached your daily request limit. Upgrade to Pro for unlimited requests."
              } else if (event.error === 'insufficient_credits') {
                errorMessage = "You've run out of credits. Visit your account to purchase more."
              } else if (event.error === 'subscription_not_loaded') {
                errorMessage = 'Subscription not loaded. Please restart the app.'
              }
              setChatItems((prev) => [...prev, { type: 'error' as const, text: errorMessage }])
              setIsLoading(false)
            } else if (event.type === 'done') {
              // Add session complete indicator
              setChatItems((prev) => [
                ...prev.filter((item) => item.type !== 'thinking'),
                { type: 'session_complete' as const, summary: event.summary }
              ])
              setIsLoading(false)
              agentCancelRef.current = null
            } else if (event.type === 'max_steps_reached') {
              setChatItems((prev) => prev.filter((item) => item.type !== 'thinking'))
              setIsLoading(false)
              agentCancelRef.current = null
            }
          },
          conversationHistory,
          selectedModel?.id,
          'ask'
        )

        agentCancelRef.current = cancel
      } catch (error) {
        setChatItems((prev) => [...prev, { type: 'error', text: String(error) }])
        setIsLoading(false)
      }
    },
    [activeTabId, selectedModel?.id, conversationHistory]
  )

  // Parse numbered plan from text ONLY if it looks like an explicit task plan
  // This prevents result lists (like "1. Investor A, 2. Investor B") from being rendered as task plans
  const parsePlanFromText = useCallback((text: string): TaskPlanStep[] => {
    // Only parse as a plan if text starts with plan-like headers
    const planHeaders = /^(plan|steps|task plan|here'?s? (my |the )?plan|i('ll| will))/i
    const firstLine = text.split('\n')[0]
    if (!planHeaders.test(firstLine)) {
      return [] // Not a plan, just regular content with numbers
    }

    const planRegex = /^\s*(\d+)[.)]\s+(.+)$/gm
    const steps: TaskPlanStep[] = []
    let match
    while ((match = planRegex.exec(text)) !== null) {
      steps.push({
        id: parseInt(match[1], 10),
        text: match[2].trim(),
        status: 'pending'
      })
    }
    return steps
  }, [])

  // Handle Act mode - agent execution with browser tools
  const handleActMode = useCallback(
    async (command: string, attachedMentions: Mention[] = []) => {
      setChatItems((prev) => [...prev, { type: 'user', text: command }])
      setTaskPlan([])
      setCompletedStepCount(0)
      setIsLoading(true)
      runAfterUi(
        () => indexMentionReferences(attachedMentions),
        'Failed to index browser mention references'
      )

      let mentionContext = ''
      if (attachedMentions.length > 0) {
        const mentionContents: string[] = []
        for (const mention of attachedMentions) {
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
              mentionContents.push(`[Referenced Document: ${mention.title}]`)
            }
          } catch (err) {
            console.error('[BrowserAgentChat] Failed to fetch mention content:', err)
          }
        }
        if (mentionContents.length > 0) {
          mentionContext = mentionContents.join('\n\n')
        }
      }

      const executionCommand = mentionContext ? `${mentionContext}\n\n${command}` : command

      try {
        // Use the browser agent stream - prioritizes browser tools with conversation history
        const { cancel } = window.bridge.runBrowserAgentStream(
          executionCommand,
          (event) => {
            // Handle history update event - update conversation history for context continuity
            if (event.type === 'history_update' && event.messages) {
              setConversationHistory(
                event.messages.map((m: { role: string; content: string }) => ({
                  role: m.role as 'user' | 'assistant',
                  content: m.content
                }))
              )
            } else if (event.type === 'thinking' && event.thinking) {
              // Don't add thinking items - they cause the spinning indicator issue
              // The global isLoading state handles the "Working..." indicator
            } else if (event.type === 'tool_start' && event.tool) {
              // Mark current step as in_progress when a tool starts
              setTaskPlan((prev) => {
                const updated = [...prev]
                const inProgressIdx = updated.findIndex((s) => s.status === 'in_progress')
                if (inProgressIdx === -1) {
                  // Find first pending step and mark it in_progress
                  const pendingIdx = updated.findIndex((s) => s.status === 'pending')
                  if (pendingIdx !== -1) {
                    updated[pendingIdx] = { ...updated[pendingIdx], status: 'in_progress' }
                  }
                }
                return updated
              })
              setChatItems((prev) => [
                ...prev,
                {
                  type: 'tool_call' as const,
                  tool: event.tool || '',
                  toolInput: event.toolInput,
                  isLoading: true
                }
              ])
            } else if (event.type === 'tool_result' && event.tool) {
              // Mark current in_progress step as completed on successful tool result
              setTaskPlan((prev) => {
                const updated = [...prev]
                const inProgressIdx = updated.findIndex((s) => s.status === 'in_progress')
                if (inProgressIdx !== -1) {
                  const isSuccess =
                    event.toolResult?.includes('"success":true') ||
                    event.toolResult?.includes('"success": true') ||
                    !event.toolResult?.includes('"success":false')
                  updated[inProgressIdx] = {
                    ...updated[inProgressIdx],
                    status: isSuccess ? 'completed' : 'failed'
                  }
                  if (isSuccess) {
                    setCompletedStepCount((c) => c + 1)
                  }
                }
                return updated
              })
              setChatItems((prev) => {
                const items = [...prev]
                for (let i = items.length - 1; i >= 0; i--) {
                  const item = items[i]
                  if (item.type === 'tool_call' && item.tool === event.tool && item.isLoading) {
                    items[i] = { ...item, toolResult: event.toolResult, isLoading: false }
                    break
                  }
                }
                return items
              })
            } else if (event.type === 'text' && event.text) {
              // Clean up text: remove all horizontal rules and excessive whitespace
              const cleanedText = (event.text || '')
                .replace(/^[-─—=_*]{3,}\s*$/gm, '') // Remove standalone hr lines
                .replace(/\n[-─—=_*]{3,}\n/g, '\n') // Remove hr between content
                .replace(/^\s*---+\s*$/gm, '') // Remove markdown hr syntax
                .replace(/^\s*\*\*\*+\s*$/gm, '') // Remove *** style hr
                .replace(/^\s*___+\s*$/gm, '') // Remove ___ style hr
                .replace(/\n{2,}/g, '\n') // Collapse multiple newlines
                .trim()

              // Try to parse a plan from the text
              const parsedPlan = parsePlanFromText(cleanedText)
              if (parsedPlan.length >= 2) {
                // Found a plan - add it as a plan item and update state
                setTaskPlan(parsedPlan)
                setChatItems((prev) => [...prev, { type: 'plan' as const, steps: parsedPlan }])
              } else if (cleanedText) {
                setChatItems((prev) => {
                  const lastItem = prev[prev.length - 1]
                  if (lastItem?.type === 'text') {
                    const mergedText = lastItem.text + '\n' + cleanedText
                    return [...prev.slice(0, -1), { type: 'text' as const, text: mergedText }]
                  }
                  return [...prev, { type: 'text' as const, text: cleanedText }]
                })
              }
            } else if (event.type === 'error' && event.error) {
              // Map error codes to user-friendly messages
              let errorMessage = event.error || 'Unknown error'
              if (event.error === 'premium_model_not_allowed') {
                errorMessage =
                  'This model requires a Pro or Max subscription. Please upgrade or select a free model.'
              } else if (event.error === 'daily_limit_exceeded') {
                errorMessage =
                  "You've reached your daily request limit. Upgrade to Pro for unlimited requests."
              } else if (event.error === 'insufficient_credits') {
                errorMessage = "You've run out of credits. Visit your account to purchase more."
              } else if (event.error === 'subscription_not_loaded') {
                errorMessage = 'Subscription not loaded. Please restart the app.'
              }
              setChatItems((prev) => [...prev, { type: 'error' as const, text: errorMessage }])
              setIsLoading(false)
            } else if (event.type === 'max_steps_reached') {
              setMaxStepsReached(true)
              setChatItems((prev) => [
                ...prev.filter((item) => item.type !== 'thinking'),
                { type: 'text' as const, text: 'Task incomplete — max steps reached.' }
              ])
              setIsLoading(false)
              agentCancelRef.current = null
            } else if (event.type === 'done') {
              setMaxStepsReached(false)
              // Add session complete indicator for Act mode
              setChatItems((prev) => [
                ...prev.filter((item) => item.type !== 'thinking'),
                { type: 'session_complete' as const, summary: event.summary }
              ])
              setIsLoading(false)
              agentCancelRef.current = null
            }
          },
          conversationHistory,
          selectedModel?.id,
          'act'
        )

        agentCancelRef.current = cancel
      } catch (error) {
        setChatItems((prev) => [...prev, { type: 'error', text: String(error) }])
        setIsLoading(false)
      }
    },
    [parsePlanFromText, selectedModel?.id, conversationHistory]
  )

  // Continue handler - simply sends "continue" as a message
  // The agent already has context from conversation history
  const handleContinue = useCallback(() => {
    handleActMode('continue')
  }, [handleActMode])

  // Cancel agent
  const cancelAgent = useCallback(() => {
    if (agentCancelRef.current) {
      agentCancelRef.current()
      agentCancelRef.current = null
    }
    setIsLoading(false)
  }, [])

  // Convert theme to format compatible with ChatInputArea
  const panelTheme = {
    text: theme.text,
    textSecondary: theme.textSecondary,
    textMuted: theme.textSecondary,
    textDisabled: theme.textSecondary,
    panelBg: theme.background,
    surfaceBg: theme.surface,
    surfaceBgHover: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    border: theme.border,
    isDark: theme.isDark
  } as Parameters<typeof ChatInputArea>[0]['theme']
  const hasIncompletePlan = taskPlan.some(
    (step) => step.status === 'pending' || step.status === 'in_progress'
  )
  const canContinue =
    !isLoading && (maxStepsReached || (hasIncompletePlan && completedStepCount > 0))
  const continueRun = canContinue
    ? (): void => {
        setMaxStepsReached(false)
        handleContinue()
      }
    : undefined

  return (
    <div
      ref={chatContainerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        pointerEvents: 'auto',
        overflow: 'hidden'
      }}
    >
      {/* Chat header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          gap: 12,
          pointerEvents: 'auto'
        }}
      >
        <div style={{ flex: 1, pointerEvents: 'auto' }}>
          <div style={{ fontWeight: 600, color: theme.text, fontSize: 14 }}>Chat</div>
        </div>
        <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
          <button
            onClick={startNewChat}
            title="New Chat"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Plus size={16} color={theme.textSecondary} />
          </button>
          <button
            onClick={() => {
              runInBackground(
                indexCurrentSessionForKnowledge,
                'Failed to index browser session on close'
              )
              onClose()
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={16} color={theme.textSecondary} />
          </button>
        </div>
      </div>

      {/* History dropdown */}
      {showHistory && (
        <div
          style={{
            position: 'absolute',
            top: 44,
            right: 8,
            width: 280,
            maxHeight: 320,
            background: theme.surface,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto',
            overflow: 'hidden'
          }}
        >
          <div style={{ overflowY: 'auto', maxHeight: 280 }}>
            {sessions.length === 0 ? (
              <div
                style={{
                  color: theme.textSecondary,
                  fontSize: 12,
                  textAlign: 'center',
                  padding: 16
                }}
              >
                No chat history yet
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    background:
                      currentSessionId === session.id
                        ? theme.isDark
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(0,0,0,0.04)'
                        : 'transparent',
                    borderBottom: `1px solid ${theme.border}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onClick={() => loadSession(session.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: theme.text,
                        fontSize: 12,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {session.title}
                    </div>
                    <div style={{ color: theme.textSecondary, fontSize: 10, marginTop: 2 }}>
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSession(session.id)
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 4,
                      cursor: 'pointer',
                      borderRadius: 4,
                      opacity: 0.5
                    }}
                  >
                    <X size={10} color={theme.textSecondary} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Chat messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          pointerEvents: 'auto'
        }}
      >
        {chatItems.length === 0 && !isLoading ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: 8,
              padding: '40px 20px'
            }}
          >
            <div style={{ color: theme.textSecondary, fontSize: 13, textAlign: 'center' }}>
              {chatMode === 'ask' ? 'Ask questions about this page' : 'Describe a task to automate'}
            </div>
          </div>
        ) : (
          <>
            <EmbeddedChatTranscript
              idPrefix={currentSessionId ? `browser:${currentSessionId}` : 'browser:draft'}
              items={chatItems}
              isRunning={isLoading}
              mode={chatMode}
              theme={panelTheme}
              modelId={selectedModel?.id}
              modelName={selectedModel?.name}
              planSteps={taskPlan}
              onContinue={continueRun}
            />
            <div ref={chatMessagesEndRef} />
          </>
        )}
      </div>

      {/* Chat input area - using shared ChatInputArea component */}
      <div style={{ padding: '8px 12px 12px 12px', pointerEvents: 'auto' }}>
        <ChatInputArea
          theme={panelTheme}
          models={models}
          selectedModels={selectedModel ? [selectedModel] : []}
          onModelSelect={(model) => setSelectedModel(model)}
          supportsVision={selectedModel?.supportsVision ?? false}
          placeholder={placeholder}
          onSend={async (message) => {
            if (!message.trim() || isLoading) return
            const attachedMentions = mentions
            setMentions([])

            // Route to appropriate handler based on current mode
            if (chatMode === 'ask') {
              handleAskMode(message, attachedMentions)
            } else {
              handleActMode(message, attachedMentions)
            }
          }}
          inputValue={chatInput}
          onInputChange={setChatInput}
          agentModeEnabled={chatMode === 'act'}
          onAgentModeChange={(enabled) => setChatMode(enabled ? 'act' : 'ask')}
          mentions={mentions}
          onMentionsChange={setMentions}
          embedded
          containerRef={chatContainerRef}
          forceSingleSelect
          isStreaming={isLoading}
          onStop={cancelAgent}
        />
      </div>
    </div>
  )
}
