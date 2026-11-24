import { Skeleton } from '@overlay/ui'

const LINE_WIDTHS = ['96%', '88%', '92%', '54%', '0', '94%', '90%', '72%'] as const

/**
 * A note while it loads: the `.overlay-note-page` column with the title, meta line and paragraph lines at the loaded
 * page's sizes (title 38px/1.18, meta 12.5px, body `--note-size` at 1.65 with 3px paragraph padding).
 */
export function NotePageSkeleton({ layout = 'page', fullWidth = false }: { layout?: 'page' | 'panel'; fullWidth?: boolean }) {
  return (
    <div className="overlay-note-page" data-layout={layout} data-width={fullWidth ? 'full' : undefined} role="status" aria-label="Loading note">
      <div aria-hidden className="mb-1.5 flex h-[1.18em] items-center text-[38px] max-[560px]:text-[30px] in-data-[layout=panel]:text-[26px]">
        <Skeleton className="h-[0.6em] w-[45%]" />
      </div>
      <div aria-hidden className="overlay-note-meta">
        <span className="flex h-[1.5em] items-center"><Skeleton className="h-2.5 w-32" /></span>
      </div>
      <div aria-hidden style={{ fontSize: 'var(--note-size, 16px)' }}>
        {LINE_WIDTHS.map((width, index) => (
          <div key={index} className="flex h-[calc(1.65em+6px)] items-center">
            {width === '0' ? null : <Skeleton className="h-[0.7em]" style={{ width }} />}
          </div>
        ))}
      </div>
    </div>
  )
}
