'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { getDesktopBridge, type DesktopBridge, type Handshake } from '@overlay/desktop-bridge'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@overlay/ui/primitives'

type Desktop = { bridge: DesktopBridge; info: Handshake }
const DesktopContext = createContext<Desktop | null>(null)
export const useDesktopBridge = () => useContext(DesktopContext)

export function DesktopProvider({ children }: { children: ReactNode }) {
  const [desktop, setDesktop] = useState<Desktop | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    let disposed = false
    void bridge.handshake().then((info) => {
      if (disposed || info.bridgeVersion !== 1) return
      setDesktop({ bridge, info })
      document.documentElement.dataset.desktop = info.platform === 'darwin' ? 'mac' : info.platform
    }).catch(() => { /* An incompatible desktop behaves like a browser. */ })
    return () => { disposed = true; delete document.documentElement.dataset.desktop }
  }, [])
  useEffect(() => {
    if (!desktop?.info.capabilities.includes('auth') || isLoading || isAuthenticated) return
    void desktop.bridge.call('auth.signedOut', undefined).catch(() => {})
  }, [desktop, isAuthenticated, isLoading])
  useEffect(() => {
    if (!desktop) return
    const offClick = desktop.info.capabilities.includes('notifications')
      ? desktop.bridge.on('notifications.click', (route) => { if (route.startsWith('/app') && !route.includes('\\')) router.push(route) }) : () => {}
    const offUpdate = desktop.info.capabilities.includes('updates')
      ? desktop.bridge.on('updates.status', (status) => setUpdateReady(status.state === 'downloaded')) : () => {}
    return () => { offClick(); offUpdate() }
  }, [desktop, router])
  return <DesktopContext.Provider value={desktop}>
    {updateReady && desktop ? <div role="status" className="fixed right-4 top-4 z-50 flex items-center gap-3 rounded-lg border bg-popover p-3 text-sm shadow-sm">An Overlay update is ready.<Button size="sm" variant="outline" onClick={() => void desktop.bridge.call('updates.install', undefined)}>Restart to update</Button><Button size="sm" variant="ghost" onClick={() => setUpdateReady(false)}>Later</Button></div> : null}
    {children}
  </DesktopContext.Provider>
}
