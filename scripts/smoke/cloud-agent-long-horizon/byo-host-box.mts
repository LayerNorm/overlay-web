/**
 * QA fixture: run an Agent Host on a disposable Boat box and enroll it into a protected PR preview, as a `vps`
 * environment. Overlay Cloud machines cannot enroll into a preview behind Vercel Authentication, and they only run the
 * published host; this runs any host build (the published package, or this branch packed as tarballs) through the
 * real bridge path. See internal/develop/browser-testing-with-agent-browser.md ("unattended Agent Host acceptance").
 *
 * The automation bypass secret and the Claude token are written to mode-0600 files on the box. A preload adds the
 * bypass header only to requests for the exact PR origin. Delete the box when QA ends.
 *
 * Usage (from overlay-landing/):
 *   npx tsx scripts/smoke/cloud-agent-long-horizon/byo-host-box.mts create
 *   npx tsx …/byo-host-box.mts start <box> <enrollment-code> --preview-url https://pr-<n>.preview.getoverlay.io
 *        [--host published@0.3.11 | --host local]   (local = pack this checkout's protocol + host packages)
 *   npx tsx …/byo-host-box.mts log <box>
 *   npx tsx …/byo-host-box.mts delete <box>
 * Env: BOX_API_KEY | BOAT_API_KEY, VERCEL_AUTOMATION_BYPASS_SECRET, CLAUDE_SETUP_TOKEN
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BoxSandboxRuntime } from '../../../packages/overlay-sandbox-runtime/src/box'
import type { SandboxInstance } from '../../../packages/overlay-sandbox-runtime/src/contracts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')
const [verb, boxId, code] = process.argv.slice(2)
const flag = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const QA_HOME = '/home/user'
const QA = `${QA_HOME}/.qa-host`
const WORK = `${QA_HOME}/work`
if (process.env.BOAT_ENVIRONMENT !== 'overlay-preview') throw new Error('QA hosts require BOAT_ENVIRONMENT=overlay-preview and its scoped API key')
const runtime = new BoxSandboxRuntime({ environment: 'overlay-preview' })
const text = (value: string) => new TextEncoder().encode(value)

async function sh(box: SandboxInstance, script: string, timeoutMs = 600_000) {
  const result = await (await box.runCommand({ command: 'bash', args: ['-lc', script], timeoutMs })).wait()
  if (result.exitCode !== 0) throw new Error(`box command failed (${result.exitCode}): ${result.stderr.slice(-1500)}`)
  return result.stdout
}

function packLocalHost(): string[] {
  const out = mkdtempSync(join(tmpdir(), 'overlay-host-pack-'))
  for (const pkg of ['overlay-agent-bridge-protocol', 'overlay-agent-host']) {
    execFileSync('npm', ['run', 'build'], { cwd: join(repo, 'packages', pkg), stdio: 'inherit' })
    execFileSync('npm', ['pack', '--pack-destination', out], { cwd: join(repo, 'packages', pkg), stdio: 'inherit' })
  }
  return readdirSync(out).filter((name) => name.endsWith('.tgz')).map((name) => join(out, name))
}

async function main() {
  if (verb === 'create') {
    const box = await runtime.create({ name: `overlay-qa-host-${Date.now()}`, persistent: true, networkPolicy: { mode: 'allow_all' },
      idleTimeoutMs: 0, hardTimeoutMs: 4 * 3600_000, resources: { vcpus: 2, memoryGiB: 4, diskGiB: 40 } })
    console.log(box.reference)
    return
  }
  if (!boxId) throw new Error('box id required')
  const box = await runtime.reconnect(boxId)
  if (verb === 'log') {
    console.log(await sh(box, `tail -n 80 ${QA}/host.log 2>/dev/null; echo; ls ${QA}/state 2>/dev/null`))
    return
  }
  if (verb === 'delete') {
    await box.delete()
    console.log('deleted', boxId)
    return
  }
  if (verb !== 'start' || !code) throw new Error('usage: start <box> <enrollment-code> --preview-url <origin>')
  const origin = new URL(flag('preview-url') ?? '').origin
  if (!/^https:\/\/pr-[1-9]\d*\.preview\.getoverlay\.io$/.test(origin)) throw new Error('--preview-url must be a canonical PR preview origin')
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  const claude = process.env.CLAUDE_SETUP_TOKEN?.trim()
  if (!bypass || !claude) throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET and CLAUDE_SETUP_TOKEN are required')
  const host = flag('host', 'published@0.3.11')!

  await sh(box, `mkdir -p ${QA}/state ${QA}/pkg ${WORK} && chmod 700 ${QA}`)
  await box.writeFiles([
    { path: `${QA}/bypass`, contents: text(bypass) },
    { path: `${QA}/claude.env`, contents: text(`export CLAUDE_CODE_OAUTH_TOKEN='${claude}'\n`) },
    // The host signs method, path and body; an extra header leaves its request proof intact.
    { path: `${QA}/bypass.mjs`, contents: text(`import { readFileSync } from 'node:fs'
const origin = ${JSON.stringify(origin)}
const secret = readFileSync(${JSON.stringify(`${QA}/bypass`)}, 'utf8').trim()
// Preload only the host; never forward the private transport configuration into provider children.
delete process.env.NODE_OPTIONS
const original = globalThis.fetch
globalThis.fetch = (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.origin !== origin) return original(input, init)
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
  headers.set('x-vercel-protection-bypass', secret)
  return original(input, { ...init, headers })
}
`) },
  ])
  await sh(box, `chmod 600 ${QA}/bypass ${QA}/claude.env`)

  let bin: string
  if (host === 'local') {
    const tarballs = packLocalHost()
    await box.writeFiles(tarballs.map((path) => ({ path: `${QA}/pkg/${path.split('/').pop()}`, contents: readFileSync(path) })))
    await sh(box, `cd ${QA}/pkg && npm init -y >/dev/null && npm i --no-audit --no-fund ./*.tgz >/dev/null 2>&1 && ls node_modules/.bin | grep overlay`)
    bin = `${QA}/pkg/node_modules/.bin/overlay-agent-host`
  } else {
    const version = host.replace(/^published@/, '')
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('expected an exact published host version')
    await sh(box, `cd ${QA}/pkg && npm init -y >/dev/null && npm i --no-audit --no-fund @layernorm/overlay-agent-host@${version} >/dev/null 2>&1 && ls node_modules/.bin | grep overlay`)
    bin = `${QA}/pkg/node_modules/.bin/overlay-agent-host`
  }
  // Only the host loads the private exact-origin wrapper. Provider processes do not inherit its NODE_OPTIONS.
  await sh(box, `cd ${WORK} && (set -a; . ${QA}/claude.env; set +a; export NODE_OPTIONS="--import ${QA}/bypass.mjs"; `
    + `nohup ${bin} connect '${code}' --server '${origin}' --kind vps --adapter claude-code --name 'QA smoke host' `
    + `--state-dir ${QA}/state --run >> ${QA}/host.log 2>&1 < /dev/null &); sleep 8; tail -n 20 ${QA}/host.log`)
    .then((output) => console.log(output))
}

main().catch((error) => { console.error(error); process.exit(1) })
