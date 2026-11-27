import * as WebBrowser from 'expo-web-browser'
import { Linking } from 'react-native'
import { AUTH_BASE_URL } from './appConfig'
import { buildNativeAuthRequest, completeNativeAuthCallback, isNativeAuthCallbackUrl, type AuthSession } from './authService'

WebBrowser.maybeCompleteAuthSession()

export async function signInWithNativeAuth(
  options: { forceSignIn?: boolean } = {},
): Promise<AuthSession | null> {
  const request = await buildNativeAuthRequest({
    provider: 'authkit',
    redirectUri: new URL('/auth/native/callback', AUTH_BASE_URL).href,
    forceSignIn: options.forceSignIn,
  })
  const authorization = new URL(request.authorizationUrl)
  if (authorization.protocol !== 'https:' || authorization.hostname !== 'api.workos.com' || authorization.pathname !== '/user_management/authorize')
    throw new Error('Unexpected sign-in destination.')

  const result = await new Promise<{ type: string; url?: string }>((resolve, reject) => {
    let settled = false
    const finish = (result: { type: string; url?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      listener.remove()
      resolve(result)
      try { WebBrowser.dismissAuthSession() } catch {}
    }
    const listener = Linking.addEventListener('url', event => {
      if (isNativeAuthCallbackUrl(event.url)) finish({ type: 'success', url: event.url })
    })
    const timer = setTimeout(() => finish({ type: 'cancel' }), 5 * 60 * 1000)
    void WebBrowser.openAuthSessionAsync(authorization.href, 'overlay://auth/callback', { preferEphemeralSession: false })
      .then(finish)
      .catch(error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        listener.remove()
        reject(error)
      })
  })
  if (result.type !== 'success') return null
  if (!result.url) throw new Error('Sign in did not complete. Please try again.')
  const session = await completeNativeAuthCallback(result.url)
  if (!session) throw new Error('Sign in did not complete. Please try again.')
  return session
}
