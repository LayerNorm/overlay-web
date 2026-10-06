import type { ResourceScope } from '@/shared/workspaces/resource-scope'

/** A small chip saying where an archived item came from (Personal or Workspace). */
export function ScopeTag({ scope }: { scope: ResourceScope }) {
  return (
    <span className="shrink-0 rounded-full bg-[var(--surface-subtle)] px-1.5 py-[3px] text-[10px] leading-none text-[var(--muted)]">
      {scope === 'workspace' ? 'Workspace' : 'Personal'}
    </span>
  )
}
