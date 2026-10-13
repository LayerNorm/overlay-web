'use client'
import { useRef, useState } from 'react'
import { Plus, List } from 'lucide-react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { HeaderSearch } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { canEditResource } from '@/shared/workspaces/resource-scope'
import { listViewForScope } from '@/shared/workspaces/panel-scope'
import { resolveWorkView } from '@/shared/work/view'
import { useWorkItems } from '../lib/useWorkItems'
import { useWorkPeople } from '../lib/useWorkPeople'
import { selectWork, type WorkFilter } from '../lib/selection'
import { QuickAdd } from './QuickAdd'
import { WorkList } from './WorkList'

export default function WorkScreen() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const { user } = useAuth()
  const scope = usePanelScope()
  const solo = useIsSoloWorkspace()
  const { canCreate } = useWorkspaceCreateAccess()
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const view = resolveWorkView(params.get('view'))
  const data = useWorkItems(activeWorkspaceId, listViewForScope(scope, solo))
  const people = useWorkPeople(activeWorkspaceId)
  const principalId = people.people.find((person) => person.userId === user?.id)?.principalId
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WorkFilter>('all')
  const input = useRef<HTMLInputElement>(null)
  const items = selectWork(data.items, { query, filter, userId: user?.id ?? '', principalId })
  const viewer = { userId: user?.id ?? '', role: activeWorkspace?.role ?? null }
  const open = (id: string) => { const next = new URLSearchParams(params.toString()); next.set('id', id); router.replace(`${pathname}?${next}`, { scroll: false }) }
  return <AppScreenShell>
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-(--border) px-6 py-3">
      <h1 className="mr-auto text-lg font-medium lowercase tracking-tight" style={{ fontFamily: 'var(--font-serif)' }}>work{!solo ? <span className="ml-2 text-sm text-(--muted)">/ {scope}</span> : null}</h1>
      <HeaderSearch value={query} onChange={setQuery} label="Search tasks" placeholder="Search tasks…" />
      <button onClick={() => input.current?.focus()} disabled={!canCreate('content', scope)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-(--surface-subtle) px-3 text-xs font-medium disabled:opacity-50"><Plus size={14} />New task</button>
    </header>
    <div className="flex shrink-0 flex-wrap gap-2 border-b border-(--border) px-6 py-3" aria-label="Task filters">
      {([{ id: 'all', label: 'Everything' }, { id: 'needs-you', label: 'Needs you' }, { id: 'assigned', label: 'Assigned to me' }] satisfies { id: WorkFilter; label: string }[]).map((option) => <button key={option.id} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)} className={`rounded-full border px-3 py-1 text-xs ${filter === option.id ? 'border-(--muted-light) bg-(--surface-subtle) text-(--foreground)' : 'border-(--border) text-(--muted)'}`}>{option.label}</button>)}
    </div>
    <AppScreenBody padding="none" maxWidth="none" className="min-w-0 flex-1" scroll="auto">
      <QuickAdd key={`${activeWorkspaceId}:${scope}`} inputRef={input} pending={data.pending.has('new')} disabled={!canCreate('content', scope)} onCreate={(title) => data.create({ title, scope })} />
      {data.error || people.error ? <div role="alert" className="mx-6 mb-3 flex flex-wrap items-center gap-3 text-xs text-red-600 dark:text-red-400">{data.error ?? people.error}<button className="underline" onClick={() => { void data.refresh(); people.refresh() }}>Try again</button></div> : null}
      {data.loading ? <div aria-busy="true" aria-label="Loading tasks" className="mx-6 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-(--surface-subtle) motion-reduce:animate-none" />)}</div>
        : view === 'list' ? <WorkList items={items} people={people.people} pending={data.pending} canEdit={(item) => canEditResource(item, viewer) && (item.scope !== 'workspace' || canCreate('content', 'workspace'))} onUpdate={data.update} onOpen={(item) => open(item._id)} />
          : <div className="px-6 py-16 text-center"><List size={20} className="mx-auto mb-3 text-(--muted)" /><h2 className="text-sm font-medium">Your tasks are available in List</h2><button onClick={() => { const next = new URLSearchParams(params.toString()); next.set('view', 'list'); router.replace(`${pathname}?${next}`, { scroll: false }) }} className="mt-3 text-sm text-(--muted) underline">Open List</button></div>}
    </AppScreenBody>
  </AppScreenShell>
}
