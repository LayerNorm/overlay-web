/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const failures = []
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const requireText = (source, text, message) => {
  if (!source.includes(text)) failures.push(message)
}
const rejectText = (source, text, message) => {
  if (source.includes(text)) failures.push(message)
}

const packageJson = JSON.parse(read('package.json'))
const builder = read('electron-builder.yml')
const entitlements = read('build/entitlements.mac.plist')
const workflow = read('.github/workflows/release-mac.yml')
const updater = read('src/main/services/auto-updater.ts')
const settingsIpc = read('src/main/ipc/settings-ipc.ts')
const analytics = read('src/renderer/src/services/analytics.ts')
const sentryMain = read('src/main/services/sentry.ts')
const sentryRenderer = read('src/renderer/src/services/monitoring.ts')
const securityService = read('src/main/services/security/security-service.ts')
const modelDownloads = read('src/main/services/model-download-service.ts')

const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter((file) =>
  fs.existsSync(path.join(root, file))
)
if (lockfiles.join(',') !== 'package-lock.json') {
  failures.push(`npm package-lock.json must be the only lockfile; found: ${lockfiles.join(', ')}`)
}

for (const [name, expected] of Object.entries({
  electron: '39.8.10',
  'electron-builder': '26.15.3',
  '@electron/fuses': '2.1.3',
  axios: '1.18.1',
  'form-data': '4.0.6',
  dompurify: '3.4.12'
})) {
  const actual = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name]
  if (actual !== expected)
    failures.push(`${name} must be exactly pinned to ${expected}; got ${actual}`)
}

for (const fuse of [
  'runAsNode: false',
  'enableCookieEncryption: true',
  'enableNodeOptionsEnvironmentVariable: false',
  'enableNodeCliInspectArguments: false',
  'enableEmbeddedAsarIntegrityValidation: true',
  'onlyLoadAppFromAsar: true'
]) {
  requireText(builder, fuse, `missing required Electron fuse: ${fuse}`)
}
requireText(builder, 'hardenedRuntime: true', 'macOS hardened runtime must be enabled')
requireText(
  builder,
  'entitlements: build/entitlements.mac.plist',
  'main entitlements must be explicit'
)
requireText(builder, '- zip', 'ZIP updater artifact must be built with the DMG')
rejectText(
  entitlements,
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'unsigned executable memory entitlement is prohibited'
)
rejectText(
  entitlements,
  'com.apple.security.cs.disable-library-validation',
  'disabled library validation entitlement is prohibited'
)

if (/uses:\s+\S+@v\d/.test(workflow)) {
  failures.push('every GitHub Action must be pinned to an immutable commit SHA')
}
requireText(
  workflow,
  'release_source_sha:',
  'release workflow must require an immutable source SHA'
)
requireText(workflow, 'persist-credentials: false', 'checkout credentials must not persist')
requireText(workflow, "node-version: '22'", 'release Node version must match package engines')
requireText(workflow, 'if: ${{ false }}', 'release workflow must remain frozen until Gate B')
const buildIndex = workflow.indexOf('Build, sign, and notarize')
const publishTokenIndex = workflow.indexOf('Create release publishing token')
if (buildIndex < 0 || publishTokenIndex < buildIndex) {
  failures.push('release publishing credentials must be created only after the verified build')
}

for (const text of [
  'autoUpdater.autoDownload = false',
  'autoUpdater.allowDowngrade = false',
  'autoUpdater.allowPrerelease = false',
  "autoUpdater.channel = 'latest'",
  'isAllowedStableUpgrade'
]) {
  requireText(updater, text, `updater policy is missing: ${text}`)
}

requireText(
  settingsIpc,
  'if (!settingsService.analyticsConsentEnabled) return null',
  'analytics token must be gated on explicit consent'
)
requireText(
  analytics,
  'if (!consentEnabled) return',
  'usage tracking must fail closed without consent'
)
requireText(
  analytics,
  'clearStoredStats()',
  'revoking consent must delete locally retained analytics'
)
requireText(sentryMain, 'beforeSend:', 'main Sentry must redact before sending')
requireText(sentryRenderer, 'beforeSend:', 'renderer Sentry must redact before sending')
rejectText(securityService, 'PINNED_CERTIFICATES', 'inert certificate pinning must stay removed')
rejectText(
  securityService,
  'verifyCertificatePinning',
  'inert certificate pinning export must stay removed'
)
requireText(securityService, 'mode: 0o600', 'audit logs must be owner-only')
requireText(securityService, '14 * 24 * 60 * 60 * 1000', 'audit log retention must be bounded')
rejectText(modelDownloads, '/tree/main/', 'model file listings must not use a mutable branch')
rejectText(modelDownloads, '/resolve/main/', 'model downloads must not use a mutable branch')
for (const revision of [
  '97a5bf9bbc74c7d9c12c755d04dea59e672e3808',
  'ee09c569f73759e6d44c9bd16766f477b2b36d39'
]) {
  requireText(modelDownloads, revision, `model source revision must stay pinned: ${revision}`)
}

if (failures.length > 0) {
  console.error(`Release security boundary failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('Release security boundary passed')
