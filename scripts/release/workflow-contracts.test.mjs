import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { parse } from 'yaml'

const workflow = name => parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))

test('every required workflow reports on merge groups; required PR checks have no paths filter', () => {
  for (const name of ['security', 'docs', 'gateway-contracts', 'codeql', 'semgrep', 'cla']) {
    const config = workflow(name)
    assert.deepEqual(config.on.merge_group.types, ['checks_requested'], name)
    assert.equal(config.on.pull_request?.paths, undefined, name)
  }
  const review = workflow('security').jobs['dependency-review']
  assert.match(review.if, /merge_group/)
  const action = review.steps.find(s => s.uses?.startsWith('actions/dependency-review-action@'))
  assert.match(action.with['base-ref'], /merge_group.base_sha/)
  assert.match(action.with['head-ref'], /merge_group.head_sha/)
})
test('preview management never checks out PR code, installs packages, or interpolates input into shell', () => {
  const config = workflow('pr-preview')
  for (const job of Object.values(config.jobs)) {
    assert.equal(job.environment, 'release-control')
    for (const step of job.steps) {
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.equal(step.with.ref, 'main')
        assert.equal(step.with['persist-credentials'], false)
        assert.match(step.uses, /@[a-f0-9]{40}$/)
      }
      if (step.run) {
        assert.ok(!step.run.includes('${{'))
        assert.ok(!/npm|npx|curl/.test(step.run))
      }
    }
  }
  assert.equal(config.jobs.preview.concurrency['cancel-in-progress'], false)
  assert.equal(config.jobs.reconcile.concurrency['cancel-in-progress'], false)
})

async function cla({ commits, signatures = [], baseRef = 'refs/heads/main', associated = [], prCommits = [] }) {
  const errors = []; const messages = []; const writes = []
  const source = workflow('cla').jobs.cla.steps[0].with.script
  const sandbox = {
    Buffer,
    context: { eventName: 'merge_group', repo: { owner: 'LayerNorm', repo: 'overlay-web' },
      payload: { merge_group: { base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), base_ref: baseRef } } },
    core: { setFailed: text => errors.push(text), info: text => messages.push(text) },
    github: {
      rest: {
        repos: {
          getContent: async () => ({ data: { content: Buffer.from(JSON.stringify({ signatures })).toString('base64') } }),
          compareCommitsWithBasehead: async () => ({ data: { status: 'ahead', commits } }),
          listPullRequestsAssociatedWithCommit: 'associated',
          createOrUpdateFileContents: async () => writes.push('registry'),
        },
        pulls: { listCommits: 'commits' },
        checks: { create: async () => writes.push('check') },
        issues: { createComment: async () => writes.push('comment') },
      },
      paginate: async kind => kind === 'associated' ? associated : prCommits,
    },
  }
  await vm.runInNewContext(`(async () => { ${source} })()`, sandbox, { timeout: 2000 })
  assert.deepEqual(writes, [], 'merge-group CLA verification must not create signatures or comments')
  return { errors, messages }
}
test('merge-group CLA accepts owner and current recorded signatures without changing the registry', async () => {
  const result = await cla({ commits: [
    { sha: 'c'.repeat(40), author: { login: 'DevelopedByDev' } },
    { sha: 'd'.repeat(40), author: { login: 'Contributor' } },
  ], signatures: [{ githubUser: 'Contributor', claVersion: '2026-08-28-draft' }] })
  assert.deepEqual(result.errors, [])
  assert.match(result.messages[0], /2 merge-group commits/)
})
test('merge-group CLA refuses missing or obsolete signatures and invalid provenance', async () => {
  const commits = [{ sha: 'c'.repeat(40), author: { login: 'Contributor' } }]
  assert.match((await cla({ commits })).errors[0], /Contributor/)
  assert.match((await cla({ commits, signatures: [{ githubUser: 'Contributor', claVersion: 'old' }] })).errors[0], /Contributor/)
  assert.match((await cla({ commits, baseRef: 'refs/heads/staging' })).errors[0], /provenance/)
  assert.match((await cla({ commits: [] })).errors[0], /no verifiable/)
})
test('unlinked commits require exact membership in an exempt-author PR', async () => {
  const commits = [{ sha: 'c'.repeat(40), author: null, committer: null }]
  const associated = [{ number: 123, base: { repo: { full_name: 'LayerNorm/overlay-web' } }, user: { login: 'DevelopedByDev' } }]
  assert.match((await cla({ commits, associated })).errors[0], /unidentified/)
  assert.deepEqual((await cla({ commits, associated, prCommits: commits })).errors, [])
})
