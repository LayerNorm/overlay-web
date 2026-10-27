import { useLayoutEffect, type RefObject } from 'react'

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const textarea = ref.current
    if (!textarea) return undefined

    let width = textarea.getBoundingClientRect().width
    resizeTextarea(textarea)

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          const nextWidth = textarea.getBoundingClientRect().width
          if (nextWidth === width) return
          width = nextWidth
          resizeTextarea(textarea)
        })
    observer?.observe(textarea)

    let active = true
    void document.fonts?.ready.then(() => {
      if (active) resizeTextarea(textarea)
    })

    return () => {
      active = false
      observer?.disconnect()
    }
  }, [ref])

  useLayoutEffect(() => {
    const textarea = ref.current
    if (textarea) resizeTextarea(textarea)
  }, [ref, value])
}
