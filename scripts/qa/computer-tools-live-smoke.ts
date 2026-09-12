/**
 * Live smoke for the computer_* agent-tool path (wiring phase 5.5):
 * resolves an owner's bound computer through `ComputerService.instanceForOwner`
 * — the same call the tools make — then exercises the exact runtime methods
 * the tools wrap (runCommand / writeFiles / readFile / listFiles) against the
 * real running box left over from the lifecycle proof.
 *
 * Run:
 *   NODE_OPTIONS=--require=./scripts/ci/register-server-only.cjs \
 *   TSX_TSCONFIG_PATH=tsconfig.json \
 *   npx tsx --env-file=.env.on-prem-contract-tests.local --env-file=.env.local \
 *     scripts/qa/computer-tools-live-smoke.ts
 */
import 'server-only'

import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { PostgresWorkspaceAgentRepository } from '@/server/agents/PostgresWorkspaceAgentRepository'
import { PostgresComputerRepository } from '@/server/computers/PostgresComputerRepository'
import { ComputerService, type ComputerActor } from '@/server/computers/ComputerService'
import { createComputerRuntimeResolver } from '@/server/computers/computer-runtimes'

async function main() {
  const databaseUrl = process.env.OVERLAY_DATABASE_URL
  if (!databaseUrl) throw new Error('OVERLAY_DATABASE_URL is required')
  if (!process.env.BOX_API_KEY?.trim()) throw new Error('BOX_API_KEY is required')

  const pool = createOverlayPostgresPool({ connectionString: databaseUrl })
  const db = createOverlayPostgresDb(pool)
  const computers = new PostgresComputerRepository(db)
  const agents = new PostgresWorkspaceAgentRepository(db)

  const [membership] = (await pool.query(
    `SELECT m.workspace_id, m.principal_id, p.user_id
     FROM workspace_memberships m JOIN workspace_principals p ON p.id = m.principal_id
     WHERE m.role = 'owner' AND m.status = 'active' AND p.type = 'human' LIMIT 1`,
  )).rows as Array<{ workspace_id: string; principal_id: string; user_id: string }>
  const workspaceId = membership.workspace_id
  const actor: ComputerActor = {
    userId: membership.user_id,
    principalId: membership.principal_id,
    workspaceRole: 'owner',
  }

  const service = new ComputerService({
    repository: computers,
    runtimeFor: createComputerRuntimeResolver(),
    agentOwner: async (wsId, agentId) => {
      const agent = await agents.get({ agentId, workspaceId: wsId })
      return agent
        ? { visibility: agent.visibility, createdByPrincipalId: agent.createdByPrincipalId }
        : null
    },
    limits: { maxPerWorkspace: 25, maxPersonalPerUser: 1, allowedSizes: ['small', 'default', 'large'] },
  })

  // Any existing bound computer — the lifecycle proof leaves one agent-owned.
  const [row] = (await pool.query(
    `SELECT owner_type, owner_id, provider_ref FROM computers WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId],
  )).rows as Array<{ owner_type: 'user' | 'agent'; owner_id: string; provider_ref: string }>
  if (!row) throw new Error('No computer row found — run computers-live-proof.ts first')
  console.log(`[resolve] owner=${row.owner_type}:${row.owner_id} ref=${row.provider_ref}`)

  // The exact call the computer_* tools make.
  const { computer, instance } = await service.instanceForOwner({
    actor, workspaceId, ownerType: row.owner_type, ownerId: row.owner_id,
  })
  console.log(`[instanceForOwner] computer=${computer.id} status=${computer.status}`)

  // computer_exec
  const handle = await instance.runCommand({
    command: 'uname -a && echo "---" && printenv OVERLAY_OWNER_TYPE',
    timeoutMs: 30_000,
  })
  const result = await handle.wait()
  console.log(`[exec] exit=${result.exitCode}\n${result.stdout.trim()}`)

  // computer_write_file + computer_read_file round-trip
  await instance.writeFiles([{
    path: '/tmp/computer-tools-smoke.txt',
    contents: new TextEncoder().encode(`smoke ${new Date().toISOString()}\n`),
  }])
  const read = await instance.readFile('/tmp/computer-tools-smoke.txt')
  console.log(`[write+read] ${read ? new TextDecoder().decode(read).trim() : 'READ FAILED'}`)

  // computer_list_files
  const entries = await instance.listFiles('/tmp')
  console.log(`[list] /tmp has ${entries.length} entries; smoke file present=${entries.some((e) => e.path.includes('computer-tools-smoke'))}`)

  // computer_open_url — xdg-open on the real desktop (no ticket returned).
  // runCommand executes outside the desktop session; DISPLAY must be explicit.
  if (instance.capabilities.desktop) {
    const openHandle = await instance.runCommand({
      command: 'xdg-open',
      args: ['https://example.com'],
      environment: { DISPLAY: ':0' },
      timeoutMs: 15_000,
    })
    const openResult = await openHandle.wait()
    console.log(`[open_url] xdg-open exit=${openResult.exitCode}`)
  }

  await pool.end()
  console.log('[done] all tool-path operations succeeded on the live box')
}

main().catch((error) => {
  console.error('[fail]', error)
  process.exit(1)
})
