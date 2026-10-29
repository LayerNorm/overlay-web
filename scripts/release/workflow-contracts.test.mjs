import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import test from 'node:test'
import { parse } from 'yaml'

const workflow = name => parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))

test('CodeQL initialization, analysis and SARIF upload share one pinned version', () => {
  const uses = ['codeql', 'semgrep'].flatMap(name => Object.values(workflow(name).jobs)
    .flatMap(job => job.steps ?? []).map(step => step.uses)
    .filter(use => use?.startsWith('github/codeql-action/')))
  assert.equal(uses.length, 3)
  assert.deepEqual(new Set(uses.map(use => use.split('@')[0])), new Set([
    'github/codeql-action/init', 'github/codeql-action/analyze', 'github/codeql-action/upload-sarif',
  ]))
  const pins = uses.map(use => use.split('@')[1])
  assert.ok(pins.every(pin => /^[a-f0-9]{40}$/.test(pin)))
  assert.equal(new Set(pins).size, 1, 'mixed action versions cannot share CodeQL configuration')
  const dependabot = parse(readFileSync(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8'))
  const actions = dependabot.updates.find(update => update['package-ecosystem'] === 'github-actions')
  assert.deepEqual(actions.groups['codeql-actions'].patterns, ['github/codeql-action*'])
})

test('Git automatically deploys only main; preview label changes trigger trusted reconciliation', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
  assert.deepEqual(config.git.deploymentEnabled, { '*': false, main: true })
  const events = workflow('pr-preview-request').on.pull_request.types
  for (const event of ['labeled', 'unlabeled', 'synchronize', 'closed']) assert.ok(events.includes(event))
})

test('preview credentials stay in a main-only controller without privileged PR triggers', () => {
  const controller = workflow('pr-preview')
  assert.deepEqual(Object.keys(controller.on).sort(), ['schedule', 'workflow_dispatch'])
  for (const job of Object.values(controller.jobs)) {
    assert.match(job.if, /github\.ref == 'refs\/heads\/main'/)
  }
  const request = workflow('pr-preview-request')
  assert.deepEqual(Object.keys(request.on), ['pull_request'])
  assert.deepEqual(request.permissions, {})
  assert.deepEqual(request.jobs.request.permissions, { actions: 'write' })
  assert.match(request.jobs.request.if, /head\.repo\.full_name == github\.repository/)
  assert.match(request.jobs.request.if, /github\.actor != 'dependabot\[bot\]'/)
  assert.equal(request.jobs.request.environment, undefined)
  assert.equal(request.jobs.request.steps.length, 1)
  assert.match(request.jobs.request.steps[0].uses, /^actions\/github-script@[a-f0-9]{40}$/)
  assert.ok(!JSON.stringify(request).includes('secrets.'))
})

test('preview requests dispatch only main with a validated PR number, never PR source or inputs', async () => {
  const source = workflow('pr-preview-request').jobs.request.steps[0].with.script
  const repository = 'LayerNorm/overlay-web'
  const pull = { number: 123, head: { repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } } }
  const run = async payload => {
    const calls = []; const errors = []
    await vm.runInNewContext(`(async () => { ${source} })()`, {
      context: { repo: { owner: 'LayerNorm', repo: 'overlay-web' }, payload: { pull_request: payload } },
      core: { setFailed: message => errors.push(message) },
      github: { rest: { actions: { createWorkflowDispatch: async args => calls.push(JSON.parse(JSON.stringify(args))) } } },
    }, { timeout: 2000 })
    return { calls, errors }
  }
  assert.deepEqual(await run(pull), { calls: [{ owner: 'LayerNorm', repo: 'overlay-web',
    workflow_id: 'pr-preview.yml', ref: 'main', inputs: { pr_number: '123' } }], errors: [] })
  for (const invalid of [undefined, { ...pull, number: '123; echo bad' }, { ...pull, number: -1 },
    { ...pull, head: { repo: { full_name: 'outsider/fork' } } },
    { ...pull, base: { ...pull.base, ref: 'other' } }]) {
    const result = await run(invalid)
    assert.deepEqual(result.calls, [])
    assert.deepEqual(result.errors, ['Invalid internal main PR.'])
  }
})

test('new PR revisions cancel obsolete checks without canceling main releases or merge groups', () => {
  for (const name of ['security', 'docs', 'codeql', 'semgrep']) {
    const config = workflow(name)
    assert.equal(config.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}")
    assert.match(config.concurrency.group, /github\.workflow/)
    assert.match(config.concurrency.group, /github\.event_name/)
    assert.match(config.concurrency.group, /github\.event\.pull_request\.number \|\| github\.ref/)
  }
  // Deployment controllers must settle remote builds before releasing their locks.
  assert.equal(workflow('pr-preview').jobs.preview.concurrency['cancel-in-progress'], false)
})

test('every required workflow reports on merge groups; required PR checks have no paths filter', () => {
  for (const name of ['security', 'docs', 'codeql', 'semgrep', 'cla']) {
    const config = workflow(name)
    assert.deepEqual(config.on.merge_group.types, ['checks_requested'], name)
    assert.equal(config.on.pull_request?.paths, undefined, name)
  }
  const review = workflow('security').jobs['dependency-review']
  assert.match(review.if, /merge_group/)
  const action = review.steps.find(s => s.uses?.startsWith('actions/dependency-review-action@'))
  assert.match(action.with['base-ref'], /merge_group.base_sha/)
  assert.match(action.with['head-ref'], /merge_group.head_sha/)
  assert.equal(action.if, undefined, 'dependency comparison must run rather than trust an absent repository field')
  assert.equal(review.steps.some(s => /Skip dependency review/.test(s.name ?? '')), false)
})

test('unrelated deployment events cannot overwrite required contract checks with skipped results', () => {
  assert.equal(workflow('security').on.deployment_status, undefined)
  assert.equal(workflow('security').jobs.contracts.if, '${{ always() }}')
  assert.equal(workflow('security').jobs.contracts.needs, 'tests')
  const canary = workflow('paid-gateway-canary')
  assert.ok(Object.hasOwn(canary.on, 'deployment_status'))
  assert.match(canary.jobs['paid-gateway-canary'].if, /overlay-landing/)
  const checkout = canary.jobs['paid-gateway-canary'].steps.find(s => s.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with.ref, 'main', 'canary credentials must never execute a deployment-supplied unreviewed SHA')
  assert.equal(checkout.with['persist-credentials'], false)
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
        assert.equal(step.env.CONVEX_PREVIEW_CONTROL_KEY, '${{ secrets.CONVEX_PREVIEW_CONTROL_KEY }}')
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


test('quality aggregation fails closed for every failed, cancelled, missing or skipped lane', () => {
  const gate = workflow('security').jobs['dependency-audit']
  assert.equal(gate.if, '${{ always() }}')
  const run = (needs, event = 'pull_request') => spawnSync('bash', ['-c', gate.steps[0].run], {
    env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), EVENT_NAME: event }, encoding: 'utf8',
  }).status
  const green = Object.fromEntries(gate.needs.map(name => [name, { result: 'success' }]))
  assert.equal(run(green), 0)
  assert.equal(run(green, 'merge_group'), 0)
  for (const name of gate.needs) {
    for (const result of ['failure', 'cancelled', 'skipped', '']) {
      assert.notEqual(run({ ...green, [name]: { result } }), 0, `${name}: ${result}`)
    }
    const missing = { ...green }; delete missing[name]
    assert.notEqual(run(missing), 0, `missing ${name}`)
  }
  const push = { ...green, 'dependency-review': { result: 'skipped' } }
  assert.equal(run(push, 'push'), 0)
  assert.notEqual(run(push, 'merge_group'), 0)
})

test('parallel lanes preserve complete test discovery, runtime-specific contracts and generated route checks', () => {
  const { jobs } = workflow('security')
  assert.deepEqual(jobs.tests.strategy.matrix.shard, [1, 2])
  assert.equal(jobs.tests.strategy['fail-fast'], false)
  assert.ok(jobs.tests.steps.some(s => s.run === 'node scripts/ci/run-all-tests.mjs --verify-shards 2'))
  assert.ok(jobs.tests.steps.some(s => s.run === 'node scripts/ci/run-all-tests.mjs --shard ${{ matrix.shard }}/2'))
  assert.ok(!jobs.tests.steps.some(s => /test:(gateway-contracts|route-characterization)/.test(s.run ?? '')), 'contracts run once through discovery')
  const build = jobs.build.steps.map(s => s.run)
  assert.ok(build.includes('npm run build'))
  assert.ok(build.indexOf('npm run build') < build.indexOf('npm run check:on-prem-convex-boundaries'))
  assert.equal(jobs.build.env.OVERLAY_SKIP_BUILD_TYPECHECK, '1')
  const types = jobs.typecheck.steps.map(s => s.run)
  assert.ok(types.includes('npx next typegen'))
  assert.ok(types.indexOf('npx next typegen') < types.indexOf('npm run typecheck'))
  assert.ok(jobs.static.steps.some(s => s.run === 'npm run security:audit'))
  assert.equal(jobs.static.needs, undefined, 'lint runs independently of typechecking')
  assert.equal(jobs.typecheck.needs, undefined, 'typechecking runs independently of lint')
  assert.ok(jobs['dependency-audit'].needs.includes('typecheck'))
  assert.ok(jobs.build.steps.some(s => s.run === 'npm run check:config && npm run test:release-safety'))
  assert.equal(workflow('docs').on.push.paths, undefined, 'docs health must still run for every main push')
})

test('dependency caches require exact install inputs and misses retain locked script-free installation', () => {
  const action = parse(readFileSync(new URL('../../.github/actions/ci-dependencies/action.yml', import.meta.url), 'utf8'))
  const cache = action.runs.steps.find(step => step.id === 'dependencies')
  assert.equal(cache.with['restore-keys'], undefined, 'never restore a different dependency tree')
  for (const input of ['runner.os', 'runner.arch', 'inputs.node-version', 'package-lock.json', 'package.json', '.npmrc']) {
    assert.ok(cache.with.key.includes(input), input)
  }
  const install = action.runs.steps.find(step => step.name === 'Install from lockfile')
  assert.equal(install.if, "steps.dependencies.outputs.cache-hit != 'true'")
  assert.equal(install.run, 'npm ci --ignore-scripts --no-audit --no-fund')
  const { jobs } = workflow('security')
  for (const name of ['static', 'typecheck', 'build', 'tests']) {
    assert.ok(jobs[name].steps.some(step => step.uses === './.github/actions/ci-dependencies'))
  }
  const buildCache = jobs.build.steps.find(step => step.name === 'Restore Next.js compiler cache')
  assert.equal(buildCache.with.path, '.next/cache', 'cache compiler state, never deploy artifacts or env files')
  const lint = jobs.static.steps.find(step => step.name === 'Lint')
  assert.match(lint.run, /--cache-strategy content/)
})

test('scanner findings stay blocking and publish diagnostics; dependency updates retain their cooldown', () => {
  const steps = workflow('semgrep').jobs.semgrep.steps
  const scan = steps.find(step => step.name === 'Run Semgrep')
  assert.match(scan.run, /--error/)
  assert.match(scan.run, /--sarif-output semgrep\.sarif/)
  assert.equal(scan['continue-on-error'], undefined)
  const upload = steps.find(step => step.name === 'Upload Semgrep results')
  assert.match(upload.if, /!cancelled\(\)/)
  assert.match(upload.if, /hashFiles\('semgrep\.sarif'\)/)
  const dependabot = parse(readFileSync(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8'))
  for (const update of dependabot.updates) assert.equal(update.cooldown['default-days'], 7)
})
