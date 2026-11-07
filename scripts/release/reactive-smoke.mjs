import assert from 'node:assert/strict'

/** The session's identity token authenticates the socket natively; it is never a query argument. */
export async function probeReactiveQueries({ backendUrl, userId, token,
  createClient = async url => {
    const { ConvexClient } = await import('convex/browser')
    return new ConvexClient(url, { logger: false })
  }, timeoutMs = 20_000 }) {
  const url = new URL(backendUrl)
  assert.ok(url.protocol === 'https:' && /^[a-z0-9-]+\.convex\.cloud$/.test(url.hostname))
  assert.ok(userId?.startsWith('user_') && typeof token === 'string' && token.split('.').length === 3)
  async function viewer(client) {
    let unsubscribe, timer
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), timeoutMs)
        unsubscribe = client.onUpdate('auth/viewer:current', {}, resolve,
          () => reject(new Error('Realtime query failed')))
      })
    } finally { clearTimeout(timer); unsubscribe?.() }
  }
  const signedIn = await createClient(url.origin)
  const anonymous = await createClient(url.origin)
  try {
    signedIn.setAuth(async () => token)
    assert.equal((await viewer(signedIn))?.userId, userId, 'Realtime identity did not match the signed-in account')
    assert.equal(await viewer(anonymous), null, 'Realtime query returned an identity without auth')
    return { ownAccountRead: true, anonymousDenied: true }
  } finally { await Promise.all([signedIn.close(), anonymous.close()]) }
}

export function browserRuntimeErrors(page) {
  const failures = []
  page.on('pageerror', () => failures.push('page error'))
  page.on('console', message => {
    if (message.type() === 'error' && /Failed to authenticate|ConvexError|Uncaught/i.test(message.text())) {
      failures.push('application console error')
    }
  })
  return () => { assert.equal(failures.length, 0, 'Authenticated browser reported a runtime/authentication error') }
}
