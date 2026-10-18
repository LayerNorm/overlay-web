'use client'

import { AnimatePresence, domAnimation, LazyMotion, m } from 'framer-motion'
import { Globe2, Image as ImageIcon, PenLine, Zap, type LucideIcon } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { ReactNode } from 'react'

export type EmptyChatSuggestionId = 'image' | 'write' | 'lookup'
export type EmptyAutomateSuggestionId = 'workflow' | 'monitor' | 'schedule'

type ChatEmptyStateProps = {
  visible: boolean
  mode: 'chat' | 'automate'
  belowComposer?: ReactNode
  onEmptySuggestion?: (id: EmptyChatSuggestionId) => void
  onAutomateSuggestion?: (id: EmptyAutomateSuggestionId) => void
}

const CHAT_SUGGESTIONS: Array<{ id: EmptyChatSuggestionId; label: string; Icon: LucideIcon }> = [
  { id: 'image', label: 'Create an image', Icon: ImageIcon },
  { id: 'write', label: 'Write or edit', Icon: PenLine },
  { id: 'lookup', label: 'Look something up', Icon: Globe2 },
]

const AUTOMATE_SUGGESTIONS: Array<{ id: EmptyAutomateSuggestionId; label: string; Icon: LucideIcon }> = [
  { id: 'workflow', label: 'Build a workflow', Icon: Zap },
  { id: 'monitor', label: 'Monitor a site', Icon: Globe2 },
  { id: 'schedule', label: 'Schedule a report', Icon: PenLine },
]

export function ChatEmptyHero({
  visible,
  greetingLine,
}: {
  visible: boolean
  greetingLine: string
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
          className="text-center max-md:order-1 max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:items-center max-md:justify-center md:mb-8"
        >
          <p className="text-3xl text-(--foreground)" style={{ fontFamily: 'var(--font-serif)' }}>
            {greetingLine}
          </p>
        </m.div>
      )}
    </AnimatePresence>
    </LazyMotion>
  )
}

export function ChatEmptyState({
  visible,
  mode,
  belowComposer,
  onEmptySuggestion,
  onAutomateSuggestion,
}: ChatEmptyStateProps) {
  const suggestions = mode === 'automate' ? AUTOMATE_SUGGESTIONS : CHAT_SUGGESTIONS

  return (
    <>
      <LazyMotion features={domAnimation} strict>
      <AnimatePresence initial={false}>
        {visible && (
          <m.div
            key="chat-suggestions"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="mx-auto mt-4 w-full max-w-xl min-w-0 px-0 max-md:order-2 max-md:mb-3 max-md:mt-0 md:mt-5"
          >
            <div className="flex items-center gap-2 max-md:flex-nowrap max-md:justify-start max-md:overflow-x-auto max-md:overflow-y-hidden max-md:scrollbar-none max-md:[&::-webkit-scrollbar]:hidden md:flex-wrap md:justify-center">
              {suggestions.map(({ id, label, Icon }) => (
                <Button
                  variant="ghost"
                  key={id}
                  type="button"
                  className="h-9 shrink-0 gap-2 rounded-2xl border border-(--border) bg-transparent px-3.5 text-sm font-normal text-(--foreground) transition-colors hover:bg-(--surface-muted)"
                  onClick={() => {
                    if (mode === 'automate') {
                      onAutomateSuggestion?.(id as EmptyAutomateSuggestionId)
                    } else {
                      onEmptySuggestion?.(id as EmptyChatSuggestionId)
                    }
                  }}
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
      {visible && belowComposer ? (
        <div className="mx-auto mt-8 w-full max-w-xl min-w-0 px-0">
          {belowComposer}
        </div>
      ) : null}
    </>
  )
}
