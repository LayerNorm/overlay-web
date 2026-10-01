import { deriveOverlayCapabilities } from '@overlay/app-core'
import { getAuthUiOptions } from '@/server/auth/actions'
import { getOverlayRuntimeConfig } from '@/server/config'
import { LandingAuthBoundary } from '../../_components/AuthPageChrome'
import { Suspense } from 'react'
import { SignUpClient } from './SignUpClient'

export default async function SignUpPage() {
  const authUiOptions = getAuthUiOptions()
  const ssoEnabled = deriveOverlayCapabilities(await getOverlayRuntimeConfig()).sso

  return (
    <LandingAuthBoundary>
      <Suspense fallback={null}>
      <SignUpClient authUiOptions={authUiOptions} ssoEnabled={ssoEnabled} />
      </Suspense>
    </LandingAuthBoundary>
  )
}
