import { useRef } from 'react'

/** Preserve the opener for controlled dialogs that have no Radix Trigger. */
export function useDialogReturnFocus() {
  const opener = useRef<HTMLElement | null>(null)

  return {
    onOpenAutoFocus() {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    },
    onCloseAutoFocus(event: Event) {
      event.preventDefault()
      if (opener.current?.isConnected) opener.current.focus()
    },
  }
}
