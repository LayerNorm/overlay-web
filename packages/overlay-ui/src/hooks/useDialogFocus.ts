import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/**
 * Focus behavior for hand-rolled modal dialogs (role="dialog" + aria-modal):
 * while `active` is true, moves focus into the container, keeps Tab/Shift+Tab
 * cycling inside it, and restores focus to the previously focused element when
 * it deactivates.
 *
 * Call unconditionally (before any early return) and attach the returned ref to
 * the dialog container, e.g. `const dialogRef = useDialogFocus(mounted)`.
 */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return undefined
    const el = ref.current
    if (!el) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (node) => !node.closest('[aria-hidden="true"]') && node.offsetParent !== null,
      )

    const first = focusables()[0]
    const preferred = el.querySelector<HTMLElement>('[data-autofocus]') ?? first
    preferred?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey ? index <= 0 : index === -1 || index === items.length - 1) {
        event.preventDefault()
        items[event.shiftKey ? items.length - 1 : 0].focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus()
    }
  }, [active])

  return ref
}
