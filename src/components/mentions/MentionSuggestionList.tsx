'use client'

import React from 'react'
import { Bot, User } from 'lucide-react'
import type { MentionablePrincipal } from '@/shared/mentions/principal-mentions'

export const MENTION_LISTBOX_ID = 'mention-suggestions'

export function mentionOptionId(principalId: string): string {
  return `${MENTION_LISTBOX_ID}-${principalId}`
}

/**
 * Keyboard-first mention suggestions. Rendered as a listbox tied to the composer
 * with aria-activedescendant so screen readers announce the highlighted
 * principal while focus stays in the textarea.
 */
export function MentionSuggestionList({
  suggestions,
  activeIndex,
  onSelect,
  onHover,
}: {
  suggestions: readonly MentionablePrincipal[]
  activeIndex: number
  onSelect(principal: MentionablePrincipal): void
  onHover?(index: number): void
}) {
  if (suggestions.length === 0) return null
  return (
    <ul
      id={MENTION_LISTBOX_ID}
      role="listbox"
      aria-label="People and agents"
      data-testid="mention-suggestions"
      className="absolute bottom-full left-0 z-30 mb-2 max-h-60 w-[min(320px,100%)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg"
    >
      {suggestions.map((principal, index) => (
        <li
          key={principal.principalId}
          id={mentionOptionId(principal.principalId)}
          role="option"
          aria-selected={index === activeIndex}
          onMouseEnter={() => onHover?.(index)}
          onMouseDown={(event) => {
            // Keep focus in the composer so the caret position survives.
            event.preventDefault()
            onSelect(principal)
          }}
          className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
            index === activeIndex
              ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
              : 'text-[var(--muted)]'
          }`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
            {principal.principalType === 'agent' ? <Bot size={12} /> : <User size={12} />}
          </span>
          <span className="truncate">{principal.displayName}</span>
          {principal.principalType === 'agent' ? (
            <span className="ml-auto rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--muted-light)]">
              Agent
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
