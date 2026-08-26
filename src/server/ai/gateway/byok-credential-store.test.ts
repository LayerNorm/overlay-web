import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import { AwsSecretsManagerByokCredentialStore } from './byok-credential-store'

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
