import assert from 'node:assert/strict'

/** Browser tokens are handler arguments, never native Convex auth credentials. */
export async function probeReactiveQueries({ backendUrl, userId, token, workspaceId,
  createClient = async url => {
    const { ConvexClient } = await import('convex/browser')
    return new ConvexClient(url, { logger: false })
  }, timeoutMs = 20_000 }) {
  const url = new URL(backendUrl)
  assert.ok(url.protocol === 'https:' && /^[a-z0-9-]+\.convex\.cloud$/.test(url.hostname))
  assert.ok(userId?.startsWith('user_') && typeof token === 'string' && token.split('.').length === 3)
  const client = await createClient(url.origin)
  async function first(args) {
    let unsubscribe, timer
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), timeoutMs)
        unsubscribe = client.onUpdate('chat/conversations:list', args, resolve,
          () => reject(new Error('Realtime query failed')))
      })
    } finally { clearTimeout(timer); unsubscribe?.() }
  }
  try {
    const rows = await first({ userId, accessToken: token, ...(workspaceId ? { workspaceId } : {}), limit: 10 })
    assert.ok(Array.isArray(rows) && rows.length > 0, 'Realtime query did not return the signed-in account fixture')
    assert.ok(rows.every(row => row.userId === userId), 'Realtime query returned another account')
    const other = await first({ userId: 'user_overlay_release_other', accessToken: token, limit: 10 })
    assert.ok(Array.isArray(other) && other.length === 0, 'Realtime token accepted a different user')
    return { ownAccountRead: true, differentUserDenied: true }
  } finally { await client.close() }
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
