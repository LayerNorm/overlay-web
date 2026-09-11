import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatOverlayConfigError,
  getRedactedOverlayRuntimeConfigSummary,
  loadOverlayConfig,
} from '../src/server/config/loadOverlayConfig.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDir = path.join(root, 'tests/fixtures/config')

async function main() {
  let failed = false
  const entries = await readdir(fixturesDir, { withFileTypes: true })
  const fixtureFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(fixturesDir, entry.name))
    .sort()

  if (fixtureFiles.length === 0) {
    console.error('No config fixtures found in tests/fixtures/config')
    process.exit(1)
  }

  for (const fixtureFile of fixtureFiles) {
    try {
      const config = await loadOverlayConfig({
        configFilePath: fixtureFile,
        defaultConfig: {},
        env: {},
      })
      const summary = getRedactedOverlayRuntimeConfigSummary(config)
      const serialized = JSON.stringify(summary)
      if (/sk_live_|sk_test_|whsec_|ovl_sk_|internal_.*secret|api_key_hash/i.test(serialized)) {
        throw new Error('Redacted summary appears to contain a secret-looking value')
      }
      console.log(`OK ${path.relative(root, fixtureFile)} (${config.app.deploymentEnvironment})`)
    } catch (error) {
      failed = true
      const formatted = formatOverlayConfigError(error)
      console.error(`FAIL ${path.relative(root, fixtureFile)}: ${formatted.message}`)
      for (const issue of formatted.issues) {
        console.error(`  - ${issue}`)
      }
    }
  }

  if (failed) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
