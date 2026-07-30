import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveVerifiedBearerUserId } from './app-api-auth'

test('bearer authentication derives user identity from verified token claims', () => {
  assert.equal(
    resolveVerifiedBearerUserId({
    iss: 'https://auth.example.test',
    sub: 'user_from_token',
    exp: Math.floor(Date.now() / 1000) + 3600,
    }, ''),
    'user_from_token',
  )
})

test('bearer authentication rejects a client user id that conflicts with token subject', () => {
  const claims = {
    iss: 'https://auth.example.test',
    sub: 'user_from_token',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  assert.equal(resolveVerifiedBearerUserId(claims, 'different_user'), null)
  assert.equal(
    resolveVerifiedBearerUserId(claims, 'user_from_token'),
    'user_from_token',
  )
})

test('bearer authentication rejects missing or malformed verified subjects', () => {
  assert.equal(resolveVerifiedBearerUserId(null, ''), null)
  assert.equal(resolveVerifiedBearerUserId({}, ''), null)
  assert.equal(resolveVerifiedBearerUserId({ sub: '   ' }, ''), null)
})
