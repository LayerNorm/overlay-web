import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'

// Assembles agent-host-bundle/runtime (`node`, `overlay-agent-host.mjs` and `cli-proxy-api`):
// the Node.js runtime and the Agent Host that the app starts for threads on this computer, so nobody has to install
// Node.js, and CLIProxyAPI, which lets private threads use the Claude and ChatGPT plans a person signs in to on this
// computer. All are pinned: Node.js and CLIProxyAPI by the checksum of their official release archive and of the
// extracted binary (native-artifacts.json), the host by agent-host-bundle/package-lock.json. electron-builder signs
// and notarizes both binaries with the app, as extra resources.
const NODE_VERSION = '24.22.3'
const NODE_ARCHIVE = `node-v${NODE_VERSION}-darwin-arm64`
const NODE_ARCHIVE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}.tar.gz`
const NODE_ARCHIVE_SHA256 = 'ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd'

// https://github.com/router-for-me/CLIProxyAPI (MIT). The app ships arm64; x64 is pinned for an Intel build.
const CLI_PROXY_VERSION = '8.1.7'
const CLI_PROXY_RELEASES = {
  arm64: {
    archive: `CLIProxyAPI_${CLI_PROXY_VERSION}_darwin_aarch64.tar.gz`,
    archiveSha256: '667e6f2473e898ac3a6d16c01c9ce5cdf739a13b528cc80d328651a350691a2c',
    binarySha256: '39970dc956e03a23199d18b850169a24f4b80d71fad25d47c6e32f3c04505607'
  },
  x64: {
    archive: `CLIProxyAPI_${CLI_PROXY_VERSION}_darwin_amd64.tar.gz`,
    archiveSha256: '7086c5f04a2182bfdd1dee6c5c145d59725cef31d8bc37e3a613f346fe1352cc',
    binarySha256: 'b719059e300682155b368c1e44c57da74323612466783cc553fa01705dd4be22'
  }
}
const CLI_PROXY_ARCH = process.env.OVERLAY_DESKTOP_ARCH === 'x64' ? 'x64' : 'arm64'
const cliProxyRelease = CLI_PROXY_RELEASES[CLI_PROXY_ARCH]
const CLI_PROXY_ARCHIVE_URL = `https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLI_PROXY_VERSION}/${cliProxyRelease.archive}`

const root = path.resolve(import.meta.dirname, '..')
const bundle = path.join(root, 'agent-host-bundle')
const runtime = path.join(bundle, 'runtime')
const nodeBinary = path.join(runtime, 'node')
const hostCli = path.join(runtime, 'overlay-agent-host.mjs')
const cliProxyBinary = path.join(runtime, 'cli-proxy-api')
const stamp = path.join(runtime, '.bundle-stamp')

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const pinnedNode = JSON.parse(fs.readFileSync(path.join(root, 'native-artifacts.json'), 'utf8')).artifacts.find(
  (artifact) => artifact.path === 'agent-host-bundle/runtime/node'
)
if (!pinnedNode) throw new Error('native-artifacts.json does not pin agent-host-bundle/runtime/node')
const pinnedCliProxy = JSON.parse(fs.readFileSync(path.join(root, 'native-artifacts.json'), 'utf8')).artifacts.find(
  (artifact) => artifact.path === 'agent-host-bundle/runtime/cli-proxy-api'
)
if (!pinnedCliProxy) throw new Error('native-artifacts.json does not pin agent-host-bundle/runtime/cli-proxy-api')
if (pinnedCliProxy.sha256 !== CLI_PROXY_RELEASES.arm64.binarySha256) {
  throw new Error('native-artifacts.json and this script pin different CLIProxyAPI binaries')
}
const wanted = `${NODE_ARCHIVE_SHA256}:${cliProxyRelease.archiveSha256}:${sha256(path.join(bundle, 'package-lock.json'))}`

if (
  fs.existsSync(stamp) &&
  fs.readFileSync(stamp, 'utf8') === wanted &&
  fs.existsSync(hostCli) &&
  sha256(nodeBinary) === pinnedNode.sha256 &&
  fs.existsSync(cliProxyBinary) &&
  sha256(cliProxyBinary) === cliProxyRelease.binarySha256
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

  const proxyArchive = path.join(work, 'cli-proxy-api.tar.gz')
  const proxyResponse = await fetch(CLI_PROXY_ARCHIVE_URL)
  if (!proxyResponse.ok) throw new Error(`CLIProxyAPI download failed (${proxyResponse.status})`)
  fs.writeFileSync(proxyArchive, Buffer.from(await proxyResponse.arrayBuffer()))
  if (sha256(proxyArchive) !== cliProxyRelease.archiveSha256) throw new Error('CLIProxyAPI archive checksum does not match the pin')
  const proxyDirectory = path.join(work, 'cli-proxy-api')
  fs.mkdirSync(proxyDirectory)
  execFileSync('/usr/bin/tar', ['-xzf', proxyArchive, '-C', proxyDirectory, 'cli-proxy-api', 'LICENSE'])
  fs.copyFileSync(path.join(proxyDirectory, 'cli-proxy-api'), cliProxyBinary)
  fs.chmodSync(cliProxyBinary, 0o755)
  if (sha256(cliProxyBinary) !== cliProxyRelease.binarySha256) {
    throw new Error(`CLIProxyAPI binary is ${sha256(cliProxyBinary)}, the pin is ${cliProxyRelease.binarySha256}`)
  }
  if (sha256(path.join(proxyDirectory, 'LICENSE')) !== sha256(path.join(root, pinnedCliProxy.licenseFile))) {
    throw new Error(`${pinnedCliProxy.licenseFile} is not the license of CLIProxyAPI ${CLI_PROXY_VERSION}`)
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
  const proxyHelp = spawnSync(cliProxyBinary, ['--help'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 15_000 })
  if (CLI_PROXY_ARCH === process.arch && !`${proxyHelp.stdout}${proxyHelp.stderr}`.includes(`CLIProxyAPI Version: ${CLI_PROXY_VERSION}`)) {
    throw new Error(`The bundled CLIProxyAPI did not start: ${proxyHelp.stderr || proxyHelp.error?.message}`)
  }
  fs.writeFileSync(stamp, wanted)
  if (/\/Users\/|\/var\/folders\//.test(fs.readFileSync(hostCli, 'utf8'))) {
    throw new Error('The bundled host contains a private workstation path')
  }
  console.log(`Built agent-host-bundle/runtime with Node.js ${NODE_VERSION} and CLIProxyAPI ${CLI_PROXY_VERSION} (${CLI_PROXY_ARCH}).`)
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
