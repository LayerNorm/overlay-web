import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const MAX_ENROLLMENT_LIFETIME_MS = 15 * 60 * 1000
const MAX_CREDENTIAL_LIFETIME_MS = 15 * 60 * 1000
const MAX_PROOF_NONCE_LIFETIME_MS = 5 * 60 * 1000
const MAX_CAPABILITY_BYTES = 128 * 1024
const anyObject = v.any()
const filesystemGrant = v.union(
  v.object({ mode: v.literal('selected_roots'), roots: v.array(v.string()) }),
  v.object({ mode: v.literal('all_user_files') }),
)
const environmentInput = v.object({
  id: v.string(), workspaceId: v.string(), kind: v.string(), name: v.string(), status: v.string(),
  publicKey: v.optional(v.string()), hostVersion: v.optional(v.string()), platform: v.optional(v.string()),
  capabilities: anyObject, filesystemGrant: v.optional(filesystemGrant), approvedAt: v.optional(v.number()),
  approvedByUserId: v.optional(v.string()), lastSeenAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()), now: v.number(),
})
const proofChallengeInput = v.object({
  id: v.string(), workspaceId: v.string(), environmentId: v.string(), challengeHash: v.string(),
  expiresAt: v.number(), consumedAt: v.optional(v.number()), createdAt: v.number(),
})
const credentialInput = v.object({
  id: v.string(), workspaceId: v.string(), environmentId: v.string(), tokenHash: v.string(),
  audience: v.string(), methods: v.array(v.string()), tokenNonce: v.string(), expiresAt: v.number(),
  revokedAt: v.optional(v.number()), createdAt: v.number(),
})

function clean<T extends Record<string, unknown>>(row: T) {
  const copy = { ...row }
  delete copy._id
  delete copy._creationTime
  return copy
}
function toEnvironment<T extends { environmentId: string }>(row: T) { return { ...clean(row), id: row.environmentId } }
function toEnrollment<T extends { enrollmentSessionId: string }>(row: T) { return { ...clean(row), id: row.enrollmentSessionId } }
function toChallenge<T extends { challengeId: string }>(row: T) { return { ...clean(row), id: row.challengeId } }
function toCredential<T extends { credentialId: string }>(row: T) { return { ...clean(row), id: row.credentialId } }

function assertHash(value: string, code: string) {
  if (value.length < 8 || value.length > 256 || /\s/.test(value)) throw new Error(code)
}
function assertExpiry(expiresAt: number, now: number, maxLifetimeMs: number, code: string) {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + maxLifetimeMs) throw new Error(code)
}
function assertCapabilities(capabilities: unknown) {
  if (new TextEncoder().encode(JSON.stringify(capabilities)).byteLength > MAX_CAPABILITY_BYTES) throw new Error('AGENT_CAPABILITIES_TOO_LARGE')
}
function assertFilesystemGrant(grant: { mode: 'selected_roots'; roots: string[] } | { mode: 'all_user_files' }) {
  if (grant.mode === 'all_user_files') return
  if (grant.roots.length === 0 || grant.roots.length > 100) throw new Error('AGENT_FILESYSTEM_ROOTS_INVALID')
  const seen = new Set<string>()
  for (const root of grant.roots) {
    const absolute = root.startsWith('/') || /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\')
    if (!absolute || root.length > 1_024 || root.includes('\0') || root.includes('\n') || seen.has(root)) throw new Error('AGENT_FILESYSTEM_ROOTS_INVALID')
    seen.add(root)
  }
}
function assertCredentialClaims(credential: { audience: string; methods: string[]; tokenHash: string; tokenNonce: string; expiresAt: number; createdAt: number }, now: number) {
  assertHash(credential.tokenHash, 'AGENT_CREDENTIAL_TOKEN_HASH_INVALID')
  if (credential.audience !== 'overlay-agent-control-plane' || !credential.tokenNonce || credential.tokenNonce.length > 256) throw new Error('AGENT_CREDENTIAL_CLAIMS_INVALID')
  const allowed = new Set(['agent:heartbeat', 'agent:capabilities:update', 'agent:commands:poll', 'agent:commands:ack', 'agent:events:write', 'agent:credentials:refresh'])
  if (credential.methods.length === 0 || credential.methods.length > 32 || new Set(credential.methods).size !== credential.methods.length || credential.methods.some(method => !allowed.has(method))) throw new Error('AGENT_CREDENTIAL_METHODS_INVALID')
  assertExpiry(credential.expiresAt, now, MAX_CREDENTIAL_LIFETIME_MS, 'AGENT_CREDENTIAL_EXPIRY_INVALID')
  if (credential.createdAt !== now) throw new Error('AGENT_CREDENTIAL_ISSUED_AT_INVALID')
}
async function requireEnvironment(ctx: MutationCtx, workspaceId: string, environmentId: string) {
  const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', environmentId)).unique()
  if (!environment || environment.workspaceId !== workspaceId) throw new Error('AGENT_ENVIRONMENT_NOT_FOUND')
  return environment
}
async function requireActiveEnvironment(ctx: MutationCtx, workspaceId: string, environmentId: string) {
  const environment = await requireEnvironment(ctx, workspaceId, environmentId)
  if (!environment.approvedAt || environment.status === 'pending' || environment.status === 'revoked') throw new Error('AGENT_ENVIRONMENT_UNAVAILABLE')
  return environment
}

export const createEnrollmentSessionByServer = mutation({
  args: { serverSecret: v.string(), id: v.string(), workspaceId: v.string(), createdByUserId: v.string(), codeHash: v.string(), verificationPhrase: v.string(), status: v.string(), expiresAt: v.number(), environmentId: v.optional(v.string()), redeemedAt: v.optional(v.number()), approvedAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    assertHash(args.codeHash, 'AGENT_ENROLLMENT_CODE_HASH_INVALID')
    if (!Number.isSafeInteger(args.expiresAt) || args.expiresAt > args.createdAt + MAX_ENROLLMENT_LIFETIME_MS) throw new Error('AGENT_ENROLLMENT_EXPIRY_INVALID')
    if (args.status !== 'created' || args.createdAt !== args.updatedAt || args.environmentId || args.redeemedAt || args.approvedAt) throw new Error('AGENT_ENROLLMENT_STATE_INVALID')
    if (args.verificationPhrase.trim().length < 3 || args.verificationPhrase.length > 100) throw new Error('AGENT_VERIFICATION_PHRASE_INVALID')
    const [idCollision, hashCollision] = await Promise.all([
      ctx.db.query('agentEnrollmentSessions').withIndex('by_enrollmentSessionId', q => q.eq('enrollmentSessionId', args.id)).unique(),
      ctx.db.query('agentEnrollmentSessions').withIndex('by_codeHash', q => q.eq('codeHash', args.codeHash)).unique(),
    ])
    if (idCollision || hashCollision) throw new Error('AGENT_ENROLLMENT_EXISTS')
    const { serverSecret, id, ...input } = args
    void serverSecret
    const row = { ...input, enrollmentSessionId: id, status: 'created' as const }
    await ctx.db.insert('agentEnrollmentSessions', row)
    return { ...row, id }
  },
})

export const redeemEnrollmentSessionByServer = mutation({
  args: { serverSecret: v.string(), codeHash: v.string(), now: v.number(), environment: environmentInput, proofChallenge: proofChallengeInput },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    assertHash(args.codeHash, 'AGENT_ENROLLMENT_CODE_HASH_INVALID')
    assertHash(args.proofChallenge.challengeHash, 'AGENT_PROOF_CHALLENGE_HASH_INVALID')
    assertExpiry(args.proofChallenge.expiresAt, args.now, MAX_CREDENTIAL_LIFETIME_MS, 'AGENT_PROOF_CHALLENGE_EXPIRY_INVALID')
    assertCapabilities(args.environment.capabilities)
    if (args.environment.publicKey && (args.environment.publicKey.length < 8 || args.environment.publicKey.length > 8_192)) throw new Error('AGENT_PUBLIC_KEY_INVALID')
    const enrollment = await ctx.db.query('agentEnrollmentSessions').withIndex('by_codeHash', q => q.eq('codeHash', args.codeHash)).unique()
    if (!enrollment || enrollment.expiresAt <= args.now || enrollment.status !== 'created') return null
    if (args.environment.status !== 'pending' || args.environment.now !== args.now || args.proofChallenge.environmentId !== args.environment.id || args.proofChallenge.createdAt !== args.now || args.proofChallenge.consumedAt) throw new Error('AGENT_ENROLLMENT_SCOPE_INVALID')
    const [environmentCollision, challengeIdCollision, challengeHashCollision] = await Promise.all([
      ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environment.id)).unique(),
      ctx.db.query('agentEnvironmentProofChallenges').withIndex('by_challengeId', q => q.eq('challengeId', args.proofChallenge.id)).unique(),
      ctx.db.query('agentEnvironmentProofChallenges').withIndex('by_challengeHash', q => q.eq('challengeHash', args.proofChallenge.challengeHash)).unique(),
    ])
    if (environmentCollision || challengeIdCollision || challengeHashCollision) throw new Error('AGENT_ENROLLMENT_RESOURCE_EXISTS')
    const { id: environmentId, now: _environmentNow, ...environmentValue } = args.environment
    void _environmentNow
    const environmentRow = { ...environmentValue, workspaceId: enrollment.workspaceId, environmentId, createdAt: args.now, updatedAt: args.now }
    const { id: challengeId, ...challengeValue } = args.proofChallenge
    const challengeRow = { ...challengeValue, workspaceId: enrollment.workspaceId, challengeId }
    await ctx.db.insert('agentEnvironments', environmentRow)
    await ctx.db.insert('agentEnvironmentProofChallenges', challengeRow)
    await ctx.db.patch(enrollment._id, { status: 'redeemed', environmentId, redeemedAt: args.now, updatedAt: args.now })
    return { enrollment: { ...toEnrollment(enrollment), status: 'redeemed', environmentId, redeemedAt: args.now, updatedAt: args.now }, environment: toEnvironment(environmentRow), proofChallenge: toChallenge(challengeRow) }
  },
})

export const listEnvironmentsByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return (await ctx.db.query('agentEnvironments').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).order('desc').take(200)).map(toEnvironment)
  },
})
export const getEnvironmentByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    return row && row.workspaceId === args.workspaceId ? toEnvironment(row) : null
  },
})
export const getEnvironmentEnrollmentByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId) return null
    const enrollment = await ctx.db.query('agentEnrollmentSessions').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    return enrollment ? { environment: toEnvironment(environment), verificationPhrase: enrollment.verificationPhrase, enrollmentExpiresAt: enrollment.expiresAt } : null
  },
})

export const approveEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), approvedByUserId: v.string(), filesystemGrant, now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    assertFilesystemGrant(args.filesystemGrant)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || environment.status !== 'pending') return null
    const enrollment = await ctx.db.query('agentEnrollmentSessions').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!enrollment || enrollment.status !== 'redeemed' || enrollment.expiresAt <= args.now) return null
    const updates = { status: 'offline', filesystemGrant: args.filesystemGrant, approvedByUserId: args.approvedByUserId, approvedAt: args.now, updatedAt: args.now }
    await ctx.db.patch(environment._id, updates)
    await ctx.db.patch(enrollment._id, { status: 'approved', approvedAt: args.now, updatedAt: args.now })
    return { ...toEnvironment(environment), ...updates }
  },
})
export const updateEnvironmentFilesystemGrantByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), filesystemGrant, now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    assertFilesystemGrant(args.filesystemGrant)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId || !environment.approvedAt || environment.status === 'pending' || environment.status === 'revoked') return null
    await ctx.db.patch(environment._id, { filesystemGrant: args.filesystemGrant, updatedAt: args.now })
    return { ...toEnvironment(environment), filesystemGrant: args.filesystemGrant, updatedAt: args.now }
  },
})
export const getEnvironmentProofChallengeByServer = query({
  args: { serverSecret: v.string(), environmentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || !environment.approvedAt || environment.status === 'revoked') return null
    const challenge = await ctx.db.query('agentEnvironmentProofChallenges').withIndex('by_environmentId_expiresAt', q => q.eq('environmentId', args.environmentId).gt('expiresAt', args.now)).order('desc').first()
    if (!challenge || challenge.consumedAt) return null
    return { environment: toEnvironment(environment), proofChallenge: toChallenge(challenge) }
  },
})

export const issueEnvironmentCredentialByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), proofChallengeId: v.string(), proofChallengeHash: v.string(), credential: credentialInput, now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveEnvironment(ctx, args.workspaceId, args.environmentId)
    const challenge = await ctx.db.query('agentEnvironmentProofChallenges').withIndex('by_challengeId', q => q.eq('challengeId', args.proofChallengeId)).unique()
    if (!challenge || challenge.workspaceId !== args.workspaceId || challenge.environmentId !== args.environmentId || challenge.challengeHash !== args.proofChallengeHash || challenge.consumedAt || challenge.expiresAt <= args.now) return null
    assertCredentialClaims(args.credential, args.now)
    if (args.credential.workspaceId !== args.workspaceId || args.credential.environmentId !== args.environmentId || args.credential.revokedAt) throw new Error('AGENT_CREDENTIAL_SCOPE_INVALID')
    const [idCollision, hashCollision, nonceCollision] = await Promise.all([
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_credentialId', q => q.eq('credentialId', args.credential.id)).unique(),
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_tokenHash', q => q.eq('tokenHash', args.credential.tokenHash)).unique(),
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_tokenNonce', q => q.eq('tokenNonce', args.credential.tokenNonce)).unique(),
    ])
    if (idCollision || hashCollision || nonceCollision) throw new Error('AGENT_CREDENTIAL_EXISTS')
    const { id: credentialId, ...credentialValue } = args.credential
    const row = { ...credentialValue, credentialId }
    await ctx.db.insert('agentEnvironmentCredentials', row)
    await ctx.db.patch(challenge._id, { consumedAt: args.now })
    return toCredential(row)
  },
})
export const findEnvironmentCredentialByServer = query({
  args: { serverSecret: v.string(), tokenHash: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('agentEnvironmentCredentials').withIndex('by_tokenHash', q => q.eq('tokenHash', args.tokenHash)).unique()
    return row ? toCredential(row) : null
  },
})
export const consumeEnvironmentProofNonceByServer = mutation({
  args: { serverSecret: v.string(), credentialId: v.string(), nonceHash: v.string(), expiresAt: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    assertHash(args.nonceHash, 'AGENT_PROOF_NONCE_HASH_INVALID')
    assertExpiry(args.expiresAt, args.now, MAX_PROOF_NONCE_LIFETIME_MS, 'AGENT_PROOF_NONCE_EXPIRY_INVALID')
    const credential = await ctx.db.query('agentEnvironmentCredentials').withIndex('by_credentialId', q => q.eq('credentialId', args.credentialId)).unique()
    if (!credential || credential.revokedAt || credential.expiresAt <= args.now) return false
    await requireActiveEnvironment(ctx, credential.workspaceId, credential.environmentId)
    const replay = await ctx.db.query('agentEnvironmentCredentialNonces').withIndex('by_credentialId_nonceHash', q => q.eq('credentialId', args.credentialId).eq('nonceHash', args.nonceHash)).unique()
    if (replay) return false
    await ctx.db.insert('agentEnvironmentCredentialNonces', { nonceId: `${args.credentialId}:${args.nonceHash}`, credentialId: args.credentialId, nonceHash: args.nonceHash, expiresAt: args.expiresAt, createdAt: args.now })
    return true
  },
})
export const rotateEnvironmentCredentialByServer = mutation({
  args: { serverSecret: v.string(), currentCredentialId: v.string(), credential: credentialInput, now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    assertCredentialClaims(args.credential, args.now)
    const current = await ctx.db.query('agentEnvironmentCredentials').withIndex('by_credentialId', q => q.eq('credentialId', args.currentCredentialId)).unique()
    if (!current || current.revokedAt || current.workspaceId !== args.credential.workspaceId || current.environmentId !== args.credential.environmentId || current.audience !== args.credential.audience || current.methods.length !== args.credential.methods.length || current.methods.some(method => !args.credential.methods.includes(method))) return null
    await requireActiveEnvironment(ctx, current.workspaceId, current.environmentId)
    const [idCollision, hashCollision, nonceCollision] = await Promise.all([
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_credentialId', q => q.eq('credentialId', args.credential.id)).unique(),
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_tokenHash', q => q.eq('tokenHash', args.credential.tokenHash)).unique(),
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_tokenNonce', q => q.eq('tokenNonce', args.credential.tokenNonce)).unique(),
    ])
    if (idCollision || hashCollision || nonceCollision) throw new Error('AGENT_CREDENTIAL_EXISTS')
    await ctx.db.patch(current._id, { revokedAt: args.now })
    const { id: credentialId, ...credentialValue } = args.credential
    const row = { ...credentialValue, credentialId }
    await ctx.db.insert('agentEnvironmentCredentials', row)
    return toCredential(row)
  },
})

export const heartbeatEnvironmentByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await requireActiveEnvironment(ctx, args.workspaceId, args.environmentId)
    const updates = { status: 'online', lastSeenAt: args.now, updatedAt: args.now }
    await ctx.db.patch(environment._id, updates)
    return { ...toEnvironment(environment), ...updates }
  },
})
export const updateEnvironmentCapabilitiesByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), capabilities: anyObject, now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    assertCapabilities(args.capabilities)
    const environment = await requireActiveEnvironment(ctx, args.workspaceId, args.environmentId)
    await ctx.db.patch(environment._id, { capabilities: args.capabilities, lastSeenAt: args.now, updatedAt: args.now })
    return { ...toEnvironment(environment), capabilities: args.capabilities, lastSeenAt: args.now, updatedAt: args.now }
  },
})
export const revokeEnvironmentAccessByServer = mutation({
  args: { serverSecret: v.string(), workspaceId: v.string(), environmentId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const environment = await ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique()
    if (!environment || environment.workspaceId !== args.workspaceId) return false
    if (environment.status === 'revoked') return true
    await ctx.db.patch(environment._id, { status: 'revoked', revokedAt: args.now, updatedAt: args.now })
    const [bindings, commands, credentials, leases] = await Promise.all([
      ctx.db.query('agentBindings').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).take(1_000),
      ctx.db.query('agentRunCommands').withIndex('by_environmentId_sequence', q => q.eq('environmentId', args.environmentId)).take(1_000),
      ctx.db.query('agentEnvironmentCredentials').withIndex('by_environmentId_expiresAt', q => q.eq('environmentId', args.environmentId)).take(1_000),
      ctx.db.query('agentSandboxLeases').withIndex('by_workspaceId_environmentId', q => q.eq('workspaceId', args.workspaceId).eq('environmentId', args.environmentId)).take(1_000),
    ])
    for (const binding of bindings) await ctx.db.patch(binding._id, { enabled: false, updatedAt: args.now })
    for (const command of commands) if (command.status === 'pending' || command.status === 'claimed') await ctx.db.patch(command._id, { status: 'cancelled', claimExpiresAt: args.now, updatedAt: args.now })
    for (const credential of credentials) if (!credential.revokedAt) await ctx.db.patch(credential._id, { revokedAt: args.now })
    for (const lease of leases) if (!['released', 'cleanup_failed'].includes(lease.status)) await ctx.db.patch(lease._id, { status: 'stopping', reservedUntil: args.now, cleanupAfter: args.now, updatedAt: args.now })
    return true
  },
})
