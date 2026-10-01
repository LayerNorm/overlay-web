/**
 * Publishes the Overlay agent image for Boat (Overlay Cloud) as a named
 * snapshot `overlay-agent-v<imageVersion>`.
 *
 * Boat has no custom-image API, so the image is a frozen machine: provision a
 * fresh Boat machine (its system layer already has Node 24, toolchains, and the
 * Claude Code / Codex CLIs), run `provision.sh` to add the pinned Overlay layer,
 * verify it with `overlay-agent-host image-check`, then snapshot and delete it.
 *
 * Run from the repo root:
 *   BOAT_API_KEY=… npx tsx infra/agent-image/publish-boat.mts [--keep]
 *
 * Prints the snapshot name to set as OVERLAY_CLOUD_AGENT_IMAGE.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BoxSandboxRuntime } from '../../packages/overlay-sandbox-runtime/src/box'
import type { SandboxInstance } from '../../packages/overlay-sandbox-runtime/src/contracts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const keep = process.argv.includes('--keep')
const versions = JSON.parse(readFileSync(join(here, 'versions.json'), 'utf8')) as { imageVersion: number }
const snapshotName = `overlay-agent-v${versions.imageVersion}`
const stage = '/tmp/overlay-image'

function log(message: string) {
  process.stdout.write(`[publish-boat] ${message}\n`)
}

function packWorkspace(directory: string, destination: string): string {
  const output = execFileSync('npm', ['pack', '--silent', '--pack-destination', destination], {
    cwd: join(root, directory), encoding: 'utf8',
  })
  return output.trim().split('\n').at(-1)!
}

async function run(machine: SandboxInstance, script: string, timeoutMs: number) {
  const result = await (await machine.runCommand({ command: 'bash', args: ['-lc', script], timeoutMs })).wait()
  if (result.exitCode !== 0) {
    throw new Error(`command failed (${result.exitCode}): ${script}\n${result.stdout.slice(-4_000)}\n${result.stderr.slice(-4_000)}`)
  }
  return result.stdout
}

const packed = mkdtempSync(join(tmpdir(), 'overlay-image-'))
log('packing the Agent Host and bridge protocol from this checkout')
const tarballs = [
  packWorkspace('packages/overlay-agent-bridge-protocol', packed),
  packWorkspace('packages/overlay-agent-host', packed),
]

const runtime = new BoxSandboxRuntime({})
log('creating a fresh Boat machine')
const machine = await runtime.create({
  name: `overlay-image-build-${Date.now()}`,
  persistent: true,
  networkPolicy: { mode: 'allow_all' },
  idleTimeoutMs: 0,
  hardTimeoutMs: 60 * 60_000,
  resources: { vcpus: 2, memoryGiB: 4, diskGiB: 40 },
})
try {
  log(`machine ${machine.reference}: staging inputs`)
  await machine.writeFiles([
    ...tarballs.map((file) => ({ path: `${stage}/${file}`, contents: readFileSync(join(packed, file)) })),
    { path: `${stage}/versions.json`, contents: readFileSync(join(here, 'versions.json')) },
    { path: `${stage}/provision.sh`, contents: readFileSync(join(here, 'provision.sh')), mode: 0o755 },
  ])
  log('running provision.sh')
  process.stdout.write(await run(machine, `cp ${stage}/provision.sh /tmp/overlay-provision.sh && OVERLAY_IMAGE_SOURCE=${stage} bash /tmp/overlay-provision.sh && rm -f /tmp/overlay-provision.sh`, 30 * 60_000))
  log('verifying from a fresh login shell')
  process.stdout.write(await run(machine, 'overlay-agent-host image-check && cat /etc/overlay/image.json', 120_000))

  if (machine.snapshot === undefined) throw new Error('this runtime cannot snapshot')
  await runtime.deleteSnapshot(snapshotName).then(() => log(`replaced existing ${snapshotName}`), () => undefined)
  log(`snapshotting as ${snapshotName}`)
  const snapshot = await machine.snapshot({ name: snapshotName })
  log(`published ${snapshot.id}`)
  process.stdout.write(`\nOVERLAY_CLOUD_AGENT_IMAGE=${snapshot.id}\n`)
} finally {
  rmSync(packed, { recursive: true, force: true })
  if (keep) log(`kept machine ${machine.reference} for inspection`)
  else await machine.delete().catch((error) => log(`cleanup failed: ${String(error)}`))
}

