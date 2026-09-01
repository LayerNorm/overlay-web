'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Whether an editor text change must refresh the React `input` state. Normal
 * typing stays local to the contenteditable so the chat surface does not
 * re-render per key; the agent slash menu is the one consumer that needs live
 * text, so state refreshes only while a slash token is (or just was) on
 * screen — covering open, filter, select (`/name ` closes the menu), and the
 * whitespace/clear transitions that dismiss it.
 */
export function shouldSyncSlashInput(text: string, previous: string): boolean {
  return /^\/\S*$/.test(text) || /^\/\S*$/.test(previous)
}

export function useComposerTextState() {
  const [input, setInputState] = useState('')
  const [inputRevision, setInputRevision] = useState(0)
  const [hasComposerText, setHasComposerText] = useState(false)
  const inputRef = useRef(input)

  const setInput = useCallback((next: string | ((previous: string) => string)) => {
    const resolved = typeof next === 'function' ? next(inputRef.current) : next
    inputRef.current = resolved
    setInputState(resolved)
    setHasComposerText(resolved.trim().length > 0)
    setInputRevision((value) => value + 1)
  }, [])

  const handleComposerInputChange = useCallback((text: string) => {
    const previous = inputRef.current
    inputRef.current = text
    const hasText = text.trim().length > 0
    setHasComposerText((state) => (state === hasText ? state : hasText))
    if (shouldSyncSlashInput(text, previous)) {
      setInputState(text)
      setInputRevision((value) => value + 1)
    }
  }, [])

  return {
    handleComposerInputChange,
    hasComposerText,
    input,
    inputRef,
    inputRevision,
    setInput,
  }
}
