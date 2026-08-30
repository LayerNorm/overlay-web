import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyHermesAcpReadiness } from './hermes-readiness'

test('Hermes readiness accepts the official ACP sentinel', async () => {
  await verifyHermesAcpReadiness(async () => ({ stdout: 'Hermes ACP check OK\n' }))
})

test('Hermes readiness fails with a setup path when ACP is missing or stale', async () => {
  await assert.rejects(
    verifyHermesAcpReadiness(async () => { throw new Error('command not found') }),
    /Install Hermes Agent 0\.20\.6 or newer.*hermes acp --setup.*hermes acp --check/,
  )
})
