import { useRef, type FocusEvent } from 'react'

/** Preserve the opener for controlled dialogs that have no Radix Trigger. */
export function useDialogReturnFocus() {
  const opener = useRef<HTMLElement | null>(null)

  return {
    onFocusCapture(event: FocusEvent<HTMLElement>) {
      if (!opener.current && event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) {
        opener.current = event.relatedTarget
      }
    },
    onOpenAutoFocus() {
      opener.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null
    },
    onCloseAutoFocus(event: Event) {
      event.preventDefault()
      if (opener.current?.isConnected) opener.current.focus()
      opener.current = null
    },
  }
}
