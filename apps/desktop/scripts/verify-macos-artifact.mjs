/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { extractAll, listPackage } from '@electron/asar'
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const allowUnsignedLocal = process.env.ALLOW_UNSIGNED_LOCAL_ARTIFACT === '1'
const allowDirectoryOnlyLocal =
  allowUnsignedLocal && process.env.ALLOW_DIRECTORY_ONLY_LOCAL_ARTIFACT === '1'
const failures = []

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(entryPath) : [entryPath]
  })
}

const appBundles = walk(dist).filter((file) => file.endsWith('.app/Contents/MacOS/Overlay'))
if (appBundles.length !== 1) {
  failures.push(`expected one Overlay.app bundle, found ${appBundles.length}`)
}
const executable = appBundles[0]
const appBundle = executable
  ? executable.slice(0, executable.indexOf('.app/Contents/MacOS/Overlay') + 4)
  : null

if (appBundle) {
  try {
    execFileSync(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '--verbose=2', appBundle],
      {
        stdio: 'pipe'
      }
    )
    execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appBundle], {
      stdio: 'pipe'
    })
  } catch (error) {
    if (!allowUnsignedLocal)
      failures.push(`signature or Gatekeeper verification failed: ${error.message}`)
  }

  const fuseWire = await getCurrentFuseWire(appBundle)
  const expectedFuses = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE]
  ])
  for (const [fuse, expected] of expectedFuses) {
    if (fuseWire[fuse] !== expected) {
      failures.push(`unexpected Electron fuse ${FuseV1Options[fuse]}=${fuseWire[fuse]}`)
    }
  }

  const asarPath = path.join(appBundle, 'Contents', 'Resources', 'app.asar')
  if (!fs.existsSync(asarPath)) {
    failures.push('packaged app.asar is missing')
  } else {
    const entries = listPackage(asarPath, { isPack: false })
    const prohibitedNames = entries.filter(
      (entry) =>
        /(?:^|\/)\.env(?:\.|$)/.test(entry) ||
        /\.(?:pem|p12|pfx|mobileprovision)$/i.test(entry) ||
        /(?:^|\/)\.npmrc$/.test(entry) ||
        entry.endsWith('.map') ||
        entry.includes('pnpm-lock.yaml')
    )
    if (prohibitedNames.length) {
      failures.push(`prohibited packaged files: ${prohibitedNames.slice(0, 10).join(', ')}`)
    }

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-artifact-'))
    try {
      extractAll(asarPath, temporary)
      const secretPattern =
        /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk_(?:test|prod)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[opsu]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|(?:sk|rk)_live_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/
      for (const file of walk(path.join(temporary, 'out')).filter((candidate) => {
        const size = fs.statSync(candidate).size
        return size <= 32 * 1024 * 1024
      })) {
        const content = fs.readFileSync(file, 'utf8')
        if (secretPattern.test(content))
          failures.push(`possible secret in ${path.relative(temporary, file)}`)
        if (/\/Users\/[^/\s]+\/|\/var\/folders\//.test(content)) {
          failures.push(`developer machine path in ${path.relative(temporary, file)}`)
        }
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
  }

  const nativeManifest = JSON.parse(
    fs.readFileSync(path.join(root, 'native-artifacts.json'), 'utf8')
  )
  const packagedNativePaths = new Map([
    ['resources/ax-helper', 'resources/ax-helper'],
    ['whisperkit-bundle/whisperkit-cli', 'whisperkit/whisperkit-cli'],
    ['parakeet-bundle/parakeet-cli', 'parakeet/parakeet-cli']
  ])
  for (const artifact of nativeManifest.artifacts ?? []) {
    const packagedRelative = packagedNativePaths.get(artifact.path)
    if (!packagedRelative) {
      failures.push(`native artifact has no packaged-path policy: ${artifact.path}`)
      continue
    }
    const packagedPath = path.join(appBundle, 'Contents', 'Resources', packagedRelative)
    if (!fs.existsSync(packagedPath)) {
      failures.push(`packaged native artifact is missing: ${packagedRelative}`)
      continue
    }
    const packagedDigest = createHash('sha256')
      .update(fs.readFileSync(packagedPath))
      .digest('hex')
    if (packagedDigest !== artifact.sha256) {
      failures.push(
        `packaged native artifact hash mismatch: ${packagedRelative} expected ${artifact.sha256} got ${packagedDigest}`
      )
    }
  }
}

for (const artifact of walk(dist).filter((file) => file.endsWith('.dmg'))) {
  try {
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', artifact], { stdio: 'pipe' })
  } catch (error) {
    if (!allowUnsignedLocal)
      failures.push(`notarization staple validation failed: ${error.message}`)
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const manifestFiles = walk(dist)
  .filter((file) => /\.(?:dmg|zip|yml|blockmap)$/.test(file) || file.endsWith('sbom.cdx.json'))
  .map((file) => ({
    file: path.relative(dist, file),
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    bytes: fs.statSync(file).size
  }))
if (!allowDirectoryOnlyLocal && !manifestFiles.some(({ file }) => file.endsWith('.dmg')))
  failures.push('DMG artifact is missing')
if (!allowDirectoryOnlyLocal && !manifestFiles.some(({ file }) => file.endsWith('.zip')))
  failures.push('ZIP update artifact is missing')
if (!allowDirectoryOnlyLocal && !manifestFiles.some(({ file }) => file === 'latest-mac.yml'))
  failures.push('updater metadata is missing')
if (!manifestFiles.some(({ file }) => file === 'sbom.cdx.json'))
  failures.push('CycloneDX SBOM is missing')

if (failures.length) {
  console.error(`macOS artifact verification failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

fs.writeFileSync(
  path.join(dist, 'release-manifest.json'),
  JSON.stringify(
    {
      version: packageJson.version,
      sourceCommit: process.env.RELEASE_SOURCE_SHA || null,
      architecture: 'arm64',
      verificationMode: allowDirectoryOnlyLocal ? 'unsigned-directory-local' : 'release',
      files: manifestFiles
    },
    null,
    2
  ) + '\n'
)
console.log('macOS artifact verification passed')
