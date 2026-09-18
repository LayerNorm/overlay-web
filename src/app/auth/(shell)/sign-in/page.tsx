import { deriveOverlayCapabilities } from '@overlay/app-core'
import { getAuthUiOptions } from '@/server/auth/actions'
import { getOverlayRuntimeConfig } from '@/server/config'
import { LandingAuthBoundary } from '../../_components/AuthPageChrome'
import { SignInClient } from './SignInClient'

export default async function SignInPage() {
  const authUiOptions = getAuthUiOptions()
  const ssoEnabled = deriveOverlayCapabilities(await getOverlayRuntimeConfig()).sso

  return (
    <LandingAuthBoundary>
      <SignInClient authUiOptions={authUiOptions} ssoEnabled={ssoEnabled} />
    </LandingAuthBoundary>
  )
}
