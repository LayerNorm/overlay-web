/**
 * Side-panel chat surface. Renders a single conversation with:
 *   - Message list filtered to the currently selected variant per turn.
 *   - A "stacked variants" tab row above any turn that has >1 assistant
 *     variant (model comparison without splitting the narrow panel layout).
 *   - Framer-motion empty state identical to the landing chat surface.
 *   - Global keyboard shortcuts ported from landing:
 *       `/`               → focus composer
 *       `cmd/ctrl+shift+/` → (reserved) toggle model picker
 *       `cmd/ctrl+shift+.` → (reserved) cycle generation mode
 *
 * This component intentionally stays read-mostly: ask/stop/submission are
 * owned by the parent `App.tsx` so runtime wiring (active tab, approvals,
 * scope) remains in one place.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BrandMark, MessageList } from '@overlay/chat-react'
import {
  type ActiveRunState,
  type ConversationMessage,
  type StoredConversation,
  conversationTurnsFromMessages,
} from '@overlay/extension-contracts'
import { getModel } from '@overlay/extension-contracts'

const EMPTY_STARTERS = [
  'Summarize this page in 3 bullet points',
  'What can I do on this website?',
  'Extract the main action items from this page',
  'Compare what I see here with a quick web fact-check',
] as const

interface ChatInterfaceProps {
  conversation: StoredConversation | undefined
  /** All active runs for this conversation, keyed by variantIndex (0 = single-variant). */
  activeRunsByVariant: Record<number, ActiveRunState>
  appBaseUrl?: string | null
  userFirstName?: string | null
  /** Prefill composer when user picks an empty-state suggestion. */
  onEmptyStarterPick?: (text: string) => void
  /** Fired when the user uses `/` to jump to the composer. */
  onFocusComposer?: () => void
  /** Optional model-picker / gen-mode toggles (caller wires these). */
  onTogglePicker?: () => void
  onCycleGenerationMode?: () => void
}

export function ChatInterface({
  conversation,
  activeRunsByVariant,
  appBaseUrl,
  userFirstName,
  onEmptyStarterPick,
  onFocusComposer,
  onTogglePicker,
  onCycleGenerationMode,
}: ChatInterfaceProps) {
  const anyVariantStreaming = Object.values(activeRunsByVariant).some(
    (run) => run && (run.status === 'streaming' || run.status === 'executing_tool'),
  )

  const messages = useMemo(() => conversation?.messages ?? [], [conversation?.messages])
  const turns = useMemo(() => conversationTurnsFromMessages(messages), [messages])
  const multiVariantTurns = useMemo(
    () => turns.filter((turn) => turn.variants.length > 1),
    [turns],
  )

  // Per-turn selected variant (sticky across streams). Unknown turns default
  // to variant 0 or the leader variant present in `activeRunsByVariant`.
  const [selectedVariantByTurn, setSelectedVariantByTurn] = useState<Record<string, number>>({})

  // Keyboard shortcuts — ported 1:1 from landing/ChatInterface.tsx.
  const anyVariantStreamingRef = useRef(anyVariantStreaming)
  useEffect(() => {
    anyVariantStreamingRef.current = anyVariantStreaming
  }, [anyVariantStreaming])
  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.shiftKey && (e.key === '/' || e.key === '?')) {
        if (anyVariantStreamingRef.current) return
        if (!onTogglePicker) return
        e.preventDefault()
        onTogglePicker()
        return
      }

      if (meta && e.shiftKey && e.key === '.') {
        if (anyVariantStreamingRef.current) return
        if (!onCycleGenerationMode) return
        e.preventDefault()
        onCycleGenerationMode()
        return
      }

      if (e.key === '/' && !meta && !e.altKey && !e.shiftKey) {
        const t = e.target as HTMLElement | null
        if (!t) return
        // Don't steal `/` when the user is already typing in any editable field.
        if (t.closest('input, textarea, select, [contenteditable="true"]')) return
        e.preventDefault()
        onFocusComposer?.()
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true)
  }, [onFocusComposer, onTogglePicker, onCycleGenerationMode])

  // Flatten turns back into a message list using the currently selected variant.
  const displayMessages = useMemo<ConversationMessage[]>(() => {
    const out: ConversationMessage[] = []
    for (const turn of turns) {
      if (turn.user) out.push(turn.user)
      if (turn.variants.length === 0) continue
      const selected = selectedVariantByTurn[turn.turnId] ?? 0
      const pick =
        turn.variants.find((v) => (v.variantIndex ?? 0) === selected) ?? turn.variants[0]
      if (pick) out.push(pick)
    }
    return out
  }, [turns, selectedVariantByTurn])

  // Synthesize the "focused" active run — if the selected variant of the last
  // multi-variant turn is streaming, expose that; otherwise fall back to the
  // first streaming run. MessageList already keys off assistantMessageId, so
  // routing via the leader is sufficient for its indicator purposes.
  const focusedActiveRun: ActiveRunState | null = useMemo(() => {
    const runs = Object.values(activeRunsByVariant).filter(Boolean)
    if (runs.length === 0) return null
    const lastMultiTurn = multiVariantTurns[multiVariantTurns.length - 1]
    if (lastMultiTurn) {
      const selected = selectedVariantByTurn[lastMultiTurn.turnId] ?? 0
      const match = runs.find((run) => (run.variantIndex ?? 0) === selected)
      if (match) return match
    }
    return runs[0]
  }, [activeRunsByVariant, multiVariantTurns, selectedVariantByTurn])

  const hasMessages = messages.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hasMessages ? (
          <>
            {multiVariantTurns.length > 0 ? (
              <VariantTabStrip
                turns={multiVariantTurns}
                selectedVariantByTurn={selectedVariantByTurn}
                activeRunsByVariant={activeRunsByVariant}
                onSelect={(turnId, variantIndex) =>
                  setSelectedVariantByTurn((prev) => ({ ...prev, [turnId]: variantIndex }))
                }
              />
            ) : null}
            <MessageList
              messages={displayMessages}
              activeRun={focusedActiveRun}
              appBaseUrl={appBaseUrl ?? undefined}
            />
          </>
        ) : (
          <EmptyState
            userFirstName={userFirstName}
            onPickStarter={onEmptyStarterPick}
            onFocusComposer={onFocusComposer}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Sticky pill row surfacing variant selection for the most recent
 * multi-variant turn. Designed for the narrow side-panel width, so extra
 * turns collapse into a compact count rather than a horizontal strip of
 * tab rows.
 */
function VariantTabStrip({
  turns,
  selectedVariantByTurn,
  activeRunsByVariant,
  onSelect,
}: {
  turns: ReturnType<typeof conversationTurnsFromMessages>
  selectedVariantByTurn: Record<string, number>
  activeRunsByVariant: Record<number, ActiveRunState>
  onSelect: (turnId: string, variantIndex: number) => void
}) {
  const latest = turns[turns.length - 1]
  if (!latest) return null
  const selected = selectedVariantByTurn[latest.turnId] ?? 0

  return (
    <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--background)]/90 px-3 py-2 backdrop-blur">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
        Variants
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {latest.variants.map((variant) => {
          const idx = variant.variantIndex ?? 0
          const run = activeRunsByVariant[idx]
          const streaming = run && (run.status === 'streaming' || run.status === 'executing_tool')
          const modelEntry = variant.modelId ? getModel(variant.modelId) : undefined
          const label = modelEntry?.name ?? variant.modelId ?? `Variant ${idx + 1}`
          const isActive = idx === selected
          return (
            <button
              key={`${latest.turnId}:${idx}`}
              type="button"
              onClick={() => onSelect(latest.turnId, idx)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                isActive
                  ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]'
                  : 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
              }`}
              aria-pressed={isActive}
              title={variant.modelId ?? undefined}
            >
              <span className="truncate max-w-[8rem]">{label}</span>
              {streaming ? (
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"
                />
              ) : null}
            </button>
          )
        })}
      </div>
      {turns.length > 1 ? (
        <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          +{turns.length - 1}
        </span>
      ) : null}
    </div>
  )
}

function EmptyState({
  userFirstName,
  onPickStarter,
  onFocusComposer,
}: {
  userFirstName?: string | null
  onPickStarter?: (text: string) => void
  onFocusComposer?: () => void
}) {
  const greeting = userFirstName?.trim()
    ? `Hi, ${userFirstName.trim()}`
    : 'Ask Overlay'

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-8">
      <AnimatePresence mode="wait">
        <motion.div
          key="empty-state"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="flex w-full max-w-[360px] flex-col items-center text-center"
        >
          <div className="flex justify-center">
            <BrandMark />
          </div>
          <p
            className="mt-5 text-2xl leading-tight text-[var(--foreground)] sm:text-3xl"
            style={{ fontFamily: 'var(--font-serif-family)' }}
          >
            {greeting}
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Ask about this tab, other tabs in the window, or your selection. Replies stream in as they arrive.
          </p>
          <div className="mt-6 grid w-full grid-cols-1 gap-2 text-left text-xs text-[var(--muted)] sm:grid-cols-2">
            {EMPTY_STARTERS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-lg border border-[var(--border)] p-2.5 leading-snug transition-colors hover:bg-[var(--surface-muted)]"
                onClick={() => onPickStarter?.(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <p className="mt-6 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            Press{' '}
            <button
              type="button"
              className="rounded border border-[var(--border)] bg-[var(--surface-subtle)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-[var(--surface-muted)]"
              onClick={() => onFocusComposer?.()}
            >
              /
            </button>{' '}
            to focus the composer
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
