import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authenticatedAppUserProfile,
  resolveVerifiedBearerUserId,
} from './app-api-auth'

test('session profile uses the same full name shown in the app shell', () => {
  assert.deepEqual(authenticatedAppUserProfile({
    email: 'dslalwani@gmail.com',
    firstName: ' Divyansh ',
    lastName: ' Lalwani ',
  }), {
    displayName: 'Divyansh Lalwani',
    email: 'dslalwani@gmail.com',
  })
})

test('session profile falls back to email when no first name is available', () => {
  assert.deepEqual(authenticatedAppUserProfile({
    email: ' person@example.com ',
    lastName: 'Only',
  }), {
    displayName: 'person@example.com',
    email: 'person@example.com',
  })
})

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
