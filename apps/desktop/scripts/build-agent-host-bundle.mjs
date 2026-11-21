import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

// Assembles agent-host-bundle/runtime (`node` and `overlay-agent-host.mjs`):
// the Node.js runtime and the Agent Host that the app starts for threads on this computer, so nobody has to install
// Node.js. Both are pinned: Node.js by the checksum of its official archive and
// of the extracted binary (native-artifacts.json), the host by
// agent-host-bundle/package-lock.json.
const NODE_VERSION = '24.22.3'
const NODE_ARCHIVE = `node-v${NODE_VERSION}-darwin-arm64`
const NODE_ARCHIVE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}.tar.gz`
const NODE_ARCHIVE_SHA256 = 'ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd'

const root = path.resolve(import.meta.dirname, '..')
const bundle = path.join(root, 'agent-host-bundle')
const runtime = path.join(bundle, 'runtime')
const nodeBinary = path.join(runtime, 'node')
const hostCli = path.join(runtime, 'overlay-agent-host.mjs')
const stamp = path.join(runtime, '.bundle-stamp')

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const pinnedNode = JSON.parse(fs.readFileSync(path.join(root, 'native-artifacts.json'), 'utf8')).artifacts.find(
  (artifact) => artifact.path === 'agent-host-bundle/runtime/node'
)
if (!pinnedNode) throw new Error('native-artifacts.json does not pin agent-host-bundle/runtime/node')
const wanted = `${NODE_ARCHIVE_SHA256}:${sha256(path.join(bundle, 'package-lock.json'))}`

if (
  fs.existsSync(stamp) &&
  fs.readFileSync(stamp, 'utf8') === wanted &&
  fs.existsSync(hostCli) &&
  sha256(nodeBinary) === pinnedNode.sha256
) {
  console.log('Agent host bundle is up to date.')
  process.exit(0)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-agent-host-'))
try {
  fs.rmSync(runtime, { recursive: true, force: true })
  fs.mkdirSync(runtime, { recursive: true })

  const archive = path.join(work, 'node.tar.gz')
  const response = await fetch(NODE_ARCHIVE_URL)
  if (!response.ok) throw new Error(`Node.js download failed (${response.status})`)
  fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
  if (sha256(archive) !== NODE_ARCHIVE_SHA256) throw new Error('Node.js archive checksum does not match the pin')
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', work, `${NODE_ARCHIVE}/bin/node`, `${NODE_ARCHIVE}/LICENSE`])
  fs.copyFileSync(path.join(work, NODE_ARCHIVE, 'bin/node'), nodeBinary)
  fs.chmodSync(nodeBinary, 0o755)
  if (sha256(nodeBinary) !== pinnedNode.sha256) {
    throw new Error(`Node.js binary is ${sha256(nodeBinary)}, native-artifacts.json pins ${pinnedNode.sha256}`)
  }
  if (sha256(path.join(work, NODE_ARCHIVE, 'LICENSE')) !== sha256(path.join(root, pinnedNode.licenseFile))) {
    throw new Error(`${pinnedNode.licenseFile} is not the license of Node.js ${NODE_VERSION}`)
  }

  const stage = path.join(work, 'stage')
  fs.mkdirSync(stage)
  for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(bundle, file), path.join(stage, file))
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: stage, stdio: 'inherit' })
  // One file with the host and its dependencies: electron-builder leaves
  // node_modules folders out of extra resources, and the host reads nothing
  // from its own package folder.
  await build({
    // Paths in the output are relative to this, so it is the same on every machine.
    absWorkingDir: stage,
    entryPoints: ['node_modules/@layernorm/overlay-agent-host/dist/cli.js'],
    outfile: hostCli,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    // The host's model SDKs pull in CommonJS packages that call require(); an ESM bundle has no require of its own.
    banner: { js: "import { createRequire as __overlayCreateRequire } from 'node:module'; const require = __overlayCreateRequire(import.meta.url);" },
    logLevel: 'warning'
  })

  // The bundled runtime must start the bundled host with nothing else on PATH.
  const usage = spawnSync(nodeBinary, [hostCli, '--help'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' })
  if (!`${usage.stdout}${usage.stderr}`.includes('overlay-agent-host connect')) {
    throw new Error(`The bundled host did not start: ${usage.stderr || usage.error?.message}`)
  }
  fs.writeFileSync(stamp, wanted)
  if (/\/Users\/|\/var\/folders\//.test(fs.readFileSync(hostCli, 'utf8'))) {
    throw new Error('The bundled host contains a private workstation path')
  }
  console.log(`Built agent-host-bundle/runtime with Node.js ${NODE_VERSION}.`)
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
