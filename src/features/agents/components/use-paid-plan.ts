'use client'

import { useEffect, useState } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'

/**
 * Whether the workspace is on a paid plan. `null` until known (and where
 * billing is off), so callers only restrict when the answer is a clear "free";
 * the server still enforces either way.
 */
export function useIsFreePlan(enabled: boolean, workspaceId: string | null): boolean {
  const [free, setFree] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void overlayAppClient.subscription.getResponse({
      cache: 'no-store',
      ...(workspaceId ? { headers: { [ACTIVE_WORKSPACE_HEADER]: workspaceId } } : {}),
    }).then(async (res) => {
      if (!res.ok || cancelled) return
      const data = await res.json() as { planKind?: string; tier?: string } | null
      if (!data || cancelled) return
      setFree((data.planKind ?? (data.tier === 'free' ? 'free' : 'paid')) === 'free')
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [enabled, workspaceId])
  return free
}
