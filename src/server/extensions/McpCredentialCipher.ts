import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { McpAuthConfig } from './McpServerRepository'

const PREFIX = 'mcpv1'
const MIN_SECRET_LENGTH = 32
const GCM_AUTH_TAG_LENGTH_BYTES = 16

/** Raised when the deployment cannot store MCP credentials because no encryption key is configured. */
export class McpCredentialConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpCredentialConfigurationError'
  }
}

export class McpCredentialCipher {
  private readonly keys: Buffer[]

  constructor(secrets: readonly string[]) {
    this.keys = secrets
      .map((secret) => secret.trim())
      .filter(Boolean)
      .map((secret) => {
        if (secret.length < MIN_SECRET_LENGTH) {
          throw new Error(`MCP credential encryption keys must be at least ${MIN_SECRET_LENGTH} characters`)
        }
        return createHash('sha256').update(secret).digest()
      })
  }

  static fromEnvironment(): McpCredentialCipher {
    return new McpCredentialCipher([
      process.env.MCP_CREDENTIAL_ENCRYPTION_KEY ?? '',
      process.env.MCP_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS ?? '',
    ])
  }

  get configured(): boolean {
    return this.keys.length > 0
  }

  encrypt(value: McpAuthConfig | undefined): string | undefined {
    if (!hasCredentials(value)) return undefined
    const key = this.keys[0]
    if (!key) {
      throw new McpCredentialConfigurationError(
        'MCP_CREDENTIAL_ENCRYPTION_KEY is required before storing authenticated MCP servers',
      )
    }
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: GCM_AUTH_TAG_LENGTH_BYTES,
    })
    cipher.setAAD(Buffer.from(PREFIX))
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ])
    return [PREFIX, iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
  }

  decrypt(payload: string | undefined): McpAuthConfig | undefined {
    if (!payload) return undefined
    const [prefix, iv, encrypted, authTag] = payload.split('.')
    if (prefix !== PREFIX || !iv || !encrypted || !authTag) {
      throw new Error('Invalid encrypted MCP credential payload')
    }
    const decodedAuthTag = Buffer.from(authTag, 'base64url')
    if (decodedAuthTag.length !== GCM_AUTH_TAG_LENGTH_BYTES) {
      throw new Error('Invalid encrypted MCP credential authentication tag')
    }
    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
          authTagLength: GCM_AUTH_TAG_LENGTH_BYTES,
        })
        decipher.setAAD(Buffer.from(PREFIX))
        decipher.setAuthTag(decodedAuthTag)
        const cleartext = Buffer.concat([
          decipher.update(Buffer.from(encrypted, 'base64url')),
          decipher.final(),
        ]).toString('utf8')
        return JSON.parse(cleartext) as McpAuthConfig
      } catch (_error) {
        // Try the previous key during a bounded rotation window.
      }
    }
    throw new Error('Encrypted MCP credentials could not be authenticated')
  }
}

export function hasCredentials(value: McpAuthConfig | undefined): boolean {
  return Boolean(value?.bearerToken || (value?.headerName && value.headerValue))
}
