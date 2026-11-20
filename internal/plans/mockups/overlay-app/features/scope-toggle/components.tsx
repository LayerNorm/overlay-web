import { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@overlay/ui'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@overlay/ui/primitives'
import { ScopeToggle } from '../../../../../../packages/overlay-shell-react/src/sidebar/UnifiedSidebar'

type Scope = 'personal' | 'workspace'
type Variant = 'current' | 'aligned' | 'tabs' | 'title'

const VARIANTS: Array<[Variant, string]> = [['current', 'Today'], ['aligned', 'A · Aligned'], ['tabs', 'B · Tabs'], ['title', 'C · In the title']]
const SCOPES: Array<[Scope, string]> = [['personal', 'Personal'], ['workspace', 'Workspace']]

const requested = new URLSearchParams(globalThis.location?.search ?? '').get('variant')
let variant: Variant = VARIANTS.some(([id]) => id === requested) ? requested as Variant : 'title'
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const useVariant = () => useSyncExternalStore(subscribe, () => variant)

interface ScopeProps { scope: Scope; onChange(next: Scope): void }

/** The row under the panel header: today's control, the aligned segmented control, or text tabs. */
export function ScopeRow({ scope, onChange }: ScopeProps) {
  const current = useVariant()
  if (current === 'current') return <ScopeToggle scope={scope} workspaceLocked={false} onChange={onChange} />
  if (current === 'aligned') {
    return (
      <div role="group" aria-label="Scope" className="mx-2 mb-3 grid h-[34px] grid-cols-2 gap-[3px] rounded-lg bg-(--surface-subtle) p-[3px]">
        {SCOPES.map(([id, label]) => (
          <Button key={id} variant="ghost" type="button" aria-pressed={scope === id} onClick={() => onChange(id)} className={unstyledButton(cn('h-full w-full rounded-[6px] text-[13px] transition-colors', scope === id ? 'bg-(--surface-elevated) font-medium text-(--foreground) shadow-xs' : 'text-(--muted) hover:text-(--foreground)'))}>
            {label}
          </Button>
        ))}
      </div>
    )
  }
  if (current === 'tabs') {
    return (
      <div role="tablist" aria-label="Scope" className="mx-3 mb-2 flex gap-4 border-b border-(--border)">
        {SCOPES.map(([id, label]) => (
          <Button key={id} variant="ghost" type="button" role="tab" aria-selected={scope === id} onClick={() => onChange(id)} className={unstyledButton(cn('-mb-px h-8 border-b-[1.5px] text-[13px] transition-colors', scope === id ? 'border-(--foreground) font-medium text-(--foreground)' : 'border-transparent text-(--muted) hover:text-(--foreground)'))}>
            {label}
          </Button>
        ))}
      </div>
    )
  }
  return null
}

/** The panel title; in the "title" variant the scope sits beside it as a quiet menu. */
export function ScopeTitle({ title, scope, onChange }: { title: string; scope?: Scope; onChange(next: Scope): void }) {
  const current = useVariant()
  const heading = <h2 className={cn('min-w-0 truncate text-[15px] font-semibold capitalize tracking-tight', current === 'title' && scope ? '' : 'flex-1')}>{title}</h2>
  if (current !== 'title' || !scope) return heading
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {heading}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" type="button" aria-label={`Scope: ${scope}`} className={unstyledButton('inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) data-[state=open]:bg-(--surface-subtle) data-[state=open]:text-(--foreground)')}>
            {SCOPES.find(([id]) => id === scope)?.[1]}
            <ChevronDown size={13} strokeWidth={1.75} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[168px]">
          {SCOPES.map(([id, label]) => (
            <DropdownMenuItem key={id} onSelect={() => onChange(id)} className="justify-between">
              {label}
              {scope === id ? <Check size={14} strokeWidth={1.75} aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function VariantBar() {
  const current = useVariant()
  return (
    <div className="fixed inset-x-0 top-0 z-40 flex h-10 items-center justify-between gap-3 bg-background px-3 text-(--muted)">
      <span className="truncate text-[11px] max-sm:hidden">Scope toggle mockup</span>
      <div role="radiogroup" aria-label="Scope toggle design" className="inline-flex rounded-lg bg-(--surface-subtle) p-0.5">
        {VARIANTS.map(([id, label]) => (
          <Button key={id} variant="ghost" size="xs" role="radio" aria-checked={current === id} onClick={() => { variant = id; listeners.forEach((listener) => listener()) }} className={`h-6 rounded-md px-2 text-[11px] font-normal ${current === id ? 'bg-(--surface-elevated) text-(--foreground) shadow-xs hover:bg-(--surface-elevated)' : 'text-(--muted)'}`}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** Mounts the design switcher above the app, and leaves room for it. */
export function mountVariantBar() {
  const style = document.createElement('style')
  style.textContent = '[data-app-shell]{height:calc(100vh - 40px)!important;margin-top:40px}'
  document.head.append(style)
  const node = document.createElement('div')
  document.body.append(node)
  createRoot(node).render(<VariantBar />)
}
