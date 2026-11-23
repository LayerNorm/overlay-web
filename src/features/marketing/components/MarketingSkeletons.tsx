'use client'

import { StaticMarketingShell } from './StaticMarketingShell'

/*
 * Marketing loading states: the real nav and frame, with placeholders in the page's own heading classes so each line
 * is exactly as tall as the text it stands in for.
 */

const STRUT = '\u200b'

/** One full-width line of text; the bar's percentage width is of the line, so the line must span its block. */
function Line({ bar, center = false }: { bar: string; center?: boolean }) {
  return <span className={`flex w-full items-center ${center ? 'justify-center' : ''}`}>{STRUT}<span className={`ui-skeleton-line block rounded-md ${bar}`} aria-hidden /></span>
}

/** The home page's centred hero. */
export function MarketingHomeSkeleton() {
  return (
    <StaticMarketingShell>
      <section className="hero" role="status" aria-label="Loading">
        <div className="flex flex-col items-center" aria-hidden>
          <p className="backed"><Line bar="h-4 w-36" center /></p>
          <div className="h1 w-full"><Line bar="h-11 w-[min(100%,640px)]" center /><Line bar="h-11 w-[min(80%,520px)]" center /></div>
          <div className="lead w-full"><Line bar="h-3.5 w-full" center /><Line bar="h-3.5 w-3/4" center /></div>
          <div className="actions"><span className="ui-skeleton-line block h-10 w-32 rounded-full" /><span className="ui-skeleton-line block h-10 w-36 rounded-full" /></div>
        </div>
      </section>
    </StaticMarketingShell>
  )
}

/** Every other marketing page opens with a page head: title and lead. */
export function MarketingPageSkeleton() {
  return (
    <StaticMarketingShell>
      <section className="sec page-head" role="status" aria-label="Loading">
        <div aria-hidden>
          <div className="h1"><Line bar="h-11 w-[min(100%,520px)]" /></div>
          <div className="lead"><Line bar="h-3.5 w-full" /><Line bar="h-3.5 w-2/3" /></div>
        </div>
      </section>
    </StaticMarketingShell>
  )
}
