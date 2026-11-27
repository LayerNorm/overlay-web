import * as WebBrowser from 'expo-web-browser'
import { Linking } from 'react-native'
import { AUTH_BASE_URL } from './appConfig'
import {
  buildNativeAuthRequest,
  exchangeNativeAuthCode,
  loadAuthSession,
  clearPkceVerifier,
} from './authService'

let state = { busy: false, error: null as string | null }
let callbackState: string | null = null
const listeners = new Set<() => void>()
export const getAccountDeletionState = () => state
export const subscribeAccountDeletion = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function isAccountDeletionCallback(url: string): boolean {
  try {
    return callbackState !== null && new URL(url).searchParams.get('state') === callbackState
  } catch {
    return false
  }
}
function publish(busy: boolean, error: string | null = null) {
  state = { busy, error }
  listeners.forEach((listener) => listener())
}

const NATIVE_CALLBACK = 'overlay://auth/callback'
function matchesCallback(url: URL, redirectUri: string): boolean {
  const expected = new URL(redirectUri)
  return (
    (url.origin === expected.origin && url.pathname === expected.pathname) ||
    (url.protocol === 'overlay:' && url.hostname === 'auth' && url.pathname === '/callback')
  )
}
async function openReauthentication(
  url: string,
  redirectUri: string,
): Promise<{ type: string; url?: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result: { type: string; url?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      listener.remove()
      resolve(result)
      try {
        WebBrowser.dismissAuthSession()
      } catch {}
    }
    const listener = Linking.addEventListener('url', (event) => {
      try {
        if (matchesCallback(new URL(event.url), redirectUri))
          finish({ type: 'success', url: event.url })
      } catch {}
    })
    const timer = setTimeout(() => finish({ type: 'cancel' }), 5 * 60 * 1000)
    void WebBrowser.openAuthSessionAsync(url, NATIVE_CALLBACK, { preferEphemeralSession: true })
      .then(finish)
      .catch((error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          listener.remove()
          reject(error)
        }
      })
  })
}

export async function deleteAccountWithReauthentication(
  userId: string,
  signOut: () => Promise<void>,
): Promise<void> {
  if (state.busy) throw new Error('Account deletion is already in progress.')
  publish(true)
  try {
    if ((await loadAuthSession())?.user.id !== userId)
      throw new Error('Your account changed. Sign in again.')
    const redirectUri = new URL('/auth/native/callback', AUTH_BASE_URL).href
    const request = await buildNativeAuthRequest({
      provider: 'authkit',
      redirectUri,
      forceSignIn: true,
      purpose: 'account-deletion',
    })
    callbackState = request.state
    const authorization = new URL(request.authorizationUrl)
    if (authorization.protocol !== 'https:' || authorization.hostname !== 'api.workos.com')
      throw new Error('Unexpected sign-in destination.')
    authorization.searchParams.set('prompt', 'login')
    authorization.searchParams.set('max_age', '0')
    const result = await openReauthentication(authorization.href, redirectUri)
    if (result.type !== 'success' || !result.url)
      throw new Error('Sign-in cancelled. Your account has not been deleted.')
    const callback = new URL(result.url)
    if (
      !matchesCallback(callback, redirectUri) ||
      callback.searchParams.get('state') !== request.state
    )
      throw new Error('Sign-in verification failed. Your account has not been deleted.')
    const code = callback.searchParams.get('code')
    if (!code || callback.searchParams.has('error'))
      throw new Error('Sign-in did not complete. Your account has not been deleted.')
    const fresh = await exchangeNativeAuthCode({ code, codeVerifier: request.codeVerifier })
    if (fresh.user.id !== userId || (await loadAuthSession())?.user.id !== userId)
      throw new Error('Sign in with the account you are deleting. No account was deleted.')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120000)
    try {
      const response = await fetch(new URL('/api/account/delete', AUTH_BASE_URL).href, {
        method: 'POST',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${fresh.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmation: 'DELETE', userId, accessToken: fresh.accessToken }),
      })
      const data = (await response.json().catch(() => null)) as {
        success?: boolean
        error?: string
      } | null
      if (!response.ok || data?.success !== true)
        throw new Error(data?.error || 'Could not confirm account deletion. Please try again.')
      if ((await loadAuthSession())?.user.id === userId) await signOut()
    } finally {
      clearTimeout(timer)
    }
    publish(false)
  } catch (error) {
    publish(false, error instanceof Error ? error.message : 'Could not delete your account.')
    throw error
  } finally {
    await clearPkceVerifier()
  }
}
