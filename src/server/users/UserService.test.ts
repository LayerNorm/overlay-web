import test from 'node:test'
import assert from 'node:assert/strict'
import type { UserRepository, UserUpsertInput, UserUpsertResult } from './types'
import { UserService } from './UserService'
import { LifecycleEventPublisher, LIFECYCLE_EVENT_TOPIC } from '@/server/lifecycle-events'
import type { EventBus } from '@overlay/app-core'

class CapturingEventBus implements EventBus {
  readonly events: Array<{ payload: unknown; topic: string }> = []

  async publish(topic: string, payload: unknown): Promise<void> {
    this.events.push({ topic, payload })
  }

  subscribe(): () => void {
    return () => {}
  }
}

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

test('UserService publishes a metadata-only lifecycle event only for a new user', async () => {
  const repository = new CapturingUserRepository()
  const eventBus = new CapturingEventBus()
  const service = new UserService({
    authProvider: 'workos',
    lifecycleEvents: new LifecycleEventPublisher({ eventBus }),
    repository,
  })

  await service.upsertFromSession({ user: { id: 'user_123', email: 'person@example.com' } })
  await service.upsertFromSession({ user: { id: 'user_123', email: 'person@example.com' } })

  assert.equal(eventBus.events.length, 1)
  assert.equal(eventBus.events[0]?.topic, LIFECYCLE_EVENT_TOPIC)
  assert.deepEqual(eventBus.events[0]?.payload, {
    attributes: { authProvider: 'workos' },
    classification: 'operational',
    destinations: ['analytics', 'audit', 'email', 'notification'],
    eventId: (eventBus.events[0]?.payload as { eventId: string }).eventId,
    idempotencyKey: 'user.created:workos:user_123',
    name: 'user.created',
    occurredAt: (eventBus.events[0]?.payload as { occurredAt: number }).occurredAt,
    resource: { id: 'user_123', type: 'user' },
    schemaVersion: 1,
    userId: 'user_123',
  })
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
