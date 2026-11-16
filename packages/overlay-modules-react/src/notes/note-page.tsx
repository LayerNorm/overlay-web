'use client'

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Textarea } from '@overlay/ui/primitives'
import { unstyledTextarea } from '@overlay/ui/control-reset'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** The note's title as the page's first line, Notion style: large, wraps, Enter moves into the body. */
export function NotePageTitle({
  value,
  onChange,
  onCommit,
  onEnterBody,
}: {
  value: string
  onChange(value: string): void
  onCommit(): Promise<void> | void
  onEnterBody(): void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Grow with the text where `field-sizing: content` is unsupported.
  useIsomorphicLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' && event.key !== 'Tab' && event.key !== 'ArrowDown') return
    if (event.key === 'ArrowDown') {
      const element = event.currentTarget
      if (element.selectionStart !== element.value.length) return
    }
    if (event.shiftKey) return
    event.preventDefault()
    void Promise.resolve(onCommit()).finally(onEnterBody)
  }

  return (
    <Textarea
      ref={ref}
      rows={1}
      aria-label="Note title"
      placeholder="Untitled"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\n/g, ' '))}
      onBlur={() => void onCommit()}
      onKeyDown={onKeyDown}
      spellCheck={false}
      // Utilities, not the stylesheet: the textarea primitive's own utility classes would win over base-layer CSS.
      className={unstyledTextarea(
        'overlay-note-title mb-1.5 block min-h-0 w-full resize-none overflow-hidden bg-transparent p-0 font-sans text-[38px] font-bold leading-[1.18] tracking-[-0.02em] text-(--foreground) shadow-none outline-none placeholder:text-(--muted-light) max-[560px]:text-[30px] in-data-[layout=panel]:text-[26px] in-data-[layout=panel]:tracking-[-0.015em]',
      )}
    />
  )
}

function editedLabel(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 60) return 'Edited just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Edited ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Edited ${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `Edited ${days}d ago`
  return `Edited ${new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** One quiet line under the title: when the note last changed and how long it is. */
export function NotePageMeta({ editor, updatedAt }: { editor: Editor | null; updatedAt?: number }) {
  const now = useNow(30_000)
  const words = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return 0
      const text = current.state.doc.textBetween(0, current.state.doc.content.size, ' ', ' ').trim()
      return text ? text.split(/\s+/).length : 0
    },
  }) ?? 0
  return (
    <div className="overlay-note-meta">
      {updatedAt ? <span>{editedLabel(updatedAt, now)}</span> : null}
      {updatedAt ? <span aria-hidden="true">·</span> : null}
      <span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
    </div>
  )
}
