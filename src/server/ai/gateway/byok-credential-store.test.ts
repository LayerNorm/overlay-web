import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import { AwsSecretsManagerByokCredentialStore, WorkOSByokCredentialStore } from './byok-credential-store'

test('AWS BYOK credential store keeps identity out of secret names and rotates/deletes by ARN', async () => {
  const commands: unknown[] = []
  const store = new AwsSecretsManagerByokCredentialStore({
    send: async (command) => {
      commands.push(command)
      if (command instanceof CreateSecretCommand) return { ARN: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:overlay/byok/opaque' }
      if (command instanceof GetSecretValueCommand) return { SecretString: 'provider-test-key' }
      return {}
    },
  }, { kmsKeyId: 'arn:aws:kms:ap-south-1:123456789012:key/customer-key', prefix: 'jpgs/overlay/byok' })

  const credentialRef = await store.write({
    apiKey: 'provider-test-key',
    context: { purpose: 'byok-provider-key', providerId: 'openai', userId: 'student@example.edu' },
  })
  assert.equal(credentialRef.includes('student@example.edu'), false)
  assert.equal(await store.read(credentialRef), 'provider-test-key')
  await store.update({ credentialRef, apiKey: 'provider-rotated-key' })
  await store.delete(credentialRef)

  const create = commands[0] as CreateSecretCommand
  const createInput = create.input
  assert.match(createInput.Name ?? '', /^jpgs\/overlay\/byok\/[0-9a-f-]{36}$/)
  assert.equal(createInput.Name?.includes('student'), false)
  assert.equal(createInput.KmsKeyId, 'arn:aws:kms:ap-south-1:123456789012:key/customer-key')
  assert.deepEqual(createInput.Tags, [
    { Key: 'managed-by', Value: 'overlay' },
    { Key: 'purpose', Value: 'byok-provider-key' },
  ])
  assert.equal((commands[2] as PutSecretValueCommand).input.SecretId, credentialRef)
  assert.equal((commands[3] as DeleteSecretCommand).input.ForceDeleteWithoutRecovery, true)
})

test('AWS BYOK credential store writes and deletes by the supplied name', async () => {
  const commands: unknown[] = []
  const store = new AwsSecretsManagerByokCredentialStore({
    send: async (command) => {
      commands.push(command)
      if (command instanceof CreateSecretCommand) return { ARN: 'arn:aws:secretsmanager:region:123456789012:secret:exact/name' }
      const error = new Error('missing secret')
      error.name = 'ResourceNotFoundException'
      throw error
    },
  }, { prefix: 'overlay/byok' })
  const name = 'exact/name'

  assert.match(store.newCredentialName(), /^overlay\/byok\/[0-9a-f-]{36}$/)
  await store.write({
    name,
    apiKey: 'provider-test-key',
    context: { purpose: 'subscription-credential', providerId: 'subscription-codex', userId: 'user-1' },
  })
  await store.deleteByName(name)

  assert.equal((commands[0] as CreateSecretCommand).input.Name, name)
  assert.equal((commands[1] as DeleteSecretCommand).input.SecretId, name)
  assert.equal((commands[1] as DeleteSecretCommand).input.ForceDeleteWithoutRecovery, true)
})

test('WorkOS BYOK credential store preserves an explicit name and generates its existing format', async (t) => {
  const previousApiKey = process.env.WORKOS_API_KEY
  process.env.WORKOS_API_KEY = 'workos_test_key'
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.WORKOS_API_KEY
    else process.env.WORKOS_API_KEY = previousApiKey
  })

  let body: Record<string, unknown> | undefined
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json({ id: 'vault-object-id' })
  })
  const store = new WorkOSByokCredentialStore()
  const name = 'byok_explicit-name'

  assert.match(store.newCredentialName(), /^byok_[0-9a-f-]{36}$/)
  await store.write({
    name,
    apiKey: 'provider-test-key',
    context: { purpose: 'subscription-credential', providerId: 'subscription-codex', userId: 'user-1' },
  })

  assert.equal(body?.name, name)
})
