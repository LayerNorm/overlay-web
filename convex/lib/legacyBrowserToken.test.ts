import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { getVerifiedAccessTokenClaims } from './auth'

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

test('a correctly signed HS256 token from the retired browser path is never accepted', async () => {
  process.env.INTERNAL_API_SECRET = 'retired-browser-secret'
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ iss: 'overlay-browser-convex', aud: 'overlay-convex', sub: 'user_a', exp: Math.floor(Date.now() / 1000) + 600 })
  const signature = createHmac('sha256', process.env.INTERNAL_API_SECRET).update(`${header}.${payload}`).digest('base64url')
  assert.equal(await getVerifiedAccessTokenClaims(`${header}.${payload}.${signature}`), null)
})
