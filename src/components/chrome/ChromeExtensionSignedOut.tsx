'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { CHROME_HOME_PATH, isChromeExtensionFrame } from './chrome-extension'

/** A signed-out Chrome side panel shows its own home, which signs in through a normal tab. */
export function ChromeExtensionSignedOut() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!isLoading && !isAuthenticated && isChromeExtensionFrame()) router.replace(CHROME_HOME_PATH)
  }, [isAuthenticated, isLoading, router])
  return null
}
