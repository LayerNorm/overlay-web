import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_MOBILE_PREFERENCES,
  loadMobilePreferences,
  subscribeMobilePreferences,
  updateMobilePreferences,
  type MobilePreferences,
} from '../services/mobilePreferencesService'

export function useMobilePreferences(): {
  preferences: MobilePreferences
  isLoading: boolean
  updatePreferences: (patch: Partial<MobilePreferences>) => Promise<MobilePreferences>
} {
  const [preferences, setPreferences] = useState<MobilePreferences>(DEFAULT_MOBILE_PREFERENCES)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void loadMobilePreferences()
      .then((loaded) => {
        if (!cancelled) setPreferences(loaded)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    const unsubscribe = subscribeMobilePreferences(setPreferences)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const updatePreferences = useCallback(async (patch: Partial<MobilePreferences>) => {
    const next = await updateMobilePreferences(patch)
    setPreferences(next)
    return next
  }, [])

  return useMemo(
    () => ({ preferences, isLoading, updatePreferences }),
    [isLoading, preferences, updatePreferences],
  )
}
