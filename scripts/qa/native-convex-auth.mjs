import { stat } from 'node:fs/promises'
import { request } from 'playwright'
import { preloadQuery, preloadedQueryResult } from 'convex/nextjs'
import { makeFunctionReference } from 'convex/server'

let client
try {
  const origin = new URL(process.env.CN02_PREVIEW_ORIGIN)
  const previewName = origin.hostname.split('.')[0]
  if (!/^https:\/\/pr-[1-9][0-9]*\.preview\.getoverlay\.io\/$/.test(origin.href)) throw new Error('Invalid Preview origin')
  const revision = process.env.CN02_PREVIEW_SHA
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Verified head SHA required')
  // These assertions must come from the trusted controller/team API, not from a page.
  if (process.env.CN02_VERIFIED_BACKEND_TYPE !== 'preview' || process.env.CN02_VERIFIED_PREVIEW_NAME !== previewName) {
    throw new Error('Verify backend ownership before running')
  }
  const url = process.env.CN02_CONVEX_URL
  if (!/^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(url ?? '')) throw new Error('Verified Convex URL required')
  const storageState = process.env.CN02_STORAGE_STATE
  const mode = (await stat(storageState)).mode
  if (mode & 0o077) throw new Error('Storage state must be private')
  client = await request.newContext({ baseURL: origin.origin, storageState })
  const response = await client.get('/api/auth/convex-token', { maxRedirects: 0 })
  if (!response.ok()) throw new Error('Native token unavailable')
  const { token, userId } = await response.json()
  if (typeof token !== 'string' || !token || typeof userId !== 'string' || !userId) throw new Error('Missing native identity')
  const viewer = makeFunctionReference('auth/viewer:current')
  const preloaded = await preloadQuery(viewer, {}, { url, token })
  const identityMatched = preloadedQueryResult(preloaded)?.userId === userId
  const anonymous = await preloadQuery(viewer, {}, { url })
  const anonymousIsNull = preloadedQueryResult(anonymous) === null
  // Preloads hydrate data, never credentials.
  const preloadExcludesToken = !JSON.stringify(preloaded).includes(token)
  console.log(JSON.stringify({ revision, identityMatched, anonymousIsNull, preloadExcludesToken }))
  if (!identityMatched || !anonymousIsNull || !preloadExcludesToken) process.exitCode = 1
} catch {
  console.error('Native authentication/preload verification failed; no private details recorded.')
  process.exitCode = 1
} finally {
  await client?.dispose()
}
