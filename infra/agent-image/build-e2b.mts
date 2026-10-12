/**
 * Builds the Overlay agent image as an E2B template, for self-hosted Overlay Cloud agents.
 *
 * The same `provision.sh` that publishes the Boat snapshot adds the pinned Overlay layer (the Agent Host, acpx, and
 * the Claude Code and Codex ACP adapters) on top of E2B's base image plus Node 24. The template is built under the
 * name `overlay-agent` with the tag `v<imageVersion>`.
 *
 * Run from the repo root, against your E2B account (or `E2B_DOMAIN` for a self-hosted E2B):
 *   E2B_API_KEY=… npx tsx infra/agent-image/build-e2b.mts
 *   npx tsx infra/agent-image/build-e2b.mts --print     # show the Dockerfile and build nothing
 *
 * Then set, on the Overlay server:
 *   OVERLAY_MANAGED_SANDBOX_PROVIDER=e2b
 *   E2B_API_KEY=…
 *   OVERLAY_CLOUD_AGENT_IMAGE=overlay-agent:v<imageVersion>      (the line this script prints)
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Template, defaultBuildLogger } from 'e2b'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const printOnly = process.argv.includes('--print')
const versions = JSON.parse(readFileSync(join(here, 'versions.json'), 'utf8')) as { imageVersion: number }
const NAME = 'overlay-agent'
const tag = `v${versions.imageVersion}`
const STAGE = '/tmp/overlay-image'

function log(message: string) {
  process.stdout.write(`[build-e2b] ${message}\n`)
}

/** The inputs `provision.sh` expects, staged in one folder the template copies from. */
function stageContext(): string {
  const context = mkdtempSync(join(tmpdir(), 'overlay-e2b-'))
  const destination = join(context, 'overlay-image')
  mkdirSync(destination)
  for (const directory of ['packages/overlay-agent-bridge-protocol', 'packages/overlay-agent-host']) {
    const output = execFileSync('npm', ['pack', '--silent', '--pack-destination', destination], { cwd: join(root, directory), encoding: 'utf8' })
    log(`packed ${output.trim().split('\n').at(-1)}`)
  }
  copyFileSync(join(here, 'versions.json'), join(destination, 'versions.json'))
  copyFileSync(join(here, 'provision.sh'), join(destination, 'provision.sh'))
  return context
}

const context = stageContext()
const template = Template({ fileContextPath: context })
  .fromBaseImage()
  // The base image has no Node 24, which the host requires.
  .setUser('root')
  .runCmd([
    'apt-get update',
    'apt-get install -y --no-install-recommends ca-certificates curl gnupg sudo',
    'curl -fsSL https://deb.nodesource.com/setup_24.x | bash -',
    'apt-get install -y nodejs',
    'node --version',
  ])
  .copy('overlay-image', STAGE)
  .runCmd(`chown -R user:user ${STAGE}`)
  .setUser('user')
  .runCmd(`OVERLAY_IMAGE_SOURCE=${STAGE} bash ${STAGE}/provision.sh`)
  .setWorkdir('/home/user')

if (printOnly) {
  process.stdout.write(`${Template.toDockerfile(template)}\n`)
} else {
  log(`building ${NAME}:${tag} on E2B`)
  const built = await Template.build(template, `${NAME}:${tag}`, { onBuildLogs: defaultBuildLogger() })
  log(`built ${built.name} (${built.templateId})`)
  process.stdout.write(`\nOVERLAY_CLOUD_AGENT_IMAGE=${NAME}:${tag}\n`)
}
