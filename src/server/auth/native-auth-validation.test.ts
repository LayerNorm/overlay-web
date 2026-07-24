import 'server-only'

import test from 'node:test'
import assert from 'node:assert/strict'

const {
  isAllowedNativeRedirectUri,
  isAllowedWorkOsAuthorizationUrl,
  isNativeAuthProvider,
  isValidNativeAuthCode,
  isValidNativeAuthState,
  isValidPkceVerifier,
} = await import(new URL('./native-auth-validation.ts', import.meta.url).href)

test('native auth provider allowlist is strict', () => {
  assert.equal(isNativeAuthProvider('GoogleOAuth'), true)
  assert.equal(isNativeAuthProvider('AppleOAuth'), true)
  assert.equal(isNativeAuthProvider('MicrosoftOAuth'), true)
  assert.equal(isNativeAuthProvider('authkit'), true)
  assert.equal(isNativeAuthProvider('GitHubOAuth'), false)
  assert.equal(isNativeAuthProvider(''), false)
})

test('native auth redirect URI only allows exact callback route', () => {
  assert.equal(isAllowedNativeRedirectUri('https://www.getoverlay.io/auth/native/callback'), true)
  assert.equal(
    isAllowedNativeRedirectUri(
      'https://overlay.example.com/auth/native/callback',
      'https://overlay.example.com',
    ),
    true,
  )
  assert.equal(
    isAllowedNativeRedirectUri(
      'https://evil.example/auth/native/callback',
      'https://overlay.example.com',
    ),
    false,
  )
  assert.equal(isAllowedNativeRedirectUri('overlay://auth/callback'), false)
  assert.equal(isAllowedNativeRedirectUri('overlay://auth/callback?code=abc&state=def'), false)
  assert.equal(isAllowedNativeRedirectUri('overlay://auth/callback#code=abc'), false)
  assert.equal(
    isAllowedNativeRedirectUri('https://www.getoverlay.io/auth/native/callback?code=abc&state=def'),
    false,
  )
  assert.equal(
    isAllowedNativeRedirectUri('https://www.getoverlay.io/auth/native/callback#code=abc'),
    false,
  )
  assert.equal(isAllowedNativeRedirectUri('overlay://auth/callback/evil'), false)
  assert.equal(isAllowedNativeRedirectUri('overlay://auth/callback.evil'), false)
  assert.equal(isAllowedNativeRedirectUri('overlay://evil/callback'), false)
  assert.equal(isAllowedNativeRedirectUri('https://www.getoverlay.io/auth/callback'), false)
  assert.equal(
    isAllowedNativeRedirectUri('https://www.getoverlay.io/auth/native/callback/evil'),
    false,
  )
  assert.equal(isAllowedNativeRedirectUri('https://evil.example/auth/native/callback'), false)
  assert.equal(isAllowedNativeRedirectUri('overlay://auth/transfer'), false)
})

test('native auth state and PKCE verifier validation reject malformed values', () => {
  assert.equal(isValidNativeAuthState('A'.repeat(32)), true)
  assert.equal(isValidNativeAuthState('A'.repeat(31)), false)
  assert.equal(isValidNativeAuthState('A'.repeat(129)), false)
  assert.equal(isValidNativeAuthState('not valid because spaces'), false)

  assert.equal(isValidPkceVerifier('A'.repeat(43)), true)
  assert.equal(isValidPkceVerifier('A'.repeat(42)), false)
  assert.equal(isValidPkceVerifier('A'.repeat(129)), false)
  assert.equal(isValidPkceVerifier('bad+verifier'), false)
})

test('native auth code validation is permissive but bounded', () => {
  assert.equal(isValidNativeAuthCode('abcDEF123456'), true)
  assert.equal(isValidNativeAuthCode('short'), false)
  assert.equal(isValidNativeAuthCode('A'.repeat(4097)), false)
  assert.equal(isValidNativeAuthCode('bad code with spaces'), false)
})

test('native auth authorization URL must point at WorkOS authorize endpoint', () => {
  assert.equal(
    isAllowedWorkOsAuthorizationUrl(
      'https://api.workos.com/user_management/authorize?client_id=client_123',
    ),
    true,
  )
  assert.equal(
    isAllowedWorkOsAuthorizationUrl('https://evil.example/user_management/authorize'),
    false,
  )
  assert.equal(
    isAllowedWorkOsAuthorizationUrl('http://api.workos.com/user_management/authorize'),
    false,
  )
  assert.equal(isAllowedWorkOsAuthorizationUrl('https://api.workos.com/sso/authorize'), false)
})
