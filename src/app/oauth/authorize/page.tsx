import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LandingAuthBoundary } from '@/app/auth/_components/AuthPageChrome'
import { AuthorizeClient } from './AuthorizeClient'

export const metadata: Metadata = {
  title: { absolute: 'Connect to Overlay' },
  robots: { index: false, follow: false },
}

/** The consent screen an AI app (ChatGPT, Claude, Cursor…) sends the person to when it asks to use their Overlay workspace. */
export default function AuthorizePage() {
  return (
    <LandingAuthBoundary>
      <Suspense fallback={null}>
        <AuthorizeClient />
      </Suspense>
    </LandingAuthBoundary>
  )
}
