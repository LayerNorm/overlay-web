import { OverlayMark } from '@overlay/ui'

export function BrandMark({ pulse = false }: { pulse?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]">
        {pulse ? (
          <span
            className="overlay-stream-marker overlay-stream-marker--standalone"
            aria-hidden
            title=""
          >
            <OverlayMark size={20} label="" />
          </span>
        ) : (
          <OverlayMark size={32} label="" />
        )}
      </span>
      <div className="min-w-0">
        <p
          className="truncate text-xl font-medium tracking-tight text-[var(--foreground)]"
          style={{ fontFamily: 'var(--font-serif-family)' }}
        >
          overlay
        </p>
      </div>
    </div>
  )
}
