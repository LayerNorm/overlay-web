import assert from 'node:assert/strict'
import { PRODUCTION } from './production-control.mjs'
import { revision } from './staging-control.mjs'

const path = `/repos/${PRODUCTION.repository}/deployments`
const environment = 'overlay-convex-production-sync'
const bootstrap = '7578b691417a992060901f53908683297c4cef43'

/** Record the backend push itself, independently of web and later smoke. */
export async function synchronizeBackend({ github, sha, changed, push }) {
  revision(sha)
  const [previous] = await github(path, { query: { environment, per_page: 1 } })
  let previousSha = bootstrap
  if (previous) {
    assert.ok(Number.isSafeInteger(previous.id) && previous.id > 0)
    assert.equal(previous.environment, environment)
    assert.equal(previous.payload?.backend, PRODUCTION.backend)
    const [status] = await github(`${path}/${previous.id}/statuses`, { query: { per_page: 1 } })
    // A pending/failed push may have changed some functions: force a repair.
    previousSha = status?.state === 'success' ? revision(previous.sha) : undefined
  }
  if (previousSha && !changed(previousSha)) return false
  const deployment = await github(path, { method: 'POST', body: {
    ref: sha, environment, auto_merge: false, required_contexts: [],
    production_environment: true, payload: { backend: PRODUCTION.backend },
    description: 'Synchronize Overlay production Convex',
  } })
  assert.ok(Number.isSafeInteger(deployment.id) && deployment.id > 0)
  assert.equal(deployment.sha, sha)
  const status = state => github(`${path}/${deployment.id}/statuses`, { method: 'POST', body: {
    state, auto_inactive: false, environment,
    description: 'Production Convex source ' + sha.slice(0, 12),
  } })
  await status('in_progress')
  try {
    await push()
    await status('success')
    return true
  } catch (error) {
    // If status recording fails, pending still forces synchronization on retry.
    await status('failure').catch(() => {})
    throw error
  }
}
