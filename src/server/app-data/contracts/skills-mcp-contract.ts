import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import type { McpServerRepository, SkillRepository } from '@/server/extensions'
import { resolveMcpToolPolicy } from '@/server/extensions'
import type { ProjectRepository } from '@/server/projects/ProjectRepository'

export type SkillsMcpContractBackend = {
  cleanupUser?(userId: string): Promise<void>
  mcpServers: McpServerRepository
  prepareUser?(userId: string): Promise<void>
  projects: ProjectRepository
  provider: 'convex' | 'postgres'
  skills: SkillRepository
}

export async function runSkillsMcpContract(
  t: TestContext,
  backend: SkillsMcpContractBackend,
): Promise<void> {
  const suffix = randomUUID()
  const userId = `p7i_${backend.provider}_${suffix}`
  const foreignUserId = `p7i_foreign_${backend.provider}_${suffix}`
  await backend.prepareUser?.(userId)
  await backend.prepareUser?.(foreignUserId)
  let projectId: string | undefined

  try {
    const project = await backend.projects.createProject({
      clientId: `p7i-project-${suffix}`,
      name: 'P7i contract project',
      userId,
    })
    projectId = project._id

    await t.test(`${backend.provider} skill CRUD, scope, version, and ownership`, async () => {
      const globalId = await backend.skills.create({
        description: 'Global contract skill',
        instructions: 'Return concise answers.',
        name: 'Global skill',
        userId,
      })
      const projectId = await backend.skills.create({
        description: 'Project contract skill',
        instructions: 'Use project terminology.',
        name: 'Project skill',
        projectId: project._id,
        userId,
      })
      assert.deepEqual((await backend.skills.list({ userId })).map((row) => row._id), [globalId])
      assert.deepEqual(
        (await backend.skills.list({ projectId: project._id, userId })).map((row) => row._id),
        [projectId],
      )
      assert.equal(await backend.skills.get({ skillId: globalId, userId: foreignUserId }), null)
      const before = await backend.skills.get({ skillId: globalId, userId })
      await backend.skills.update({
        instructions: 'Return concise, cited answers.',
        skillId: globalId,
        userId,
      })
      const after = await backend.skills.get({ skillId: globalId, userId })
      assert.equal(after?.version, (before?.version ?? 0) + 1)
      await assert.rejects(
        backend.skills.update({ enabled: false, skillId: globalId, userId: foreignUserId }),
      )
      await backend.skills.remove({ skillId: globalId, userId })
      assert.equal(await backend.skills.get({ skillId: globalId, userId }), null)
    })

    await t.test(`${backend.provider} MCP scope, redaction, policy, catalog, audit, and ownership`, async () => {
      const serverId = await backend.mcpServers.create({
        defaultToolPolicy: 'approval_required',
        name: 'Contract MCP',
        projectId: project._id,
        toolPolicies: { dangerous_delete: 'deny', read_document: 'allow' },
        transport: 'streamable-http',
        url: 'https://mcp.example.test/api',
        userId,
      })
      assert.equal((await backend.mcpServers.list({ userId })).length, 0)
      const summaries = await backend.mcpServers.list({ projectId: project._id, userId })
      assert.equal(summaries.length, 1)
      assert.equal('authConfig' in summaries[0]!, false)
      assert.equal(summaries[0]?.defaultToolPolicy, 'approval_required')
      assert.equal(await backend.mcpServers.get({ mcpServerId: serverId, userId: foreignUserId }), null)

      await backend.mcpServers.updateToolCatalog({
        mcpServerId: serverId,
        tools: [
          { name: 'read_document', description: 'Read one document' },
          { name: 'dangerous_delete', description: 'Delete a document' },
        ],
        userId,
      })
      const server = await backend.mcpServers.get({ mcpServerId: serverId, userId })
      assert.equal(server?.toolCatalog.length, 2)
      assert.equal(resolveMcpToolPolicy(server!, 'read_document'), 'allow')
      assert.equal(resolveMcpToolPolicy(server!, 'dangerous_delete'), 'deny')
      assert.equal(resolveMcpToolPolicy(server!, 'unknown_tool'), 'approval_required')

      await backend.mcpServers.recordExecution({
        argumentsHash: 'sha256-contract',
        mcpServerId: serverId,
        policyDecision: 'allow',
        projectId: project._id,
        status: 'succeeded',
        toolName: 'read_document',
        userId,
      })
      assert.equal((await backend.mcpServers.listExecutions({ mcpServerId: serverId, userId })).length, 1)
      assert.equal((await backend.mcpServers.listExecutions({ mcpServerId: serverId, userId: foreignUserId })).length, 0)
      await assert.rejects(backend.mcpServers.remove({ mcpServerId: serverId, userId: foreignUserId }))
      await backend.mcpServers.remove({ mcpServerId: serverId, userId })
      assert.equal(await backend.mcpServers.get({ mcpServerId: serverId, userId }), null)
    })

    await t.test(`${backend.provider} MCP OAuth state stays sealed, single-use, and race-safe`, async () => {
      const serverId = await backend.mcpServers.create({
        authType: 'oauth',
        name: 'Contract OAuth MCP',
        transport: 'streamable-http',
        url: 'https://oauth-mcp.example.test/api',
        userId,
      })

      await backend.mcpServers.updateOAuthState({
        client: { clientId: 'client-abc', clientSecret: 'super-secret', registered: true },
        issuer: 'https://auth.example.test',
        mcpServerId: serverId,
        scope: 'tools:read',
        status: 'pending',
        userId,
      })
      await backend.mcpServers.updateOAuthState({
        mcpServerId: serverId,
        status: 'connected',
        tokens: { accessToken: 'access-1', expiresAt: 4_102_444_800_000, refreshToken: 'refresh-1' },
        userId,
      })

      const connected = await backend.mcpServers.get({ mcpServerId: serverId, userId })
      assert.equal(connected?.oauthTokens?.accessToken, 'access-1')
      assert.equal(connected?.oauthClient?.clientSecret, 'super-secret')
      assert.equal(connected?.oauthStatus, 'connected')
      assert.equal(connected?.oauthClientId, 'client-abc')

      // Secrets must never ride along on the list projection, only the non-secret status fields.
      const [summary] = await backend.mcpServers.list({ userId })
      assert.equal('oauthTokens' in summary!, false)
      assert.equal('oauthClient' in summary!, false)
      assert.equal(summary?.oauthStatus, 'connected')
      assert.equal(summary?.hasAuth, true)

      // Compare-and-set: a stale version loses, and the winner's tokens survive.
      const version = connected?.oauthTokenVersion ?? 0
      assert.equal(
        await backend.mcpServers.updateOAuthState({
          expectedTokenVersion: version,
          mcpServerId: serverId,
          tokens: { accessToken: 'access-2', refreshToken: 'refresh-2' },
          userId,
        }),
        true,
      )
      assert.equal(
        await backend.mcpServers.updateOAuthState({
          expectedTokenVersion: version,
          mcpServerId: serverId,
          tokens: { accessToken: 'access-loser' },
          userId,
        }),
        false,
      )
      assert.equal(
        (await backend.mcpServers.get({ mcpServerId: serverId, userId }))?.oauthTokens?.accessToken,
        'access-2',
      )

      const sessionId = `contract-oauth-session-${backend.provider}`
      await backend.mcpServers.createOAuthSession({
        codeVerifier: 'verifier-0123456789012345678901234567890123456789',
        expiresAt: Date.now() + 600_000,
        id: sessionId,
        mcpServerId: serverId,
        surface: 'desktop',
        userId,
      })
      const consumed = await backend.mcpServers.consumeOAuthSession({ sessionId })
      assert.equal(consumed?.codeVerifier, 'verifier-0123456789012345678901234567890123456789')
      assert.equal(consumed?.userId, userId)
      assert.equal(consumed?.surface, 'desktop')
      // Replaying the same `state` must find nothing.
      assert.equal(await backend.mcpServers.consumeOAuthSession({ sessionId }), null)

      const expiredId = `contract-oauth-expired-${backend.provider}`
      await backend.mcpServers.createOAuthSession({
        codeVerifier: 'verifier-9876543210987654321098765432109876543210',
        expiresAt: Date.now() - 1_000,
        id: expiredId,
        mcpServerId: serverId,
        surface: 'web',
        userId,
      })
      assert.equal(await backend.mcpServers.consumeOAuthSession({ sessionId: expiredId }), null)

      await backend.mcpServers.updateOAuthState({
        client: null,
        mcpServerId: serverId,
        status: 'needs_reauth',
        tokens: null,
        userId,
      })
      const cleared = await backend.mcpServers.get({ mcpServerId: serverId, userId })
      assert.equal(cleared?.oauthTokens, undefined)
      assert.equal(cleared?.oauthClient, undefined)
      assert.equal(cleared?.oauthStatus, 'needs_reauth')

      await backend.mcpServers.remove({ mcpServerId: serverId, userId })
    })

    await t.test(`${backend.provider} project deletion removes scoped skills and MCP records`, async () => {
      const skillId = await backend.skills.create({
        description: 'Project deletion proof',
        instructions: 'Delete with project.',
        name: 'Delete with project',
        projectId: project._id,
        userId,
      })
      const serverId = await backend.mcpServers.create({
        name: 'Delete with project',
        projectId: project._id,
        transport: 'streamable-http',
        url: 'https://mcp.example.test/delete-proof',
        userId,
      })
      const result = await backend.projects.deleteProjectTree({ projectId: project._id, userId })
      assert.ok(result)
      assert.equal(await backend.skills.get({ skillId, userId }), null)
      assert.equal(await backend.mcpServers.get({ mcpServerId: serverId, userId }), null)
      projectId = undefined
    })
  } finally {
    if (projectId) {
      await backend.projects.deleteProjectTree({ projectId, userId }).catch((_error) => undefined)
    }
    await backend.cleanupUser?.(userId)
    await backend.cleanupUser?.(foreignUserId)
  }
}
