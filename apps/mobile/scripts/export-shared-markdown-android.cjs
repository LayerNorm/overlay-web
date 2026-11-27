/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const appRoot = path.resolve(__dirname, '..')
const outputRelative = path.join('dist', 'shared-markdown-dom-proof')
const outputPath = path.join(appRoot, outputRelative)

function runNodeScript(script, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: appRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function main() {
  const expoCli = path.join(appRoot, 'node_modules/expo/bin/cli')
  if (!fs.existsSync(expoCli)) throw new Error('Expo CLI is missing from the mobile workspace')

  runNodeScript('build-shared-markdown-css.cjs')
  const distRoot = path.join(appRoot, 'dist')
  if (path.dirname(outputPath) !== distRoot || path.basename(outputPath) !== 'shared-markdown-dom-proof') {
    throw new Error('Refusing to clear an unexpected export directory')
  }
  fs.rmSync(outputPath, { recursive: true, force: true })

  const env = { ...process.env, EXPO_NO_BUNDLE_SPLITTING: '1' }
  console.log('Exporting Android with the EAS-configured EXPO_NO_BUNDLE_SPLITTING=1 setting.')
  const result = spawnSync(process.execPath, [expoCli, 'export', '--platform', 'android', '--output-dir', outputRelative], {
    cwd: appRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)

  runNodeScript('verify-shared-markdown-assets.cjs', ['--export-dir', outputRelative])
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
