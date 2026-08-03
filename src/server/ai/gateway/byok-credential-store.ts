import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import type { OverlayRuntimeConfig } from '@/shared/config'
import {
  deleteByokVaultKey,
  readByokVaultKey,
  updateByokVaultKey,
  writeByokVaultKey,
  type ByokVaultKeyContext,
} from './byok-vault'

export type ByokCredentialContext = ByokVaultKeyContext

export interface ByokCredentialStore {
  write(args: { apiKey: string; context: ByokCredentialContext }): Promise<string>
  read(credentialRef: string): Promise<string | null>
  update(args: { credentialRef: string; apiKey: string }): Promise<void>
  delete(credentialRef: string): Promise<void>
}

type SecretsManagerSender = {
  send(command: CreateSecretCommand): Promise<{ ARN?: string }>
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>
  send(command: PutSecretValueCommand): Promise<unknown>
  send(command: DeleteSecretCommand): Promise<unknown>
}

/** WorkOS Vault remains the default for the existing hosted Convex deployment. */
export class WorkOSByokCredentialStore implements ByokCredentialStore {
  async write(args: { apiKey: string; context: ByokCredentialContext }): Promise<string> {
    return await writeByokVaultKey(`byok_${randomUUID()}`, args.apiKey, args.context)
  }

  async read(credentialRef: string): Promise<string | null> {
    return await readByokVaultKey(credentialRef)
  }

  async update(args: { credentialRef: string; apiKey: string }): Promise<void> {
    await updateByokVaultKey(args.credentialRef, args.apiKey)
  }

  async delete(credentialRef: string): Promise<void> {
    await deleteByokVaultKey(credentialRef)
  }
}

/**
 * Customer-controlled secret store for Postgres/AWS deployments. Secret names
 * are opaque random IDs: neither user identity nor provider key material is
 * placed in an ARN, a tag, a database row, or a log message.
 */
export class AwsSecretsManagerByokCredentialStore implements ByokCredentialStore {
  private readonly prefix: string

  constructor(
    private readonly client: SecretsManagerSender = new SecretsManagerClient({}),
    options: { prefix?: string; kmsKeyId?: string } = {},
  ) {
    this.prefix = normalizeSecretPrefix(options.prefix ?? process.env.OVERLAY_AWS_SECRETS_PREFIX)
    this.kmsKeyId = options.kmsKeyId ?? (process.env.OVERLAY_AWS_SECRETS_KMS_KEY_ID?.trim() || undefined)
  }

  private readonly kmsKeyId: string | undefined

  async write(args: { apiKey: string; context: ByokCredentialContext }): Promise<string> {
    const result = await this.client.send(new CreateSecretCommand({
      Name: `${this.prefix}/${randomUUID()}`,
      SecretString: args.apiKey,
      ...(this.kmsKeyId ? { KmsKeyId: this.kmsKeyId } : {}),
      Tags: [
        { Key: 'managed-by', Value: 'overlay' },
        { Key: 'purpose', Value: args.context.purpose },
      ],
    }))
    if (!result.ARN) throw new Error('AWS Secrets Manager did not return a secret ARN')
    return result.ARN
  }

  async read(credentialRef: string): Promise<string | null> {
    const result = await this.client.send(new GetSecretValueCommand({ SecretId: credentialRef }))
    return typeof result.SecretString === 'string' && result.SecretString.length > 0
      ? result.SecretString
      : null
  }

  async update(args: { credentialRef: string; apiKey: string }): Promise<void> {
    await this.client.send(new PutSecretValueCommand({
      SecretId: args.credentialRef,
      SecretString: args.apiKey,
      ClientRequestToken: randomUUID(),
    }))
  }

  async delete(credentialRef: string): Promise<void> {
    // Explicit provider disconnects must immediately make a credential
    // unrecoverable. A missing secret means a previous retry already succeeded.
    try {
      await this.client.send(new DeleteSecretCommand({
        SecretId: credentialRef,
        ForceDeleteWithoutRecovery: true,
      }))
    } catch (error) {
      if (error instanceof Error && error.name === 'ResourceNotFoundException') return
      throw error
    }
  }
}

class UnavailableByokCredentialStore implements ByokCredentialStore {
  private unavailable(): never {
    throw new Error(
      'Postgres BYOK requires providers.secrets.provider=aws-secrets-manager so provider keys remain in the customer AWS account.',
    )
  }

  async write(_args: { apiKey: string; context: ByokCredentialContext }): Promise<string> {
    return this.unavailable()
  }

  async read(_credentialRef: string): Promise<string | null> {
    return this.unavailable()
  }

  async update(_args: { credentialRef: string; apiKey: string }): Promise<void> {
    return this.unavailable()
  }

  async delete(_credentialRef: string): Promise<void> {
    return this.unavailable()
  }
}

export function createByokCredentialStore(
  runtimeConfig: OverlayRuntimeConfig | null,
): ByokCredentialStore {
  const databaseProvider = runtimeConfig?.providers.database?.provider ?? runtimeConfig?.database.provider ?? 'convex'
  const secretProvider = runtimeConfig?.providers.secrets?.provider ?? 'env'
  if (secretProvider === 'aws-secrets-manager') return new AwsSecretsManagerByokCredentialStore()
  if (databaseProvider === 'postgres') {
    // BYOK may be unused. Preserve an otherwise valid on-prem boot and fail
    // closed only if a caller attempts to store or read a provider key.
    return new UnavailableByokCredentialStore()
  }
  return new WorkOSByokCredentialStore()
}

function normalizeSecretPrefix(value: string | undefined): string {
  const normalized = (value ?? 'overlay/byok').trim().replace(/^\/+|\/+$/g, '')
  if (!normalized || !/^[A-Za-z0-9/_+=.@-]+$/.test(normalized)) {
    throw new Error('OVERLAY_AWS_SECRETS_PREFIX must be a valid AWS Secrets Manager path prefix')
  }
  return normalized
}
