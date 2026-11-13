import 'server-only'

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Seals members' Slack and Teams tokens before they are stored in Convex.
 * The key is derived from SLACK_ENCRYPTION_KEY (already required for the
 * Slack app's bot tokens) with a sync-specific label, so no new secret is
 * needed and the two uses never share a raw key. AES-256-GCM, versioned.
 */
const VERSION = 'v1'

function key(): Buffer {
  const secret = process.env.SLACK_ENCRYPTION_KEY?.trim()
  if (!secret) throw new Error('SLACK_ENCRYPTION_KEY is required to store sync account tokens')
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from('overlay-sync-member-token:v1'), 32))
}

export function sealSyncToken(token: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

export function openSyncToken(sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || !body) throw new Error('Unrecognized sealed sync token')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}
