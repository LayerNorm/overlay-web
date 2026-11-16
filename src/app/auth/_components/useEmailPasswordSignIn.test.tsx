import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useEffect, useState } from 'react'
import { AuthProvider } from '@/contexts/AuthContext'
import { useEmailPasswordSignIn } from './useEmailPasswordSignIn'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { unmount(): void }
}

test('email/password sign-in reloads invitation auth state and preserves desktop redirects', async () => {
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  let authenticated = false
  let signInSucceeds = false
  const calls: string[] = []
  const replacements: string[] = []
  const location = {
    href: '',
    replace: (url: string) => {
      calls.push(`location.replace:${url}`)
      replacements.push(url)
    },
  }

  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location,
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  } })
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path === '/api/auth/sign-in') {
      calls.push('POST /api/auth/sign-in')
      authenticated = signInSucceeds
      return {
        ok: signInSucceeds,
        json: async () => signInSucceeds ? {} : { error: 'Invalid credentials' },
      } as Response
    }
    if (path === '/api/auth/session') {
      calls.push(`GET /api/auth/session:${authenticated ? 'authenticated' : 'unauthenticated'}`)
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => authenticated
          ? { authenticated: true, user: { id: 'user-1', email: 'invitee@example.test' } }
          : { authenticated: false },
      } as Response
    }
    throw new Error(`Unexpected request: ${path}`)
  }) as typeof fetch

  let renderer!: ReturnType<typeof create>
  let signIn!: () => Promise<boolean>
  let setRedirectUrl!: (value: string) => void
  const onReady = (signInAction: () => Promise<boolean>, setRedirect: (value: string) => void) => {
    signIn = signInAction
    setRedirectUrl = setRedirect
  }
  function SignInHarness({ onReady }: {
    onReady(signInAction: () => Promise<boolean>, setRedirect: (value: string) => void): void
  }) {
    const [redirectUrl, setRedirect] = useState('/app/invitations/invite_test')
    const { signIn: signInAction } = useEmailPasswordSignIn({ email: 'invitee@example.test', password: 'password', redirectUrl, setError: () => {} })
    useEffect(() => onReady(signInAction, setRedirect), [onReady, signInAction, setRedirect])
    return null
  }

  try {
    await act(async () => {
      renderer = create(<AuthProvider><SignInHarness onReady={onReady} /></AuthProvider>)
    })
    calls.length = 0

    let result = true
    await act(async () => { result = await signIn() })
    assert.equal(result, false)
    assert.deepEqual(calls, ['POST /api/auth/sign-in'])
    assert.deepEqual(replacements, [])
    assert.equal(location.href, '')

    signInSucceeds = true
    calls.length = 0
    await act(async () => { result = await signIn() })
    assert.equal(result, true)
    assert.deepEqual(calls, [
      'POST /api/auth/sign-in',
      'GET /api/auth/session:authenticated',
      'location.replace:/app/invitations/invite_test',
    ])
    assert.deepEqual(replacements, ['/app/invitations/invite_test'])
    assert.equal(location.href, '')

    await act(async () => { setRedirectUrl('overlay://auth/transfer?token=fixture') })
    calls.length = 0
    await act(async () => { result = await signIn() })
    assert.equal(result, true)
    assert.equal(location.href, 'overlay://auth/transfer?token=fixture')
    assert.deepEqual(replacements, ['/app/invitations/invite_test'])
  } finally {
    if (renderer) await act(async () => renderer.unmount())
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch)
    else Reflect.deleteProperty(globalThis, 'fetch')
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  }
})
