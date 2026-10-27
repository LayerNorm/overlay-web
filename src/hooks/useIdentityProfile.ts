'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchWithSessionRecovery } from '@/shared/auth/session-fetch'

export type IdentityProfile = {
  displayName: string
  photoUrl: string | null
  displayNameOverride: string | null
  hasCustomPhoto: boolean
  email: string
  accountDisplayName?: string
  accountPhotoUrl?: string | null
}

export async function identityRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSessionRecovery(url, { credentials: 'same-origin', cache: 'no-store', ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Could not save your changes. Please try again.')
  return body as T
}

export function notifyIdentityUpdated(workspaceId?: string) {
  window.dispatchEvent(new CustomEvent('overlay:identity-updated', { detail: { workspaceId } }))
}

export function useIdentityProfile(endpoint: string) {
  const [profile, setProfile] = useState<IdentityProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    try {
      const value = await identityRequest<IdentityProfile>(endpoint)
      if (current !== generation.current) return
      setProfile(value)
      setError(null)
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : 'Could not load your profile.')
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [endpoint])
  useEffect(() => {
    void load()
    return () => { generation.current += 1 }
  }, [load])
  return { profile, error, loading, reload: load, setProfile }
}
