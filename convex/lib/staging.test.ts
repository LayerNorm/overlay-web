import assert from 'node:assert/strict'
import test from 'node:test'
import { requireStagingSeedEnvironment } from './staging'

const staging = {
  OVERLAY_DEPLOYMENT_ENV: 'staging', CONVEX_CLOUD_URL: 'https://doting-cuttlefish-819.convex.cloud',
  WORKOS_CLIENT_ID: 'client_01KJ9A19X317J7VWRWQ6XBME9Z',
  STAGING_SMOKE_USER_ID: 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2',
  STAGING_SMOKE_EMAIL: 'overlay-preview-qa@getoverlay.io',
}

test('staging fixtures require the pinned platform URL and configured sandbox identity', () => {
  assert.deepEqual(requireStagingSeedEnvironment(staging), {
    userId: staging.STAGING_SMOKE_USER_ID, email: staging.STAGING_SMOKE_EMAIL,
  })
  for (const patch of [
    { OVERLAY_DEPLOYMENT_ENV: 'preview' }, { OVERLAY_DEPLOYMENT_ENV: 'production' },
    { CONVEX_CLOUD_URL: 'https://colorful-chickadee-419.convex.cloud' },
    { CONVEX_CLOUD_URL: 'https://different-caiman-77.convex.cloud' },
    { CONVEX_CLOUD_URL: undefined }, { WORKOS_CLIENT_ID: 'production-client' },
    { STAGING_SMOKE_USER_ID: 'user_other' }, { STAGING_SMOKE_EMAIL: 'other@example.test' },
  ]) assert.throws(() => requireStagingSeedEnvironment({ ...staging, ...patch }))
})
