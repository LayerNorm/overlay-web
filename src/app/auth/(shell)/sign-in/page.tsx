import { deriveOverlayCapabilities } from '@overlay/app-core'
import { getAuthUiOptions } from '@/server/auth/actions'
import { getOverlayRuntimeConfig } from '@/server/config'
import { LandingAuthBoundary } from '../../_components/AuthPageChrome'
import { Suspense } from 'react'
import { SignInClient } from './SignInClient'

export default async function SignInPage() {
  const authUiOptions = getAuthUiOptions()
  const ssoEnabled = deriveOverlayCapabilities(await getOverlayRuntimeConfig()).sso

  return (
    <LandingAuthBoundary>
      <Suspense fallback={null}>
      <SignInClient authUiOptions={authUiOptions} ssoEnabled={ssoEnabled} />
      </Suspense>
    </LandingAuthBoundary>
  )
}
