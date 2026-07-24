'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { usePresence } from '@overlay/ui'
import type { AutomationDraftSummary, DraftModalState, SkillDraftSummary } from '@overlay/chat-core'

export function FlashCopyIconButton({
  copyText,
  disabled,
  ariaLabel = 'Copy',
}: {
  copyText: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const [showCheck, setShowCheck] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
  }, [])

  const handleClick = async () => {
    if (disabled || !copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
    } catch {
      return
    }
    setShowCheck(true)
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setShowCheck(false)
      timerRef.current = null
    }, 900)
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={disabled || !copyText}
      className={`rounded-md p-1.5 text-[var(--muted)] transition-all duration-200 hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 ${
        showCheck ? 'text-emerald-600 hover:text-emerald-600 hover:bg-[#ecfdf5]' : ''
      }`}
      aria-label={ariaLabel}
    >
      {showCheck ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
    </button>
  )
}

export function DraftReviewModal({
  state: stateProp,
  saving,
  onClose,
  onSaveSkill,
  onSaveAutomation,
}: {
  state: DraftModalState | null
  saving: boolean
  onClose: () => void
  onSaveSkill: (draft: SkillDraftSummary) => Promise<void>
  onSaveAutomation: (draft: AutomationDraftSummary) => Promise<void>
}) {
  const { mounted, visible } = usePresence(Boolean(stateProp), 300)
  // Retain the last non-null state so the modal keeps its content while sliding
  // out. The state object is reference-stable while open, so this converges.
  const [cachedState, setCachedState] = useState(stateProp)
  if (stateProp && stateProp !== cachedState) setCachedState(stateProp)
  const state = stateProp ?? cachedState
  if (!mounted || !state) return null
  const isAutomation = state.kind === 'automation'

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 transition-opacity duration-300 ease-[var(--overlay-ease)] sm:items-center sm:p-4 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`w-full max-w-2xl rounded-t-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl transition-[opacity,transform] duration-300 ease-[var(--overlay-ease)] sm:rounded-2xl ${
          visible
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full opacity-100 sm:translate-y-2 sm:scale-95 sm:opacity-0'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--foreground)]">
              {isAutomation ? 'Review Automation Draft' : 'Review Skill Draft'}
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{state.draft.reason}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            aria-label="Close draft review"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-medium text-[var(--foreground)]">{state.draft.name}</p>
            <p className="mt-1 text-[12px] text-[var(--muted)]">{state.draft.description}</p>
            <div className="mt-3 grid gap-2 text-[12px] text-[var(--muted)] sm:grid-cols-2">
              <p>Confidence: {state.draft.confidence}</p>
              <p>Integrations: {state.draft.detectedIntegrations.join(', ') || 'None detected'}</p>
              {isAutomation ? (
                <p>
                  Schedule: {state.draft.schedule.kind}
                  {'timezone' in state.draft ? ` (${state.draft.timezone})` : ''}
                </p>
              ) : null}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
              <span className="text-[11px] font-medium text-[var(--muted)]">Instructions</span>
              <FlashCopyIconButton copyText={state.draft.instructions} ariaLabel="Copy draft instructions" />
            </div>
            <pre className="max-h-[280px] overflow-auto p-4 text-[11px] leading-relaxed text-[var(--foreground)] whitespace-pre-wrap">
              {state.draft.instructions}
            </pre>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-[12px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (state.kind === 'automation') {
                void onSaveAutomation(state.draft)
              } else {
                void onSaveSkill(state.draft)
              }
            }}
            className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--foreground)] px-3 py-1.5 text-[12px] font-medium text-[var(--background)] transition-colors hover:opacity-85 disabled:opacity-60"
          >
            {saving ? 'Saving...' : isAutomation ? 'Create automation' : 'Save skill'}
          </button>
        </div>
      </div>
    </div>
  )
}
