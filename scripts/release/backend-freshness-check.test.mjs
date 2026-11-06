import assert from 'node:assert/strict'
import test from 'node:test'
import { CONFIG } from './preview-control.mjs'
import { runBackendFreshness } from './backend-freshness-check.mjs'

const repoPath = `/repos/${CONFIG.repository}`
const sha = letter => letter.repeat(40)

function pull(number, { headSha = sha('a'), headRepo = CONFIG.repository, headRepoId = CONFIG.repositoryId,
  state = 'open', baseRef = 'main' } = {}) {
  return {
    number,
    state,
    base: { ref: baseRef, repo: { full_name: CONFIG.repository, id: CONFIG.repositoryId } },
    head: { sha: headSha, repo: { full_name: headRepo, id: headRepoId } },
  }
}

function fixture({ pulls = [], compare, compareError = false, pullReads = {}, mainShas = [sha('b')] } = {}) {
  const calls = []
  const statuses = []
  const reads = new Map()
  let mainReads = 0
  const api = async (path, options = {}) => {
    calls.push({ path, ...options })
    if (path === `${repoPath}/commits/main`) return { sha: mainShas[Math.min(mainReads++, mainShas.length - 1)] }
    if (path.startsWith(`${repoPath}/compare/`)) {
      if (compareError) throw new Error('private compare response')
      const [, revision] = path.match(/\/compare\/([^/]+)\.\.\.([^/]+)$/) ?? []
      return typeof compare === 'function' ? compare(revision, path) : compare ?? {
        base_commit: { sha: revision },
        merge_base_commit: { sha: sha('b') },
      }
    }
    if (path === `${repoPath}/pulls`) {
      const page = options.query?.page ?? 1
      const start = (page - 1) * 100
      return pulls.slice(start, start + 100)
    }
    const pullMatch = path.match(new RegExp(`^${repoPath}/pulls/(\\d+)$`))
    if (pullMatch) {
      const number = Number(pullMatch[1])
      const sequence = pullReads[number] ?? pulls.filter(item => item.number === number)
      if (!sequence.length) {
        const error = new Error('not found')
        error.status = 404
        throw error
      }
      const read = reads.get(number) ?? 0
      reads.set(number, read + 1)
      return Array.isArray(sequence) ? sequence[Math.min(read, sequence.length - 1)] : sequence
    }
    const statusMatch = path.match(new RegExp(`^${repoPath}/commits/([a-f0-9]{40})/status$`))
    if (statusMatch) {
      const latest = new Map()
      for (const status of statuses) {
        if (status.sha === statusMatch[1]) latest.set(status.context, status)
      }
      return { statuses: [...latest.values()] }
    }
    if (path.startsWith(`${repoPath}/statuses/`) && options.method === 'POST') {
      statuses.push({ sha: path.slice(`${repoPath}/statuses/`.length), ...options.body })
      return {}
    }
    throw new Error(`Unexpected request: ${path}`)
  }
  return { api, calls, statuses }
}

function context(eventName, payload, { ref = 'refs/heads/main' } = {}) {
  return { eventName, payload: { repository: { full_name: CONFIG.repository }, ...payload },
    repository: CONFIG.repository, ref }
}

test('sweeps every page of open main PRs with 100-item pagination', async () => {
  const pulls = Array.from({ length: 101 }, (_, index) => pull(index + 1, { headSha: (index + 1).toString(16).padStart(40, '0') }))
  const f = fixture({ pulls })
  const result = await runBackendFreshness({ api: f.api, ...context('push', {}, { ref: 'refs/heads/main' }) })
  assert.equal(result.assessed, 101)
  assert.deepEqual(result.errors, [])
  const pages = f.calls.filter(call => call.path === `${repoPath}/pulls`)
  assert.deepEqual(pages.map(call => call.query), [
    { state: 'open', base: 'main', per_page: 100, page: 1 },
    { state: 'open', base: 'main', per_page: 100, page: 2 },
  ])
  assert.equal(f.statuses.filter(status => status.context === 'Backend Freshness' && status.state === 'success').length, 101)
  const pending = f.calls.findIndex(call => call.body?.context === 'Backend Freshness' && call.body.state === 'pending')
  const comparison = f.calls.findIndex(call => call.path.startsWith(`${repoPath}/compare/`))
  const success = f.calls.findIndex(call => call.body?.context === 'Backend Freshness' && call.body.state === 'success')
  assert.ok(pending >= 0 && pending < comparison && comparison < success)
  assert.equal(f.statuses.some(status => status.context === 'PR Preview' && status.state === 'success'), false)
})

test('continues refreshing later PRs after an individual comparison failure', async () => {
  const pulls = [pull(1), pull(2, { headSha: sha('c') })]
  const f = fixture({ pulls, compare: headSha => {
    if (headSha === sha('a')) throw new Error('private compare failure')
    return { base_commit: { sha: headSha }, merge_base_commit: { sha: sha('b') } }
  } })
  const result = await runBackendFreshness({ api: f.api, ...context('schedule', {}, { ref: 'refs/heads/main' }) })
  assert.equal(result.assessed, 2)
  assert.ok(result.errors.some(error => error.includes('PR #1')))
  assert.ok(f.statuses.some(status => status.sha === sha('c') && status.context === 'Backend Freshness' && status.state === 'success'))
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.context === 'Backend Freshness' && status.state === 'error'))
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.context === 'PR Preview' && status.state === 'failure'))
})

test('stale internal PRs fail Backend Freshness and invalidate an old PR Preview success', async () => {
  const staleCompare = headSha => ({
    base_commit: { sha: headSha },
    merge_base_commit: { sha: sha('c') },
    files: [{ filename: 'convex/schema.ts' }],
  })
  const f = fixture({ pulls: [pull(7)], compare: headSha => staleCompare(headSha) })
  const result = await runBackendFreshness({ api: f.api, ...context('push', {}, { ref: 'refs/heads/main' }) })
  assert.equal(result.errors.length, 1)
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.context === 'PR Preview' && status.state === 'failure'))
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.context === 'Backend Freshness' && status.state === 'failure'))
})

test('a PR-head race finishes only the originally assessed SHA', async () => {
  const f = fixture({ pulls: [pull(9)], pullReads: { 9: [pull(9), pull(9, { headSha: sha('d') })] } })
  const result = await runBackendFreshness({
    api: f.api,
    ...context('pull_request_target', { pull_request: { number: 9, head: { sha: sha('z') } } }),
  })
  assert.ok(result.errors.some(error => error.includes('changed during')))
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.state === 'pending'))
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.state === 'error'))
  assert.equal(f.statuses.some(status => status.sha === sha('d')), false)
  assert.equal(f.statuses.some(status => status.sha === sha('z')), false)
})

test('merge groups assess only their exact merge SHA, independently of PR sweeps', async () => {
  const groupSha = sha('e')
  const f = fixture({ pulls: [pull(3)] })
  const result = await runBackendFreshness({
    api: f.api,
    ...context('merge_group', { merge_group: { base_ref: 'refs/heads/main', head_sha: groupSha } },
      { ref: 'refs/heads/gh-readonly-queue/main' }),
  })
  assert.equal(result.assessed, 1)
  assert.ok(f.statuses.some(status => status.sha === groupSha && status.context === 'Backend Freshness' && status.state === 'pending'))
  assert.ok(f.statuses.some(status => status.sha === groupSha && status.context === 'Backend Freshness' && status.state === 'success'))
  assert.equal(f.calls.some(call => call.path === `${repoPath}/pulls`), false)
  assert.equal(f.statuses.some(status => status.sha === sha('a')), false)
})

test('fork and Dependabot PRs are assessed; unavailable fork comparisons fail visibly', async () => {
  const fork = pull(5, { headRepo: 'contributor/overlay-web', headRepoId: 99 })
  const bot = { ...pull(6, { headSha: sha('f') }), user: { login: 'dependabot[bot]' } }
  const f = fixture({ pulls: [fork, bot], compare: headSha => {
    if (headSha === sha('a')) throw new Error('fork comparison unavailable')
    return { base_commit: { sha: headSha }, merge_base_commit: { sha: sha('b') } }
  } })
  const result = await runBackendFreshness({
    api: f.api,
    ...context('pull_request_target', {
      sender: { login: 'dependabot[bot]' },
      pull_request: { number: 6, head: { sha: sha('z') } },
    }),
  })
  assert.equal(result.assessed, 2)
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.context === 'Backend Freshness' && status.state === 'error'))
  assert.equal(f.statuses.some(status => status.sha === sha('a') && status.context === 'PR Preview'), false)
  assert.ok(f.statuses.some(status => status.sha === sha('f') && status.context === 'Backend Freshness' && status.state === 'success'))
  assert.equal(f.statuses.some(status => status.sha === sha('z')), false)
  assert.ok(result.errors.some(error => error.includes('PR #5')))
})

test('closed or retargeted event PRs stop while other open main PRs are still swept', async () => {
  const closed = pull(10, { state: 'closed' })
  const other = pull(11, { headSha: sha('d') })
  const f = fixture({ pulls: [other], pullReads: { 10: [closed] } })
  const result = await runBackendFreshness({
    api: f.api,
    ...context('pull_request_target', { pull_request: { number: 10 } }),
  })
  assert.equal(result.assessed, 1)
  assert.equal(f.statuses.some(status => status.sha === sha('a')), false)
  assert.ok(f.statuses.some(status => status.sha === sha('d') && status.state === 'success'))
})

test('repository and event identity are validated', async () => {
  const f = fixture()
  await assert.rejects(runBackendFreshness({
    api: f.api, ...context('push', {}, { ref: 'refs/heads/feature' }),
  }), /must run from main/)
  await assert.rejects(runBackendFreshness({
    api: f.api, ...context('merge_group', { merge_group: { base_ref: 'refs/heads/dev', head_sha: sha('e') } }),
  }), /Invalid main merge-group/)
  await assert.rejects(runBackendFreshness({
    api: f.api, ...context('push', { repository: { full_name: 'fork/repo' } }, { ref: 'refs/heads/main' }),
  }), /Unexpected workflow repository/)
})

test('a main move after comparison cannot publish a success status', async () => {
  const f = fixture({ pulls: [pull(12)], mainShas: [sha('b'), sha('b'), sha('c')] })
  const result = await runBackendFreshness({
    api: f.api,
    ...context('push', {}, { ref: 'refs/heads/main' }),
  })
  assert.equal(result.errors.length, 1)
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.context === 'Backend Freshness' && status.state === 'error'))
  assert.ok(!f.statuses.some(status => status.sha === sha('a') && status.context === 'Backend Freshness' && status.state === 'success'))
  assert.ok(f.statuses.some(status => status.sha === sha('a') && status.context === 'PR Preview' && status.state === 'failure'))
})

test('repeated sweeps reuse unchanged statuses but still invalidate newly stale backends', async () => {
  let stale = false
  const f = fixture({ pulls: [pull(13)], compare: head => ({
    base_commit: { sha: head },
    merge_base_commit: { sha: stale ? sha('c') : sha('b') },
    files: stale ? [{ filename: 'convex/schema.ts' }] : [],
  }) })
  const run = () => runBackendFreshness({ api: f.api, ...context('schedule', {}) })
  await run()
  const initialWrites = f.statuses.length
  assert.equal(initialWrites, 2)
  await run()
  assert.equal(f.statuses.length, initialWrites)
  stale = true
  await run()
  assert.deepEqual(f.statuses.slice(initialWrites).map(({ context, state }) => ({ context, state })), [
    { context: 'PR Preview', state: 'failure' },
    { context: 'Backend Freshness', state: 'failure' },
  ])
  await run()
  assert.equal(f.statuses.length, initialWrites + 2)
})
