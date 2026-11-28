import type { Metadata } from 'next'
import { connection } from 'next/server'
import { ChromeHome } from './ChromeHome'

export const metadata: Metadata = {
  title: 'Overlay',
  robots: { index: false, follow: false },
}

/** The Chrome side panel's signed-out screen. Rendered per request for the CSP nonce (see the auth shell layout). */
export default async function ChromeHomePage() {
  await connection()
  return <ChromeHome />
}
