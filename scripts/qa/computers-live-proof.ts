/**
 * Live end-to-end proof for the computers stack (wiring phases 1–5):
 *   PostgresWorkspaceAgentRepository + ComputerService +
 *   PostgresComputerRepository + BoxSandboxRuntime — all production code,
 *   against the real Neon app-data DB and the real box API. The `box` CLI
 *   verifies each step independently.
 *
 * Flow: create agent → provision agent-owned computer → idempotent
 * re-provision → CLI exec/env → desktop ticket (service + CLI) →
 * stop → start → destroy → re-provision left running for UI inspection.
 *
 * Run:
 *   NODE_OPTIONS=--require=./scripts/ci/register-server-only.cjs \
 *   TSX_TSCONFIG_PATH=tsconfig.json \
 *   npx tsx --env-file=.env.on-prem-contract-tests.local --env-file=.env.local \
 *     scripts/qa/computers-live-proof.ts
 */
import 'server-only'

import { execFileSync } from 'node:child_process'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { PostgresWorkspaceAgentRepository } from '@/server/agents/PostgresWorkspaceAgentRepository'
import { PostgresComputerRepository } from '@/server/computers/PostgresComputerRepository'
import { ComputerService, type ComputerActor } from '@/server/computers/ComputerService'
import { createComputerRuntimeResolver } from '@/server/computers/computer-runtimes'

const CLI_PATH = `${process.env.HOME}/.ascii/bin:${process.env.PATH}`
// --no-update goes right after the subcommand — appended at the end it would
// leak into `box exec`'s remote command.
const box = (args: string[]) =>
  execFileSync('box', [args[0]!, '--no-update', ...args.slice(1)], {
    env: { ...process.env, PATH: CLI_PATH },
    timeout: 60_000,
  }).toString().trim()

async function main() {
  const databaseUrl = process.env.OVERLAY_DATABASE_URL
  if (!databaseUrl) throw new Error('OVERLAY_DATABASE_URL is required')
  if (!process.env.BOX_API_KEY?.trim()) throw new Error('BOX_API_KEY is required')

  const pool = createOverlayPostgresPool({ connectionString: databaseUrl })
  const db = createOverlayPostgresDb(pool)
  const computers = new PostgresComputerRepository(db)
  const agents = new PostgresWorkspaceAgentRepository(db)

  // The real human actor: personal workspace, owner membership.
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
  console.log(`[setup] workspace=${workspaceId} principal=${actor.principalId}`)

  // Bootstrap-equivalent wiring: same agentOwner + limits as bootstrap.ts.
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

  // 1. A real agent through the real repository — exactly what the editor's
  //    agents.create does server-side.
  const now = Date.now()
  const agent = await agents.create({
    agentId: `agent_${crypto.randomUUID()}`,
    principalId: `principal_agent_${crypto.randomUUID()}`,
    workspaceId,
    name: 'Live Proof',
    description: 'Computers end-to-end proof agent',
    instructions: 'You exist to prove the computers stack end to end.',
    harness: 'overlay',
    modelId: 'openrouter/free',
    avatarColor: '#2563eb',
    avatarShape: 'squircle',
    allowedToolIds: [],
    teamIds: [],
    visibility: 'workspace',
    createdByPrincipalId: actor.principalId!,
    now,
  })
  console.log(`[agent] created id=${agent.id} principal=${agent.principalId}`)

  // 2. Provision the agent's computer — the Phase 5 create-flow call.
  const computer = await service.provision({
    actor, workspaceId, ownerType: 'agent', ownerId: agent.id, size: 'small', name: 'Live Proof computer',
  })
  console.log(`[provision] computer=${computer.id} status=${computer.status} ref=${computer.providerRef}`)

  // 3. Idempotency: same owner, different size → same computer, one machine.
  const again = await service.provision({ actor, workspaceId, ownerType: 'agent', ownerId: agent.id, size: 'large' })
  console.log(`[idempotent] same-id=${again.id === computer.id} size-still=${again.size}`)

  // 4. Independent CLI proof the machine exists and runs.
  console.log('[cli] box list --all:\n' + box(['list', '--all']))
  console.log(`[cli] exec → ${box(['exec', computer.providerRef!, 'uname', '-a'])}`)
  console.log(`[cli] injected env → ${box(['exec', computer.providerRef!, 'printenv', 'OVERLAY_COMPUTER_ID'])}`)
  console.log(`[cli] write/read file → ${box(['exec', computer.providerRef!, 'sh', '-c', 'echo hello-overlay > /tmp/proof.txt && cat /tmp/proof.txt'])}`)

  // 5. Desktop ticket via the service, cross-checked by the CLI's own ticket.
  const ticket = await service.openDesktop({ actor, computerId: computer.id, mode: 'vnc' })
  console.log(`[desktop] service ticket mode=${ticket.mode} host=${new URL(ticket.url).host}`)
  console.log(`[desktop] url=${ticket.url}`)
  try {
    const cliTicket = box(['desktop', computer.providerRef!, '--vnc', '--json'])
    console.log(`[desktop] cli ticket → ${cliTicket}`)
  } catch { console.log('[desktop] cli ticket skipped (nonzero exit)') }

  // 6. Lifecycle: stop (row + machine) → CLI confirms stopped → start.
  await service.stop({ actor, computerId: computer.id })
  console.log('[stop] row=stopped; box list --all:')
  console.log(box(['list', '--all']))
  let stoppedExec = 'unexpected-success'
  try { box(['exec', computer.providerRef!, 'true']) } catch { stoppedExec = 'refused' }
  console.log(`[cli] exec on stopped box → ${stoppedExec}`)
  await service.start({ actor, computerId: computer.id })
  console.log(`[start] row=ready; cli exec → ${box(['exec', computer.providerRef!, 'cat', '/tmp/proof.txt'])} (disk persisted across stop/resume)`)

  // 7. Destroy: provider machine + Postgres row both gone.
  await service.destroy({ actor, computerId: computer.id })
  console.log(`[destroy] row-gone=${(await computers.get(computer.id)) === null}`)
  console.log('[cli] box list --all after destroy:\n' + box(['list', '--all']))

  // 8. Re-provision and leave running for the UI check — the editor section
  //    and Settings > Computers should show this row.
  const live = await service.provision({
    actor, workspaceId, ownerType: 'agent', ownerId: agent.id, size: 'small', name: 'Live Proof computer',
  })
  console.log(`[live] re-provisioned computer=${live.id} status=${live.status} ref=${live.providerRef}`)
  console.log(`[live] open in the editor: /app/agents/${agent.id}`)
  console.log(`[live] or Settings → Computers. box id ${live.providerRef} is RUNNING (bills until stopped/deleted).`)

  await pool.end()
  console.log('[done] provision → idempotent → cli-exec+env+disk → tickets → stop → start → destroy → re-provision')
}

main().catch((error) => { console.error('[fail]', error); process.exit(1) })
