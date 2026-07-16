import test from 'node:test'
import assert from 'node:assert/strict'
import type { UserRepository, UserUpsertInput, UserUpsertResult } from './types'
import { UserService } from './UserService'

class CapturingUserRepository implements UserRepository {
  readonly inputs: UserUpsertInput[] = []

  async upsertFromIdentity(input: UserUpsertInput): Promise<UserUpsertResult> {
    this.inputs.push(input)
    return {
      success: true,
      isNewUser: this.inputs.length === 1,
      userId: input.user.id,
    }
  }
}

test('UserService upserts a normalized provider identity from a session', async () => {
  const repository = new CapturingUserRepository()
  const service = new UserService({ authProvider: 'better-auth', repository })

  const result = await service.upsertFromSession({
    user: {
      id: ' better-auth-user ',
      email: ' PERSON@Example.COM ',
      firstName: ' Divyansh ',
      lastName: ' Lalwani ',
      profilePictureUrl: ' https://example.com/avatar.png ',
      emailVerified: true,
    },
  })

  assert.deepEqual(result, {
    success: true,
    isNewUser: true,
    userId: 'better-auth-user',
  })
  assert.equal(repository.inputs.length, 1)
  assert.equal(repository.inputs[0].identity.provider, 'better-auth')
  assert.equal(repository.inputs[0].identity.subject, 'better-auth-user')
  assert.equal(repository.inputs[0].identity.email, 'person@example.com')
  assert.equal(repository.inputs[0].user.email, 'person@example.com')
  assert.equal(repository.inputs[0].user.firstName, 'Divyansh')
  assert.equal(repository.inputs[0].user.lastName, 'Lalwani')
  assert.equal(repository.inputs[0].user.emailVerified, true)
})

test('UserService keeps providers separate for the same email', async () => {
  const repository = new CapturingUserRepository()
  const workos = new UserService({ authProvider: 'workos', repository })
  const betterAuth = new UserService({ authProvider: 'better-auth', repository })

  await workos.upsertFromSession({
    user: {
      id: 'workos_123',
      email: 'person@example.com',
    },
  })
  await betterAuth.upsertFromSession({
    user: {
      id: 'better_456',
      email: 'person@example.com',
    },
  })

  assert.equal(repository.inputs[0].identity.provider, 'workos')
  assert.equal(repository.inputs[0].identity.subject, 'workos_123')
  assert.equal(repository.inputs[1].identity.provider, 'better-auth')
  assert.equal(repository.inputs[1].identity.subject, 'better_456')
})

test('UserService rejects sessions without a stable user id or email', async () => {
  const repository = new CapturingUserRepository()
  const service = new UserService({ authProvider: 'workos', repository })

  await assert.rejects(
    () => service.upsertFromSession({ user: { id: '', email: 'person@example.com' } }),
    /session\.user\.id/,
  )
  await assert.rejects(
    () => service.upsertFromSession({ user: { id: 'user_123', email: '' } }),
    /session\.user\.email/,
  )
  await assert.rejects(
    () => service.upsertFromSession({ user: { id: 'user_123', email: 'not-an-email' } }),
    /valid email/,
  )
  assert.equal(repository.inputs.length, 0)
})
