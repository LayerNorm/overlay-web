'use client'

import { useCallback, useState } from 'react'

export function useAgentExpansion(activeAgentId: string | null) {
  const [previousAgentId, setPreviousAgentId] = useState(activeAgentId)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeAgentId ? [activeAgentId] : []),
  )

  // Reveal a newly selected agent without overriding manual collapse on rerenders.
  if (activeAgentId !== previousAgentId) {
    setPreviousAgentId(activeAgentId)
    if (activeAgentId) setExpanded((current) => new Set(current).add(activeAgentId))
  }

  const toggle = useCallback((agentId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }, [])

  return { expanded, toggle }
}
