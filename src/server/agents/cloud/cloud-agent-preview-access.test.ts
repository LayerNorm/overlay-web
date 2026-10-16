import assert from 'node:assert/strict'
import test from 'node:test'
import type {SandboxInstance} from '@overlay/sandbox-runtime'
import {CLOUD_AGENT_PREVIEW_ACCESS_PATH, prepareCloudAgentPreviewAccess} from './cloud-agent-preview-access'

const env = {VERCEL_ENV: 'preview', OVERLAY_DEPLOYMENT_ENV: 'preview', NEXT_PUBLIC_APP_URL: 'https://pr-247.preview.getoverlay.io',
  VERCEL_GIT_PULL_REQUEST_ID: '247', VERCEL_AUTOMATION_BYPASS_SECRET: 'preview-only-test-secret'}

test('Preview bootstrap writes one private origin-bound file with the existing credential', async () => {
  const batches: Parameters<SandboxInstance['writeFiles']>[0][] = []
  const machine = {async writeFiles(files: Parameters<SandboxInstance['writeFiles']>[0]) {batches.push(files)}}
  assert.equal(await prepareCloudAgentPreviewAccess(machine, env.NEXT_PUBLIC_APP_URL, env), CLOUD_AGENT_PREVIEW_ACCESS_PATH)
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 1)
  const file = batches[0][0]
  assert.equal(file.path, CLOUD_AGENT_PREVIEW_ACCESS_PATH)
  assert.equal(file.mode, 0o600)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(file.contents)), {origin: env.NEXT_PUBLIC_APP_URL, secret: env.VERCEL_AUTOMATION_BYPASS_SECRET})
})

test('Production, malformed Preview scope and missing credentials never deliver hosting access', async () => {
  let writes = 0
  const machine = {async writeFiles() {writes++}}
  assert.equal(await prepareCloudAgentPreviewAccess(machine, undefined, {...env, VERCEL_ENV: 'production', OVERLAY_DEPLOYMENT_ENV: 'production'}), undefined)
  await assert.rejects(prepareCloudAgentPreviewAccess(machine, 'https://foreign.example.test', env), /does not match/)
  await assert.rejects(prepareCloudAgentPreviewAccess(machine, undefined, {...env, VERCEL_GIT_PULL_REQUEST_ID: '248'}), /provisioned HTTPS origin/)
  await assert.rejects(prepareCloudAgentPreviewAccess(machine, undefined, {...env, VERCEL_AUTOMATION_BYPASS_SECRET: ''}), /not configured/)
  assert.equal(writes, 0)
})

test('provider write errors cannot disclose the hosting credential', async () => {
  const machine = {async writeFiles() {throw Error(`Provider request failed: ${env.VERCEL_AUTOMATION_BYPASS_SECRET}`)}}
  await assert.rejects(prepareCloudAgentPreviewAccess(machine, undefined, env), error => error instanceof Error
    && error.message === 'Preview machine access could not be prepared' && !error.message.includes(env.VERCEL_AUTOMATION_BYPASS_SECRET))
})
