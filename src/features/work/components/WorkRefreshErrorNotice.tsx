import { Button } from '@overlay/ui/primitives'

export function WorkRefreshErrorNotice({ error, onRetry }: {
  error: string | null
  onRetry(): void
}) {
  if (!error) return null
  return (
    <div role="alert" className="mx-6 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-(--border) bg-(--surface-subtle) px-4 py-3 text-sm">
      <p className="min-w-0 break-words text-(--foreground)">{error}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  )
}
