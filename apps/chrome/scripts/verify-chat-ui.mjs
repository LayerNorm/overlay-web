#!/usr/bin/env node
/**
 * CI guard: re-run the sync in --check mode. Fails when:
 *   - A synced file in @overlay/chat-ui differs from the transformed landing source.
 *   - The sync-manifest.json is stale.
 *   - A tracked (locally-forked) landing file has drifted since last sync
 *     without the manifest being refreshed.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const result = spawnSync(process.execPath, [resolve(__dirname, 'sync-chat-ui.mjs'), '--check'], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)
