import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import YAML from 'yaml'
import { ADAPTER_UPDATE_FILES, planAdapterUpdate } from './update-agent-adapters.mjs'

const root = new URL('../../', import.meta.url)
const files = Object.fromEntries(await Promise.all(ADAPTER_UPDATE_FILES.map(async path => [path, await readFile(new URL(path, root), 'utf8')])))
const image = JSON.parse(files['infra/agent-image/versions.json'])
const current = Object.fromEntries(Object.entries(image.packages).map(([name, version]) => [name.split('/')[1], version]))
const nextPatch = version => { const parts = version.split('.').map(Number); parts[2]++; return parts.join('.') }

test('an adapter update keeps every public host pin and image consistent', () => {
  const latest = { ...current, 'claude-agent-acp': nextPatch(current['claude-agent-acp']) }
  const plan = planAdapterUpdate(files, latest)
  const host = JSON.parse(plan.files['packages/overlay-agent-host/package.json'])
  const protocol = JSON.parse(plan.files['packages/overlay-agent-bridge-protocol/package.json'])
  const lock = JSON.parse(plan.files['package-lock.json'])
  assert.equal(host.version, nextPatch(JSON.parse(files['packages/overlay-agent-host/package.json']).version))
  assert.equal(host.version, protocol.version)
  assert.equal(host.dependencies['@layernorm/overlay-agent-bridge-protocol'], protocol.version)
  assert.equal(lock.packages['packages/overlay-agent-host'].dependencies['@layernorm/overlay-agent-bridge-protocol'], protocol.version)
  assert.equal(lock.packages['packages/overlay-agent-host'].version, host.version)
  assert.equal(lock.packages['packages/overlay-agent-bridge-protocol'].version, protocol.version)
  assert.deepEqual(lock.packages[''], JSON.parse(files['package-lock.json']).packages[''])
  for (const path of ['packages/overlay-agent-host/src/runtime.ts', 'packages/overlay-agent-host/src/enrollment.ts', 'packages/overlay-agent-host/src/cli.ts', 'src/server/agents/agent-enrollment-command.ts', 'src/features/settings/components/AgentEnvironmentSettings.tsx']) {
    assert.ok(plan.files[path].includes(host.version), `missing new pin in ${path}`)
  }
  const nextImage = JSON.parse(plan.files['infra/agent-image/versions.json'])
  assert.equal(nextImage.imageVersion, image.imageVersion + 1)
  assert.equal(nextImage.packages['@agentclientprotocol/claude-agent-acp'], latest['claude-agent-acp'])
  assert.equal(nextImage.packages['@agentclientprotocol/codex-acp'], current['codex-acp'])
  assert.ok(plan.files['packages/overlay-agent-host/src/image-check.ts'].includes(`max: ${nextImage.imageVersion}`))
  assert.match(plan.branch, /^codex\/agent-adapters-\d+\.\d+\.\d+-\d+\.\d+\.\d+$/)
  assert.equal(files['infra/agent-image/versions.json'], JSON.stringify(image, null, 2) + '\n')
})

test('current pins do nothing and malformed or downgraded registry versions fail closed', () => {
  assert.equal(planAdapterUpdate(files, current), null)
  assert.throws(() => planAdapterUpdate(files, { ...current, 'codex-acp': 'next; echo unsafe' }), /Invalid stable version/)
  assert.throws(() => planAdapterUpdate(files, { ...current, 'codex-acp': '0.0.0' }), /downgrade/)
  assert.throws(() => planAdapterUpdate(files, { ...current, 'claude-agent-acp': undefined }), /Invalid stable version/)
})

test('mismatched host and image pins cannot produce a partially updated release', () => {
  const changed = { ...files, 'packages/overlay-agent-host/src/adapter-manifests.ts': '' }
  assert.throws(() => planAdapterUpdate(changed, { ...current, 'claude-agent-acp': nextPatch(current['claude-agent-acp']) }), /pin mismatch/)
})

test('scheduled updates cannot open a PR before successful release conformance or force-push an existing branch', async () => {
  const workflow = YAML.parse(await readFile(new URL('.github/workflows/update-agent-adapters.yml', root), 'utf8'))
  assert.equal(workflow.on.schedule.length, 1)
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'))
  assert.match(workflow.jobs.update.if, /github.ref == 'refs\/heads\/main'/)
  const steps = workflow.jobs.update.steps
  const check = steps.findIndex(step => step.run === 'npm run check:byo-agents:release')
  const create = steps.findIndex(step => step.run?.includes('gh pr create'))
  assert.ok(check >= 0 && create > check)
  assert.equal(steps[check]['continue-on-error'], undefined)
  assert.equal(steps[create].if, steps[check].if)
  assert.match(steps[create].run, /git ls-remote --exit-code/)
  assert.match(steps[create].run, /--draft/)
  assert.doesNotMatch(steps[create].run, /--force|gh pr merge|npm publish/)
})
