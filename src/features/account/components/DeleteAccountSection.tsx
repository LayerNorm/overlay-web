'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, X } from 'lucide-react'
import { usePresence } from '@overlay/ui'

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
  const router = useRouter()
  const searchParams = useSearchParams()
  const autoOpenedRef = useRef(false)

  const [open, setOpen] = useState(false)
  const { mounted: dialogMounted, visible: dialogVisible } = usePresence(open)
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
    router.replace(qs ? `/account?${qs}` : '/account', { scroll: false })
  }, [router, searchParams])

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:w-auto ${
          isLandingDark
            ? 'text-red-400 hover:bg-red-950/40 hover:text-red-300'
            : 'text-red-600 hover:bg-red-50 hover:text-red-700'
        }`}
      >
        Delete account
      </button>

      {dialogMounted ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 transition-opacity duration-200 ease-[var(--overlay-ease)] ${
            dialogVisible ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl transition-[opacity,transform] duration-200 ease-[var(--overlay-ease)] ${
              dialogVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-1'
            } ${
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
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                disabled={submitting}
                className={`rounded-md p-1 transition-colors disabled:opacity-50 ${
                  isLandingDark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'
                }`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className={`mb-3 text-sm leading-relaxed ${isLandingDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
              This permanently deletes your account, all chats, notes, knowledge files, saved
              memories, automations, and connected integrations. Any active paid subscription will
              be canceled.
            </p>
            <p className={`mb-5 text-sm font-medium ${isLandingDark ? 'text-zinc-200' : 'text-zinc-900'}`}>
              This action cannot be undone.
            </p>

            <label className={`mb-1 block text-xs font-medium uppercase tracking-wide ${
              isLandingDark ? 'text-zinc-400' : 'text-zinc-500'
            }`}>
              Type DELETE to confirm
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => {
                setConfirmInput(e.target.value)
                if (error) setError(null)
              }}
              autoFocus
              autoComplete="off"
              disabled={submitting}
              placeholder="DELETE"
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors disabled:opacity-50 ${
                isLandingDark
                  ? 'border-zinc-700 bg-zinc-900 text-zinc-100 placeholder-zinc-500 focus:border-zinc-500'
                  : 'border-zinc-300 bg-white text-zinc-900 placeholder-zinc-400 focus:border-zinc-500'
              }`}
            />

            {error ? (
              <p className="mt-3 text-sm text-red-500">{error}</p>
            ) : null}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  isLandingDark
                    ? 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                    : 'border border-zinc-300 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting || confirmInput.trim().toLowerCase() !== 'delete'}
                className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
