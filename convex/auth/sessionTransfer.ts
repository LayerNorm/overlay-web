import { v } from 'convex/values'
import { mutation } from '../_generated/server'
import { constantTimeEqualStrings, requireServerSecret } from '../lib/auth'

const textEncoder = new TextEncoder()

async function hashTransferToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(token.trim()))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hashCodeVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(verifier.trim()))
  return toBase64Url(new Uint8Array(digest))
}

export const storeToken = mutation({
  args: {
    serverSecret: v.string(),
    token: v.string(),
    codeChallenge: v.string(),
    data: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { serverSecret, token, codeChallenge, data, expiresAt }) => {
    requireServerSecret(serverSecret)
    const tokenHash = await hashTransferToken(token)
    await ctx.db.insert('sessionTransferTokens', {
      tokenHash,
      codeChallenge: codeChallenge.trim(),
      data,
      expiresAt,
    })
  },
})

export const consumeToken = mutation({
  args: {
    token: v.string(),
    codeVerifier: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (ctx, { token, codeVerifier, serverSecret }) => {
    requireServerSecret(serverSecret)
    const tokenHash = await hashTransferToken(token)
    const entry = await ctx.db
      .query('sessionTransferTokens')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .unique()

    if (!entry) return null

    if (entry.expiresAt < Date.now()) {
      await ctx.db.delete(entry._id)
      return null
    }

    const storedCodeChallenge = entry.codeChallenge?.trim()
    if (!storedCodeChallenge) {
      await ctx.db.delete(entry._id)
      return null
    }
    const trimmedVerifier = codeVerifier?.trim()
    if (!trimmedVerifier) {
      return null
    }

    const hashedVerifier = await hashCodeVerifier(trimmedVerifier)
    if (!constantTimeEqualStrings(storedCodeChallenge, hashedVerifier)) {
      return null
    }

    await ctx.db.delete(entry._id)

    return entry.data
  },
})

export const cleanExpired = mutation({
  args: { serverSecret: v.string() },
  handler: async (ctx, { serverSecret }) => {
    requireServerSecret(serverSecret)
    const now = Date.now()
    const expired = await ctx.db
      .query('sessionTransferTokens')
      .collect()
    await Promise.all(expired
      .filter((entry) => entry.expiresAt < now)
      .map((entry) => ctx.db.delete(entry._id)))
  },
})
