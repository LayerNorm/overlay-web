'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { CHROME_HOME_PATH, isChromeExtensionFrame } from './chrome-extension'

/**
 * A signed-out Chrome side panel shows its own home, which signs in through a normal tab. Runs again on every path,
 * because `/app` redirects to the first sidebar page after hydration and would otherwise override this redirect.
 */
export function ChromeExtensionSignedOut() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== CHROME_HOME_PATH && isChromeExtensionFrame()) {
      router.replace(CHROME_HOME_PATH)
    }
  }, [isAuthenticated, isLoading, pathname, router])
  return null
}
