import { Button } from '@overlay/ui/primitives'

export function AgentComputerRecoveryNotice({ loadError, provisionError, onRetryLoad }: {
  loadError: string | null
  provisionError: string | null
  onRetryLoad(): void
}) {
  return (
    <>
      {loadError ? (
        <div role="alert" className="flex items-center justify-between gap-3 text-[11px] leading-4 text-red-500">
          <span>{loadError}</span>
          <Button variant="ghost" size="sm" onClick={onRetryLoad}>Try again</Button>
        </div>
      ) : null}
      {provisionError ? <p role="alert" className="text-[11px] leading-4 text-red-500">{provisionError}</p> : null}
    </>
  )
}
