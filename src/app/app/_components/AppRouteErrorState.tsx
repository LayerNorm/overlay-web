'use client'
import { unstyledButton } from '../../control-reset'
import { Button } from '@overlay/ui/primitives'

import { useEffect } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

export function AppRouteErrorState({
  error,
  reset,
  title,
}: {
  error: Error & { digest?: string }
  reset: () => void
  title: string
}) {
  useEffect(() => {
    console.error(`[app route error] ${title}`, error)
  }, [error, title])

  return (
    <div
      data-testid="app-route-error"
      className="flex h-full min-h-[40vh] items-center justify-center bg-(--background) px-4"
    >
      <div className="w-full max-w-md rounded-lg border border-(--border) bg-(--surface-elevated) p-5 shadow-xs">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-(--border) bg-(--surface-subtle) text-(--muted)">
          <AlertCircle size={18} strokeWidth={1.8} />
        </div>
        <h2 className="text-base font-medium text-(--foreground)">{title}</h2>
        <p className="mt-2 text-sm text-(--muted)">
          The route failed while loading. Retry the segment without leaving the app.
        </p>
        <Button variant="ghost"
          type="button"
          onClick={reset}
          className={unstyledButton(`mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-(--border) bg-(--foreground) px-3 text-sm font-medium text-(--background) transition-opacity hover:opacity-90`)}
        >
          <RefreshCw size={14} strokeWidth={1.8} />
          Retry
        </Button>
      </div>
    </div>
  )
}
