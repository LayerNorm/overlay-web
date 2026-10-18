'use client'
import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import { Button, Input } from '@overlay/ui/primitives'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, X } from 'lucide-react'
import { Dialog, DialogContent } from '@overlay/ui'

/**
 * Account-deletion UI required by Apple App Store guideline 5.1.1(v).
 *
 * Renders an inline "Delete account" button. When the user clicks it (or when
 * the page is opened with `?delete=1`, which is what the mobile app does via
 * its in-app "Delete account" entry) we show a typed-confirmation modal and,
 * on confirm, POST to /api/account/delete.
 *
 * On success we redirect to /?account_deleted=1 — the session cookie is
 * already cleared server-side so the user lands on the marketing page logged
 * out.
 */
export function DeleteAccountSection({ isLandingDark }: { isLandingDark: boolean }) {
  const searchParams = useSearchParams()
  const autoOpenedRef = useRef(false)

  const [open, setOpen] = useState(false)
  const [confirmInput, setConfirmInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Honor the `?delete=1` deep link from the mobile app once per page view.
  useEffect(() => {
    if (autoOpenedRef.current) return
    if (searchParams?.get('delete') !== '1') return
    autoOpenedRef.current = true
    setOpen(true)
    // Strip the query param so a refresh doesn't re-open the dialog.
    const next = new URLSearchParams(searchParams.toString())
    next.delete('delete')
    const qs = next.toString()
    window.history.replaceState(null, '', qs ? `/account?${qs}` : '/account')
  }, [searchParams])

  function close(): void {
    if (submitting) return
    setOpen(false)
    setConfirmInput('')
    setError(null)
  }

  async function handleConfirm(): Promise<void> {
    if (submitting) return
    if (confirmInput.trim().toLowerCase() !== 'delete') {
      setError('Type DELETE (any case) to confirm.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `Server returned ${response.status}`)
      }
      // Hard navigation so the cleared session cookie is picked up everywhere.
      window.location.href = '/?account_deleted=1'
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not delete your account.'
      setError(message)
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button variant="ghost"
        type="button"
        onClick={() => setOpen(true)}
        className={unstyledButton(`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
          isLandingDark
            ? 'text-red-400 hover:bg-red-950/40 hover:text-red-300'
            : 'text-red-600 hover:bg-red-50 hover:text-red-700'
        }`)}
      >
        Delete account
      </Button>

      <DeleteAccountDialog
        open={open}
        isLandingDark={isLandingDark}
        confirmInput={confirmInput}
        submitting={submitting}
        error={error}
        onClose={close}
        onConfirmInputChange={(value) => {
          setConfirmInput(value)
          if (error) setError(null)
        }}
        onConfirm={handleConfirm}
      />
    </>
  )
}

function DeleteAccountDialog({
  open,
  isLandingDark,
  confirmInput,
  submitting,
  error,
  onClose,
  onConfirmInputChange,
  onConfirm,
}: {
  open: boolean
  isLandingDark: boolean
  confirmInput: string
  submitting: boolean
  error: string | null
  onClose(): void
  onConfirmInputChange(value: string): void
  onConfirm(): void
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-50 bg-black/60 px-4"
        aria-labelledby="delete-account-title"
        className={`block w-[calc(100%-2rem)] max-w-md gap-0 p-6 ${
          isLandingDark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                isLandingDark ? 'bg-red-950/40 text-red-400' : 'bg-red-50 text-red-600'
              }`}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h2 id="delete-account-title" className="text-lg font-semibold">
              Delete your Overlay account?
            </h2>
          </div>
          <Button variant="ghost"
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
            className={unstyledButton(`rounded-md p-1 transition-colors disabled:opacity-50 ${
              isLandingDark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'
            }`)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className={`mb-3 text-sm leading-relaxed ${isLandingDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
          This permanently deletes your account, all chats, notes, knowledge files, saved
          memories, automations, and connected integrations. Any active paid subscription will
          be canceled.
        </p>
        <p className={`mb-5 text-sm font-medium ${isLandingDark ? 'text-zinc-200' : 'text-zinc-900'}`}>
          This action cannot be undone.
        </p>

        <label htmlFor="delete-account-confirm" className={`mb-1 block text-xs font-medium uppercase tracking-wide ${
          isLandingDark ? 'text-zinc-400' : 'text-zinc-500'
        }`}>
          Type DELETE to confirm
        </label>
        <Input
          id="delete-account-confirm"
          type="text"
          value={confirmInput}
          onChange={(e) => onConfirmInputChange(e.target.value)}
          autoFocus
          autoComplete="off"
          disabled={submitting}
          placeholder="DELETE"
          className={unstyledInput(`w-full rounded-lg border px-3 py-2 text-sm outline-hidden transition-colors disabled:opacity-50 ${
            isLandingDark
              ? 'border-zinc-700 bg-zinc-900 text-zinc-100 placeholder-zinc-500 focus:border-zinc-500'
              : 'border-zinc-300 bg-white text-zinc-900 placeholder-zinc-400 focus:border-zinc-500'
          }`)}
        />

        {error ? (
          <p className="mt-3 text-sm text-red-500">{error}</p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost"
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={unstyledButton(`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              isLandingDark
                ? 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                : 'border border-zinc-300 text-zinc-700 hover:bg-zinc-50'
            }`)}
          >
            Cancel
          </Button>
          <Button variant="ghost"
            type="button"
            onClick={onConfirm}
            disabled={submitting || confirmInput.trim().toLowerCase() !== 'delete'}
            className={unstyledButton(`inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50`)}
          >
            {submitting ? 'Deleting…' : 'Delete account'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
