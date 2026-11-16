import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChevronLeft, ChevronRight, Globe, Laptop, Lock } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { splitHref, useHref } from '../../shims/router'
import { HOST, SETUP, switchTo, type Host, type Setup } from './model'

// The window around the app, and the two switches that drive the mockup. Everything inside is production code.

function Switch<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string, ReactNode?]>; onChange(next: T): void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-(--surface-subtle) p-0.5">
      {options.map(([option, text, icon]) => (
        <Button
          key={option}
          variant="ghost"
          size="xs"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={`h-6 gap-1.5 rounded-md px-2 text-[11px] font-normal ${value === option ? 'bg-(--surface-elevated) text-(--foreground) shadow-xs hover:bg-(--surface-elevated)' : 'text-(--muted)'}`}
        >
          {icon}{text}
        </Button>
      ))}
    </div>
  )
}

function HostBar() {
  const { pathname } = splitHref(useHref())
  return (
    <div className="fixed inset-x-0 top-0 z-40 flex h-10 items-center gap-3 bg-background px-3 text-(--muted)">
      {HOST === 'desktop' ? (
        <div className="flex items-center gap-2 pl-1 lg:w-[360px]" aria-hidden>
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
      ) : (
        <div className="flex items-center gap-1 lg:w-[360px]" aria-hidden>
          <ChevronLeft size={15} strokeWidth={1.75} />
          <ChevronRight size={15} strokeWidth={1.75} className="opacity-40" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 justify-center max-md:invisible">
        {HOST === 'web' ? (
          <span className="inline-flex h-6 min-w-0 max-w-[420px] flex-1 items-center justify-center gap-1.5 rounded-md bg-(--surface-subtle) px-3 text-[11px]">
            <Lock size={10} className="shrink-0" />
            <span className="truncate">app.getoverlay.io{pathname.replace(/^\/app/, '') || '/'}</span>
          </span>
        ) : (
          <span className="text-[11px]">Overlay</span>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 lg:w-[360px]">
        <Switch<Setup> label="This computer is" value={SETUP} onChange={(setup) => switchTo({ setup })} options={[['first', 'Not connected'], ['done', 'Connected']]} />
        <Switch<Host>
          label="Show the app as"
          value={HOST}
          onChange={(host) => switchTo({ host })}
          options={[['web', 'Web', <Globe key="w" size={12} strokeWidth={1.75} />], ['desktop', 'Desktop', <Laptop key="d" size={12} strokeWidth={1.75} />]]}
        />
      </div>
    </div>
  )
}

/** Mounts the window bar beside the app, and leaves room for it. */
export function mountHostChrome() {
  document.documentElement.dataset.mockupHost = HOST
  const style = document.createElement('style')
  style.textContent = 'html[data-mockup-host] [data-app-shell]{height:calc(100vh - 40px)!important;margin-top:40px}'
  document.head.append(style)
  const node = document.createElement('div')
  document.body.append(node)
  createRoot(node).render(<HostBar />)
}
