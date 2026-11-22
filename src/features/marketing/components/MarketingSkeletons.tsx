'use client'

import { StaticMarketingShell } from './StaticMarketingShell'

/*
 * Marketing loading states: the real nav and frame, with placeholders in the page's own heading classes so each line
 * is exactly as tall as the text it stands in for.
 */

const STRUT = '\u200b'

function Line({ bar }: { bar: string }) {
  return <span className="flex items-center">{STRUT}<span className={`ui-skeleton-line inline-block rounded-md ${bar}`} aria-hidden /></span>
}

/** The home page's centred hero. */
export function MarketingHomeSkeleton() {
  return (
    <StaticMarketingShell>
      <section className="hero" role="status" aria-label="Loading">
        <div className="flex flex-col items-center" aria-hidden>
          <p className="backed"><Line bar="h-4 w-36" /></p>
          <div className="h1 flex w-full flex-col items-center"><Line bar="h-11 w-[min(100%,640px)]" /><Line bar="h-11 w-[min(80%,520px)]" /></div>
          <div className="lead flex w-full flex-col items-center"><Line bar="h-3.5 w-full" /><Line bar="h-3.5 w-3/4" /></div>
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
