import { deriveOverlayCapabilities } from '@overlay/app-core'
import { getAuthUiOptions } from '@/server/auth/actions'
import { getOverlayRuntimeConfig } from '@/server/config'
import { LandingAuthBoundary } from '../../_components/AuthPageChrome'
import { SignUpClient } from './SignUpClient'

export default async function SignUpPage() {
  const authUiOptions = getAuthUiOptions()
  const ssoEnabled = deriveOverlayCapabilities(await getOverlayRuntimeConfig()).sso

  return (
    <LandingAuthBoundary>
      <SignUpClient authUiOptions={authUiOptions} ssoEnabled={ssoEnabled} />
    </LandingAuthBoundary>
  )
}
