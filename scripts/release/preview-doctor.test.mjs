import assert from 'node:assert/strict'
import test from 'node:test'
import { effectivePreviewEnvironment, capabilityConfiguration, diagnose } from './preview-doctor.mjs'
import { CONFIG } from './preview-control.mjs'

test('Preview configuration ignores Production and other branches and applies its own overrides', () => {
  const entry = (value, extra = {}) => ({ key: 'OVERLAY_FEATURE_BILLING', value, target: ['preview'], ...extra })
  const envs = [entry('false'), entry('true', { gitBranch: 'codex/test' }),
    entry('false', { gitBranch: 'codex/other' }), entry('false', { target: ['production'] })]
  assert.equal(effectivePreviewEnvironment(envs, 'codex/test').get('OVERLAY_FEATURE_BILLING').value, 'true')
  assert.throws(() => effectivePreviewEnvironment([entry('true'), entry('false')], 'codex/test'), /Ambiguous/)
})

test('capability reports expose missing names, never credential values', () => {
  const settings = effectivePreviewEnvironment([
    { key: 'COMPOSIO_API_KEY', value: 'must-not-appear', target: ['preview'] },
    { key: 'OVERLAY_FEATURE_INTEGRATIONS', value: 'true', target: ['preview'] },
    { key: 'OVERLAY_PROVIDER_INTEGRATIONS', value: 'composio', target: ['preview'] },
  ], 'codex/test')
  const report = capabilityConfiguration(settings)
  assert.equal(report[0].configuration, 'present; live test required')
  assert.ok(report.find(c => c.capability === 'billing').missing.includes('STRIPE_WEBHOOK_SECRET'))
  assert.ok(!JSON.stringify(report).includes('must-not-appear'))
})

test('diagnosis rejects incomplete inventories and reports stale deployed heads', async () => {
  const sha = 'a'.repeat(40)
  const read = (command, args) => {
    const path = args.join(' ')
    if (command === 'gh') return { number: 123, state: 'open', base: { ref: 'main', repo: { full_name: CONFIG.repository } },
      head: { sha, ref: 'codex/test', repo: { id: CONFIG.repositoryId, full_name: CONFIG.repository } } }
    if (path.includes('/aliases/')) return { projectId: CONFIG.projectId, deployment: { id: 'dpl_test' } }
    if (path.includes('/deployments/')) return { id: 'dpl_test', projectId: CONFIG.projectId, readyState: 'READY',
      gitSource: { type: 'github', repoId: CONFIG.repositoryId, ref: 'codex/test', sha: 'b'.repeat(40) } }
    return { envs: [], pagination: { next: 123 } }
  }
  await assert.rejects(diagnose(123, read), /inventory is incomplete/)
  const report = await diagnose(123, (command, args) => args.some(s => s.includes('/env?')) ? { envs: [] } : read(command, args))
  assert.equal(report.currentHeadReady, false)
})
