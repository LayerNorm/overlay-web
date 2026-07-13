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
