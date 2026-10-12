'use client'

import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import type { ResourceScope } from '@/shared/workspaces/resource-scope'

/** A small chip saying where an archived item came from (Personal or Workspace). */
export function ScopeTag({ scope }: { scope: ResourceScope }) {
  // With one person there is no other scope for an item to have come from.
  if (useIsSoloWorkspace()) return null
  return (
    <span className="shrink-0 rounded-full bg-[var(--surface-subtle)] px-1.5 py-[3px] text-[10px] leading-none text-[var(--muted)]">
      {scope === 'workspace' ? 'Workspace' : 'Personal'}
    </span>
  )
}
