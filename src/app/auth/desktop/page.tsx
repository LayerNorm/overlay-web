import type { Metadata } from 'next'
import { connection } from 'next/server'
import { DesktopHome } from './DesktopHome'

export const metadata: Metadata = {
  title: 'Overlay',
  robots: { index: false, follow: false },
}

/** The desktop app's signed-out screen. Rendered per request for the CSP nonce (see the auth shell layout). */
export default async function DesktopHomePage() {
  await connection()
  return <DesktopHome />
}
