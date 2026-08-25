import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { AGENT_ENVIRONMENT_CREDENTIAL_METHODS } from '@overlay/workspace-contracts'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-environment-control-plane-test-secret'
const now = 10_000
const workspaceId = 'workspace-owner'
const environmentId = 'environment-owner'
const codeHash = 'a'.repeat(64)
const challengeHash = 'b'.repeat(64)

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

describe('Convex agent-environment control plane', () => {
  test('rejects invalid service authority and expired enrollment codes', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.mutation(controlMutation('createEnrollmentSessionByServer'), {
      ...enrollmentInput(), serverSecret: 'wrong-secret',
    })).rejects.toThrow(/Unauthorized/)
    await convex.mutation(controlMutation('createEnrollmentSessionByServer'), {
      ...enrollmentInput({ expiresAt: now + 1 }), serverSecret: secret,
    })
    expect(await convex.mutation(controlMutation('redeemEnrollmentSessionByServer'), {
      serverSecret: secret, codeHash, now: now + 2,
      environment: environmentInput(), proofChallenge: proofChallengeInput(),
    })).toBeNull()
  })

  test('enforces the workspace environment limit again when a code is redeemed', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(controlMutation('createEnrollmentSessionByServer'), {
      ...enrollmentInput({ maxEnvironments: 0 }), serverSecret: secret,
    })
    await expect(convex.mutation(controlMutation('redeemEnrollmentSessionByServer'), {
      serverSecret: secret, codeHash, now,
      environment: environmentInput(), proofChallenge: proofChallengeInput(),
    })).rejects.toThrow(/CONNECTED_AGENT_POLICY_LIMIT:environments/)
  })

  test('enrolls once, enforces tenant/root scope, and consumes proof and request nonces once', async () => {
    const convex = convexTest(schema, modules)
    const call = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(controlMutation(operation), { ...args, serverSecret: secret }) as Promise<T>
    const read = <T>(operation: string, args: Record<string, unknown>) =>
      convex.query(controlQuery(operation), { ...args, serverSecret: secret }) as Promise<T>

    await call('createEnrollmentSessionByServer', enrollmentInput())
    const redeemed = await call<{ environment: { status: string } }>('redeemEnrollmentSessionByServer', {
      codeHash, now, environment: environmentInput(), proofChallenge: proofChallengeInput(),
    })
    expect(redeemed.environment.status).toBe('pending')
    expect(await call('redeemEnrollmentSessionByServer', {
      codeHash, now, environment: environmentInput({ id: 'replay-environment' }),
      proofChallenge: proofChallengeInput({ id: 'replay-challenge', environmentId: 'replay-environment' }),
    })).toBeNull()

    expect(await call('approveEnvironmentByServer', {
      workspaceId: 'workspace-foreign', environmentId, approvedByUserId: 'foreign-user',
      filesystemGrant: { mode: 'selected_roots', roots: ['/repo'] }, now: now + 1,
    })).toBeNull()
    await expect(call('approveEnvironmentByServer', {
      workspaceId, environmentId, approvedByUserId: 'owner-user',
      filesystemGrant: { mode: 'selected_roots', roots: ['relative/path'] }, now: now + 1,
    })).rejects.toThrow(/AGENT_FILESYSTEM_ROOTS_INVALID/)
    const approved = await call<{ filesystemGrant: unknown; approvedByUserId: string }>('approveEnvironmentByServer', {
      workspaceId, environmentId, approvedByUserId: 'owner-user',
      filesystemGrant: { mode: 'selected_roots', roots: ['/repo', '/data'] }, now: now + 1,
    })
    expect(approved.approvedByUserId).toBe('owner-user')

    const enrollmentView = await read<{ verificationPhrase: string }>('getEnvironmentEnrollmentByServer', { workspaceId, environmentId })
    expect(enrollmentView.verificationPhrase).toBe('amber-canyon')
    expect(await read<unknown[]>('listEnvironmentsByServer', { workspaceId: 'workspace-foreign' })).toEqual([])

    const credential = credentialInput()
    expect(await call('issueEnvironmentCredentialByServer', {
      workspaceId, environmentId, proofChallengeId: 'challenge-owner',
      proofChallengeHash: 'wrong'.repeat(16), credential, now: now + 2,
    })).toBeNull()
    const issued = await call<{ id: string }>('issueEnvironmentCredentialByServer', {
      workspaceId, environmentId, proofChallengeId: 'challenge-owner',
      proofChallengeHash: challengeHash, credential, now: now + 2,
    })
    expect(issued.id).toBe('credential-owner')
    expect(await call('issueEnvironmentCredentialByServer', {
      workspaceId, environmentId, proofChallengeId: 'challenge-owner', proofChallengeHash: challengeHash,
      credential: credentialInput({ id: 'credential-replay', tokenHash: 'd'.repeat(64), tokenNonce: 'token-nonce-replay' }), now: now + 2,
    })).toBeNull()

    expect(await call<boolean>('consumeEnvironmentProofNonceByServer', {
      credentialId: credential.id, nonceHash: 'e'.repeat(64), expiresAt: now + 60_000, now: now + 3,
    })).toBe(true)
    expect(await call<boolean>('consumeEnvironmentProofNonceByServer', {
      credentialId: credential.id, nonceHash: 'e'.repeat(64), expiresAt: now + 60_000, now: now + 4,
    })).toBe(false)

    const rotatedCredential = credentialInput({
      id: 'credential-rotated', tokenHash: 'f'.repeat(64), tokenNonce: 'token-nonce-rotated',
      createdAt: now + 5, expiresAt: now + 14 * 60_000,
    })
    const rotated = await call<{ id: string }>('rotateEnvironmentCredentialByServer', {
      currentCredentialId: credential.id, credential: rotatedCredential, now: now + 5,
    })
    expect(rotated.id).toBe('credential-rotated')
    const oldCredential = await read<{ revokedAt?: number }>('findEnvironmentCredentialByServer', { tokenHash: credential.tokenHash })
    expect(oldCredential.revokedAt).toBe(now + 5)
    expect(await call<boolean>('consumeEnvironmentProofNonceByServer', {
      credentialId: credential.id, nonceHash: '1'.repeat(64), expiresAt: now + 60_000, now: now + 6,
    })).toBe(false)
  })

  test('rejects oversized protocol input and revocation stops commands, events, credentials and leases', async () => {
    const convex = convexTest(schema, modules)
    const callControl = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(controlMutation(operation), { ...args, serverSecret: secret }) as Promise<T>
    const callAgent = <T>(operation: string, args: Record<string, unknown>) =>
      convex.mutation(agentMutation(operation), { ...args, serverSecret: secret }) as Promise<T>
    const readControl = <T>(operation: string, args: Record<string, unknown>) =>
      convex.query(controlQuery(operation), { ...args, serverSecret: secret }) as Promise<T>

    await callControl('createEnrollmentSessionByServer', enrollmentInput())
    await callControl('redeemEnrollmentSessionByServer', { codeHash, now, environment: environmentInput(), proofChallenge: proofChallengeInput() })
    await callControl('approveEnvironmentByServer', { workspaceId, environmentId, approvedByUserId: 'owner-user', filesystemGrant: { mode: 'all_user_files' }, now: now + 1 })
    await callControl('issueEnvironmentCredentialByServer', { workspaceId, environmentId, proofChallengeId: 'challenge-owner', proofChallengeHash: challengeHash, credential: credentialInput(), now: now + 2 })

    await callAgent('createBindingByServer', { id: 'binding-owner', workspaceId, agentId: 'agent-owner', environmentId, protocolAdapter: 'acp', adapterConfig: {}, enabled: true, now })
    await callAgent('createRemoteSessionByServer', { id: 'session-owner', workspaceId, environmentId, bindingId: 'binding-owner', runId: 'run-owner', status: 'running', commandCursor: 0, eventCursor: 0, capabilitySnapshot: {}, now })
    await expect(callAgent('enqueueCommandByServer', { id: 'too-large', workspaceId, environmentId, runId: 'run-owner', type: 'start', payload: { value: 'x'.repeat(129 * 1024) }, now })).rejects.toThrow(/AGENT_COMMAND_TOO_LARGE/)
    const command = await callAgent<{ id: string }>('enqueueCommandByServer', { id: 'command-owner', workspaceId, environmentId, runId: 'run-owner', type: 'start', payload: {}, now })
    await callAgent('claimCommandsByServer', { workspaceId, environmentId, now, leaseMs: 5_000, limit: 10 })
    expect(await callAgent<boolean>('acknowledgeCommandByServer', { workspaceId, environmentId, commandId: command.id, accepted: false, now: now + 1 })).toBe(true)
    expect(await callAgent('claimCommandsByServer', { workspaceId, environmentId, now: now + 6_000, leaseMs: 5_000, limit: 10 })).toEqual([])

    await expect(callAgent('applyRemoteEventsByServer', {
      workspaceId, environmentId, sessionId: 'session-owner', now,
      events: [eventInput({ payload: { text: 'x'.repeat(513 * 1024) } })],
    })).rejects.toThrow(/AGENT_EVENT_BATCH_TOO_LARGE/)
    await callAgent('createSandboxLeaseByServer', { id: 'lease-owner', workspaceId, environmentId, provider: 'vercel', status: 'running', reservedUntil: now + 1_000_000, usage: {}, cleanupAttempts: 0, now })
    await callAgent('enqueueCommandByServer', { id: 'command-pending', workspaceId, environmentId, runId: 'run-owner', type: 'prompt', payload: {}, now })
    expect(await callControl<boolean>('revokeEnvironmentAccessByServer', { workspaceId, environmentId, now: now + 10 })).toBe(true)
    expect(await callAgent('claimCommandsByServer', { workspaceId, environmentId, now: now + 11, leaseMs: 5_000, limit: 10 })).toEqual([])
    await expect(callAgent('applyRemoteEventsByServer', { workspaceId, environmentId, sessionId: 'session-owner', now: now + 11, events: [eventInput()] })).rejects.toThrow(/AGENT_ENVIRONMENT_UNAVAILABLE/)
    const storedCredential = await readControl<{ revokedAt?: number }>('findEnvironmentCredentialByServer', { tokenHash: 'c'.repeat(64) })
    expect(storedCredential.revokedAt).toBe(now + 10)
    const lease = await convex.run(async ctx => ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', q => q.eq('leaseId', 'lease-owner')).unique())
    expect(lease?.status).toBe('stopping')
    expect(lease?.reservedUntil).toBe(now + 10)
  })
})

function enrollmentInput(overrides: Record<string, unknown> = {}) {
  return { id: 'enrollment-owner', workspaceId, createdByUserId: 'owner-user', codeHash,
    verificationPhrase: 'amber-canyon', status: 'created', expiresAt: now + 10 * 60_000,
    createdAt: now, updatedAt: now, ...overrides }
}
function environmentInput(overrides: Record<string, unknown> = {}) {
  return { id: environmentId, workspaceId, kind: 'local', name: 'Owner Mac', status: 'pending',
    publicKey: `-----BEGIN PUBLIC KEY-----${'x'.repeat(64)}-----END PUBLIC KEY-----`, hostVersion: '1.0.0',
    platform: 'darwin-arm64', capabilities: { protocolVersion: 1 }, now, ...overrides }
}
function proofChallengeInput(overrides: Record<string, unknown> = {}) {
  return { id: 'challenge-owner', workspaceId, environmentId, challengeHash,
    expiresAt: now + 15 * 60_000, createdAt: now, ...overrides }
}
function credentialInput(overrides: Record<string, unknown> = {}) {
  return { id: 'credential-owner', workspaceId, environmentId, tokenHash: 'c'.repeat(64),
    audience: 'overlay-agent-control-plane', methods: [...AGENT_ENVIRONMENT_CREDENTIAL_METHODS],
    tokenNonce: 'token-nonce-owner', expiresAt: now + 14 * 60_000, createdAt: now + 2, ...overrides }
}
function eventInput(overrides: Record<string, unknown> = {}) {
  return { protocolVersion: 1, eventId: 'event-owner', environmentId, runId: 'run-owner', sourceSequence: 1,
    type: 'text_checkpoint', occurredAt: now, payload: { text: 'ready' }, ...overrides }
}
function controlMutation(operation: string) { return makeFunctionReference<'mutation'>(`agents/environmentControlPlane:${operation}`) }
function controlQuery(operation: string) { return makeFunctionReference<'query'>(`agents/environmentControlPlane:${operation}`) }
function agentMutation(operation: string) { return makeFunctionReference<'mutation'>(`agents/connectedAgents:${operation}`) }
