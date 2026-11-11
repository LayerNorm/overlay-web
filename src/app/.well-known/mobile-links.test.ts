import assert from 'node:assert/strict'
import test from 'node:test'
import { GET as apple } from './apple-app-site-association/route'
import { GET as android } from './assetlinks.json/route'

test('Apple association covers all native surface families and retains auth', async () => {
  const response = await apple()
  const detail = (await response.json()).applinks.details[0]
  assert.equal(detail.appID, '562STT95YC.com.layernorm.overlay-mobile')
  for (const path of [
    '/auth/native/callback',
    '/work/*',
    '/agent/*',
    '/dm/*',
    '/chat/*',
    '/channel/*',
    '/thread/*',
    '/files/*',
    '/note/*',
    '/automations/*',
    '/settings/*',
  ])
    assert.ok(detail.paths.includes(path))
  assert.deepEqual(
    detail.components.map((entry: { '/': string }) => entry['/']),
    detail.paths,
  )
})
test('Android association uses the native package and is empty without configured fingerprints', async () => {
  const original = process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS
  try {
    delete process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS
    assert.deepEqual(await (await android()).json(), [])
    process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS = ' AA:BB, CC:DD '
    const [entry] = await (await android()).json()
    assert.equal(entry.target.package_name, 'com.layernorm.overlay_mobile')
    assert.deepEqual(entry.target.sha256_cert_fingerprints, ['AA:BB', 'CC:DD'])
  } finally {
    if (original === undefined) delete process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS
    else process.env.ANDROID_APP_LINK_SHA256_CERT_FINGERPRINTS = original
  }
})
