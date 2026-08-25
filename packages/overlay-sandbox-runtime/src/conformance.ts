import { strict as assert } from 'node:assert'
import { posix as path } from 'node:path'
import type { SandboxCreateRequest, SandboxRuntime } from './contracts'
import { enforceSandboxIdleStop } from './lifecycle'

export type SandboxConformanceResult = {
  provider: string
  checks: string[]
}

/** Shared black-box suite. It is used by deterministic adapter tests and opt-in live provider tests. */
export async function runSandboxConformance(
  runtime: SandboxRuntime,
  request: SandboxCreateRequest,
  options: { verifyNetworkEnforcement?: boolean } = {},
): Promise<SandboxConformanceResult> {
  const checks: string[] = []
  const sandbox = await runtime.create(request)
  let restored: Awaited<ReturnType<SandboxRuntime['restore']>> | null = null
  let snapshotId: string | undefined
  let sandboxDeleted = false
  try {
  assert.equal(sandbox.provider, runtime.provider)
  assert.equal(await sandbox.status(), 'running')
  checks.push('provision')

  const workingDirectory = await sandbox.workingDirectory()
  const conformanceFile = path.join(workingDirectory, 'conformance.txt')
  await sandbox.writeFiles([{ path: conformanceFile, contents: Buffer.from('overlay') }])
  assert.equal(Buffer.from((await sandbox.readFile(conformanceFile)) ?? []).toString(), 'overlay')
  assert.ok((await sandbox.listFiles(workingDirectory)).some((entry) => entry.path.endsWith('conformance.txt')))
  checks.push('files')

  await sandbox.updateEnvironment({ OVERLAY_CONFORMANCE: 'true' })
  const environmentCommand = await sandbox.runCommand({
    command: '/bin/sh',
    args: ['-lc', 'printf "$OVERLAY_CONFORMANCE"'],
    timeoutMs: 10_000,
  })
  assert.match((await environmentCommand.wait()).stdout, /true/)
  checks.push('environment')

  const command = await sandbox.runCommand({ command: 'printf', args: ['overlay-stream'], timeoutMs: 10_000 })
  let streamed = ''
  const consume = (async () => {
    for await (const event of command.events()) streamed += event.data
  })()
  const result = await command.wait()
  await consume
  assert.equal(result.exitCode, 0)
  assert.match(`${streamed}${result.stdout}`, /overlay-stream/)
  checks.push('command-streaming')

  const cancellable = await sandbox.runCommand({ command: 'sleep', args: ['30'], timeoutMs: 30_000 })
  await cancellable.cancel()
  assert.notEqual((await cancellable.wait()).exitCode, 0)
  checks.push('cancellation')

  if (options.verifyNetworkEnforcement && request.networkPolicy.mode !== 'allow_all') {
    const deniedCommand = await sandbox.runCommand({
      command: '/bin/sh',
      args: ['-lc', 'curl --fail --silent --show-error --max-time 5 https://example.com >/dev/null'],
      timeoutMs: 10_000,
    })
    assert.notEqual((await deniedCommand.wait()).exitCode, 0)
    checks.push('network-policy-enforced')
  }

  if (sandbox.capabilities.ports) {
    assert.match((await sandbox.port(request.ports?.[0] ?? 3000)).url, /^https?:\/\//)
    checks.push('ports')
  }
  if (sandbox.capabilities.usage) {
    assert.ok(await sandbox.usage())
    checks.push('usage')
  }

  assert.equal(await enforceSandboxIdleStop({
    sandbox,
    lastActivityAt: 1,
    idleTimeoutMs: 1,
    now: 3,
  }), true)
  assert.equal(await sandbox.status(), 'stopped')
  await sandbox.resume()
  assert.equal(await sandbox.status(), 'running')
  const reconnected = await runtime.reconnect(sandbox.reference)
  assert.equal(reconnected.reference, sandbox.reference)
  checks.push('idle-stop-and-reconnect')

  if (sandbox.capabilities.snapshots) {
    // Vercel snapshots require either no expiry or a minimum lifetime of one day.
    // Use the portable provider minimum so the same black-box suite remains live-safe.
    snapshotId = (await sandbox.snapshot({ expiresInMs: 24 * 60 * 60_000 })).id
    assert.ok(snapshotId)
    checks.push('snapshot')
  }

  if (snapshotId) {
    restored = await runtime.restore(snapshotId, { ...request, name: `${request.name}-restored` })
    assert.equal(await restored.status(), 'running')
    await restored.delete()
    restored = null
    // Vercel stops a persistent sandbox while snapshotting and needs the snapshot
    // to resume it. Resume before deleting the snapshot used by the original.
    await sandbox.resume()
    assert.equal(await sandbox.status(), 'running')
    await runtime.deleteSnapshot(snapshotId)
    snapshotId = undefined
    checks.push('restore')
  }

  // Runtime policy changes are monotonic. Some provider/account tiers correctly refuse
  // broadening a sandbox again after it has been locked down.
  if (sandbox.capabilities.networkPolicyUpdates) {
    await sandbox.updateNetworkPolicy({ mode: 'deny_all' })
    checks.push('network-policy-lockdown')
  } else {
    checks.push('network-policy-immutable')
  }

  await sandbox.delete()
  sandboxDeleted = true
  assert.equal(await sandbox.status(), 'deleted')
  checks.push('cleanup')
  return { provider: runtime.provider, checks }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Sandbox conformance failed after: ${checks.join(', ') || 'create'}; ${detail}`, { cause: error })
  } finally {
    if (restored) await restored.delete().catch((error) => { void error })
    if (snapshotId) await runtime.deleteSnapshot(snapshotId).catch((error) => { void error })
    if (!sandboxDeleted) await sandbox.delete().catch((error) => { void error })
  }
}
