'use client'

import { useCallback, useState } from 'react'

/** Adds an agent to the expanded set; opening one of the exclusive agents (the pinned chiefs) closes the others. */
function withOpened(current: ReadonlySet<string>, agentId: string, exclusiveIds: readonly string[]): Set<string> {
  const next = new Set(current)
  if (exclusiveIds.includes(agentId)) for (const id of exclusiveIds) next.delete(id)
  next.add(agentId)
  return next
}

/**
 * Which agents show their threads in the sidebar. Navigation reveals the selected agent; a manual collapse holds
 * until navigation selects it again. At most one of `exclusiveIds` (the pinned chief tiles, which share one thread
 * list below them) is open at a time.
 */
export function useAgentExpansion(activeAgentId: string | null, exclusiveIds: readonly string[] = []) {
  const [previousAgentId, setPreviousAgentId] = useState(activeAgentId)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeAgentId ? [activeAgentId] : []),
  )

  // Reveal a newly selected agent without overriding manual collapse on rerenders.
  if (activeAgentId !== previousAgentId) {
    setPreviousAgentId(activeAgentId)
    if (activeAgentId) setExpanded((current) => withOpened(current, activeAgentId, exclusiveIds))
  }

  const toggle = useCallback((agentId: string, exclusive: readonly string[] = []) => {
    setExpanded((current) => {
      if (!current.has(agentId)) return withOpened(current, agentId, exclusive)
      const next = new Set(current)
      next.delete(agentId)
      return next
    })
  }, [])

  return { expanded, toggle }
}
