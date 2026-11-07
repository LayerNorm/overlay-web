import { useCallback, useMemo, useState } from 'react'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { invalidateMentionCache } from '@/components/mentions/mention-search'
import { useMentionSearch } from '@/hooks/use-mention-search'
import type { MentionCategory, MentionType } from '@/shared/knowledge/mention-types'

const CATEGORY_TYPES: Array<{ type: MentionType; capability: 'files' | 'integrations' | 'automations' | 'skills' | 'mcpServers' | 'chat' }> = [
  { type: 'file', capability: 'files' },
  { type: 'connector', capability: 'integrations' },
  { type: 'automation', capability: 'automations' },
  { type: 'skill', capability: 'skills' },
  { type: 'mcp', capability: 'mcpServers' },
  { type: 'chat', capability: 'chat' },
]

/**
 * The composer's @-menu data: an indexed, permission-checked native search per keystroke (the newest items for a bare
 * `@`), instead of downloading every list and filtering here. Connectors still come from the integration provider.
 */
export function useMentionData() {
  const { capabilities } = useOverlayCapabilities()
  const availableTypes = useMemo(
    () => CATEGORY_TYPES.filter((category) => capabilities[category.capability]).map((category) => category.type),
    [capabilities],
  )
  const searchMentions = useMentionSearch()
  const [loading, setLoading] = useState(false)

  const search = useCallback(async (query: string): Promise<MentionCategory[]> => {
    setLoading(true)
    try {
      const allowed = new Set(availableTypes)
      return (await searchMentions(query)).filter((category) => allowed.has(category.type))
    } catch {
      return []
    } finally {
      setLoading(false)
    }
  }, [availableTypes, searchMentions])

  /** Warms the bare-`@` view when the composer gains focus. */
  const fetchAllData = useCallback(async () => { await search('') }, [search])
  const invalidateCache = useCallback(() => { invalidateMentionCache() }, [])

  return { availableTypes, search, loading, invalidateCache, fetchAllData }
}
