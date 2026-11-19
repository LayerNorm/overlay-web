'use client'

import { AnimatePresence, domAnimation, LazyMotion, m } from 'framer-motion'
import { Globe2, Image as ImageIcon, PenLine, type LucideIcon } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { ReactNode } from 'react'

export type EmptyChatSuggestionId = 'image' | 'write' | 'lookup'

type ChatEmptyStateProps = {
  visible: boolean
  mode: 'chat' | 'automate'
  onEmptySuggestion?: (id: EmptyChatSuggestionId) => void
}

const CHAT_SUGGESTIONS: Array<{ id: EmptyChatSuggestionId; label: string; Icon: LucideIcon }> = [
  { id: 'image', label: 'Create an image', Icon: ImageIcon },
  { id: 'write', label: 'Write or edit', Icon: PenLine },
  { id: 'lookup', label: 'Look something up', Icon: Globe2 },
]

// A new automation is written as an ordinary chat message; creating an image is not a scheduled run.
const AUTOMATE_SUGGESTIONS = CHAT_SUGGESTIONS.filter((suggestion) => suggestion.id !== 'image')

export function ChatEmptyHero({
  visible,
  greetingLine,
  children,
}: {
  visible: boolean
  greetingLine: string
  children?: ReactNode
}) {
  return (
    <LazyMotion features={domAnimation} strict>
    <AnimatePresence initial={false}>
      {visible && (
        <m.div
          key="chat-empty-hero"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto text-center"
        >
          <p className="text-3xl text-(--foreground)" style={{ fontFamily: 'var(--font-serif)' }}>
            {greetingLine}
          </p>
          {children}
        </m.div>
      )}
    </AnimatePresence>
    </LazyMotion>
  )
}

export function ChatEmptyState({
  visible,
  mode,
  onEmptySuggestion,
}: ChatEmptyStateProps) {
  const suggestions = mode === 'automate' ? AUTOMATE_SUGGESTIONS : CHAT_SUGGESTIONS

  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence initial={false}>
        {visible && (
          <m.div
            key="chat-suggestions"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="mx-auto mb-3 w-full max-w-4xl min-w-0 px-0"
          >
            <div className="flex items-center gap-2 max-md:flex-nowrap max-md:justify-start max-md:overflow-x-auto max-md:overflow-y-hidden max-md:scrollbar-none max-md:[&::-webkit-scrollbar]:hidden md:flex-wrap md:justify-center">
              {suggestions.map(({ id, label, Icon }) => (
                <Button
                  variant="ghost"
                  key={id}
                  type="button"
                  className="h-9 shrink-0 gap-2 rounded-2xl border border-(--border) bg-transparent px-3.5 text-sm font-normal text-(--foreground) transition-colors hover:bg-(--surface-muted)"
                  onClick={() => onEmptySuggestion?.(id)}
                >
                  <Icon size={15} strokeWidth={1.75} className="shrink-0 text-(--muted)" />
                  <span>{label}</span>
                </Button>
              ))}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  )
}
