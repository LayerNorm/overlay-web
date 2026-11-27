import { useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useLiveResource } from '../../hooks/useLiveResource'
import { api } from '../../services/convexClient'
import { persistUiSettings } from '../../services/settingsService'
import { normalizeNativeSettings } from '../../services/settingsNativeService'
export function SettingsLiveBridge() {
  const { user } = useAuth()
  const { isInitialized } = useAppSession()
  const ready = useNativeDataReady()
  const settings = useLiveResource(api.platform.uiSettings.mine, ready && isInitialized ? {} : null, user?.id)
  useEffect(() => {
    if (settings.data) void persistUiSettings(normalizeNativeSettings(settings.data)).catch(() => undefined)
  }, [settings.data])
  return null
}
