'use client'

import { useEffect } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import type { AppSettings } from '@overlay/app-core'
import { useAccountIdentitySync, useAuth } from '@/contexts/AuthContext'
import { useAppSettingsSync } from '@/components/providers/AppSettingsProvider'
import { useHasConvexClient } from '@/components/providers/ConvexAuthProvider'
import { api } from '../../../convex/_generated/api'

/**
 * Keeps the signed-in account's name, photo and UI settings live. The auth and settings providers sit above the
 * Convex client, so this subscribes inside it and hands each snapshot up. A change saved in another tab or on another
 * device applies here; unsaved local changes stay on top until the server confirms them.
 */
export function LiveAccountSync() {
  return useHasConvexClient() ? <LiveAccountSubscriptions /> : null
}

function LiveAccountSubscriptions() {
  const { user } = useAuth()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const ready = isAuthenticated && !isLoading
  const identity = useQuery(api.auth.accountBrowse.identity, ready ? {} : 'skip')
  const settings = useQuery(api.platform.uiSettings.mine, ready ? {} : 'skip')
  const applyIdentity = useAccountIdentitySync()
  const applySettings = useAppSettingsSync()
  const userId = user?.id ?? null

  useEffect(() => {
    if (!applyIdentity || !userId || identity === undefined) return
    applyIdentity(identity ? { userId, displayName: identity.displayName, photoUrl: identity.photoUrl } : null)
  }, [applyIdentity, identity, userId])

  useEffect(() => {
    if (applySettings && settings) applySettings(settings as Partial<AppSettings>)
  }, [applySettings, settings])

  return null
}
