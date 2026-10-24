'use client'

import { useEffect } from 'react'
import { cn } from '../../utils/cn'
import { useDialogReturnFocus } from '../../hooks/useDialogReturnFocus'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  busy = false,
  busyLabel = 'Deleting…',
  onConfirm,
  onCancel,
}: {
  isOpen: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  busyLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const returnFocus = useDialogReturnFocus()
  // Preserve the pre-Radix contract: Escape cancels, Enter confirms.
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!busy) onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, busy, onConfirm])

  const confirmClass = destructive
    ? 'rounded-lg bg-red-500 px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40'
    : undefined

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <AlertDialogContent {...returnFocus} onEscapeKeyDown={(event) => {
        if (busy) event.preventDefault()
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={(event) => {
            event.preventDefault()
            if (!busy) onCancel()
          }} disabled={busy}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={(event) => {
            event.preventDefault()
            if (!busy) onConfirm()
          }} disabled={busy} className={cn(confirmClass)}>
            {busy ? busyLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
