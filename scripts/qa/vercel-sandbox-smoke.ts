import assert from 'node:assert/strict'
import { VercelSandboxRuntime } from '@overlay/sandbox-runtime/vercel'

async function main() {
  const runtime = new VercelSandboxRuntime({ region: 'iad1' })
  const name = `overlay-vercel-smoke-${Date.now()}`

  const sandbox = await runtime.create({
    name,
    persistent: false,
    hardTimeoutMs: 45_000,
    idleTimeoutMs: 0,
    networkPolicy: { mode: 'deny_all' },
    resources: { vcpus: 2, memoryGiB: 4 },
    metadata: { 'overlay.operation': 'vercel-sandbox-smoke' },
  })

  let usage
  try {
    assert.equal(await sandbox.status(), 'running')
    const workingDirectory = await sandbox.workingDirectory()

    const command = await sandbox.runCommand({
      command: 'node',
      args: [
        '-e',
        "const fs=require('node:fs');fs.writeFileSync('smoke.txt','overlay-sandbox-ok');console.log('command-ok')",
      ],
      cwd: workingDirectory,
      timeoutMs: 10_000,
    })
    const result = await command.wait()
    assert.equal(result.exitCode, 0, result.stderr)
    assert.match(result.stdout, /command-ok/)

    const contents = await sandbox.readFile(`${workingDirectory}/smoke.txt`)
    assert(contents, 'Sandbox smoke file was not readable')
    assert.equal(Buffer.from(contents).toString('utf8'), 'overlay-sandbox-ok')

    const network = await sandbox.runCommand({
      command: 'node',
      args: [
        '-e',
        "fetch('https://example.com',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(9)).catch(()=>console.log('network-denied'))",
      ],
      timeoutMs: 8_000,
    })
    const networkResult = await network.wait()
    assert.equal(networkResult.exitCode, 0, networkResult.stderr)
    assert.match(networkResult.stdout, /network-denied/)
  } finally {
    await sandbox.stop()
    usage = await sandbox.usage()
  }

  assert.equal(typeof usage.wallTimeMs, 'number')
  assert.equal(typeof usage.activeCpuTimeMs, 'number')
  assert.equal(typeof usage.ingressBytes, 'number')
  assert.equal(typeof usage.egressBytes, 'number')

  console.log(JSON.stringify({
    ok: true,
    provider: runtime.provider,
    sandbox: name,
    networkPolicy: 'deny_all',
    stopped: true,
    usage,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
