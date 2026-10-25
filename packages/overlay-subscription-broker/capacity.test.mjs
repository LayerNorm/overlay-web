import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.OVERLAY_SUBSCRIPTION_MAX_WORKERS = '1'
const { createBrokerServer } = await import('./server.mjs')

test('all providers share one capacity reservation, including concurrent worker startup', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'overlay-subscription-capacity-'))
  const binary = path.join(root, 'fake-cli.mjs')
  await writeFile(binary, `#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
const config = JSON.parse(await readFile(process.argv[process.argv.indexOf('--config') + 1], 'utf8'))
createServer((request, response) => {
  response.setHeader('content-type', 'application/json')
  response.end(request.url === '/healthz' ? '{}' : JSON.stringify({ url: 'https://accounts.x.ai/authorize', state: 'qa' }))
}).listen(config.port, '127.0.0.1')
`)
  await chmod(binary, 0o700)
  Object.assign(process.env, {
    OVERLAY_SUBSCRIPTION_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    OVERLAY_SUBSCRIPTION_RUNTIME_DIR: path.join(root, 'runtime'),
    OVERLAY_SUBSCRIPTION_STATE_DIR: path.join(root, 'state'),
    OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS: 'codex,xai',
    CLIPROXYAPI_BIN: binary,
  })
  const serviceKey = 'capacity-test-key'.repeat(4)
  const server = await createBrokerServer({ host: '127.0.0.1', port: 0, serviceKey })
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(async () => { await server.shutdown(); await rm(root, { recursive: true, force: true }) })
  const post = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/subscriptions/${route}`, {
      method: 'POST', headers: { authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ownerId: 'owner', ...body }),
    })
    await response.text()
    return response.status
  }
  const codex = { connectionId: 'pending', providerId: 'codex', deviceAuthId: 'device', userCode: 'CODE', expiresAt: Date.now() + 60_000, interval: 5 }
  assert.equal(await post('start-codex', codex), 200)
  assert.equal(await post('start', { connectionId: 'other', providerId: 'xai' }), 503, 'pending Codex consumes a worker reservation')
  assert.equal(await post('start-codex', codex), 200, 'restarting the same connection reuses its reservation')
  assert.equal(await post('disconnect', { connectionId: 'pending', providerId: 'codex' }), 200)
  const concurrent = await Promise.all(['first', 'second'].map((connectionId) => post('start', { connectionId, providerId: 'xai' })))
  assert.deepEqual(concurrent.sort(), [200, 503], 'concurrent worker starts cannot overbook capacity')
})
