import assert from 'node:assert/strict'
import test from 'node:test'
import { checkBackendFreshness } from './backend-freshness.mjs'

const sha = letter => letter.repeat(40)
const repoPath = '/repos/LayerNorm/overlay-web'

function fixture({ mainShas = [sha('b')], compare, compareError } = {}) {
  const calls = []
  let mainReads = 0
  const api = async (path, options = {}) => {
    calls.push({ path, ...options })
    if (path === `${repoPath}/commits/main`) {
      const selected = mainShas[Math.min(mainReads, mainShas.length - 1)]
      mainReads++
      return { sha: selected }
    }
    if (path.startsWith(`${repoPath}/compare/`)) {
      if (compareError) throw new Error('private API response body')
      return typeof compare === 'function' ? compare(path, options) : compare
    }
    throw new Error(`Unexpected request: ${path}`)
  }
  return { api, calls, mainReads: () => mainReads }
}

const compareResult = ({ head = sha('a'), mergeBase = sha('c'), files = [] } = {}) => ({
  base_commit: { sha: head },
  merge_base_commit: { sha: mergeBase },
  files,
})

test('main already included is current without requiring file metadata', async () => {
  const f = fixture({ compare: compareResult({ mergeBase: sha('b') }) })
  const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
  assert.equal(result.state, 'current')
  assert.equal(result.reason, 'main-included')
  assert.equal(result.mainSha, sha('b'))
  assert.equal(f.calls.filter(call => call.path.startsWith(`${repoPath}/compare/`)).length, 1)
  assert.equal(f.mainReads(), 2)
})

test('frontend-only main drift remains current and uses the head-to-main comparison direction', async () => {
  const f = fixture({ compare: compareResult({ files: [{ filename: 'src/components/Panel.tsx' }] }) })
  const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
  assert.equal(result.state, 'current')
  assert.equal(result.reason, 'main-ui-only-changes')
  assert.deepEqual(f.calls[1], {
    path: `${repoPath}/compare/${sha('a')}...${sha('b')}`,
    query: { per_page: 1, page: 1 },
  })
})

test('backend prefixes, renamed paths, and deletions on main mark the PR stale', async t => {
  for (const files of [
    [{ filename: 'convex/schema.ts' }],
    [{ filename: 'src/components/Panel.tsx', previous_filename: 'src/shared/state.ts' }],
    [{ filename: 'packages/overlay-core/src/index.ts' }],
    [{ filename: 'config/removed.json', status: 'removed' }],
  ]) {
    await t.test(JSON.stringify(files), async () => {
      const f = fixture({ compare: compareResult({ files }) })
      const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
      assert.equal(result.state, 'stale')
      assert.equal(result.reason, 'main-backend-changes')
      assert.match(result.description, /sync main and retest/)
    })
  }
})

test('feature-only backend edits are not treated as main drift', async () => {
  const f = fixture({ compare: compareResult({ files: [{ filename: 'src/components/Panel.tsx' }] }) })
  const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
  assert.equal(result.state, 'current')
  assert.equal(f.calls[1].path, `${repoPath}/compare/${sha('a')}...${sha('b')}`)
})

test('root backend configuration and root tsconfig files are classified conservatively', async t => {
  for (const filename of ['package.json', 'tsconfig.convex.json', 'vercel.json', '.github/workflows/pr-preview.yml']) {
    await t.test(filename, async () => {
      const f = fixture({ compare: compareResult({ files: [{ filename }] }) })
      const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
      assert.equal(result.state, 'stale')
    })
  }
})

test('file-list cap and missing or invalid comparison metadata fail closed', async () => {
  const capped = fixture({ compare: compareResult({ files: Array.from({ length: 300 }, (_, index) => ({
    filename: `src/components/${index}.tsx`,
  })) }) })
  assert.equal((await checkBackendFreshness({ api: capped.api, repoPath, headSha: sha('a') })).reason, 'file-cap')

  for (const compare of [
    undefined,
    { base_commit: { sha: sha('a') }, merge_base_commit: { sha: sha('c') } },
    compareResult({ files: [{ filename: 3 }] }),
    compareResult({ files: [{ filename: 'src/Panel.tsx', previous_filename: null }] }),
    compareResult({ files: [{ filename: '../convex/schema.ts' }] }),
    { ...compareResult(), base_commit: { sha: sha('d') } },
  ]) {
    const f = fixture({ compare })
    const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
    assert.equal(result.state, 'unknown')
    assert.match(result.description, /could not be verified/)
  }
})

test('invalid SHA, repository path, and API failures return safe unknown results', async () => {
  let calls = 0
  const api = async () => { calls++; throw new Error('private response body') }
  assert.equal((await checkBackendFreshness({ api, repoPath, headSha: 'bad' })).reason, 'invalid-head-sha')
  assert.equal(calls, 0)
  assert.equal((await checkBackendFreshness({ api, repoPath: '/repos/../other', headSha: sha('a') })).state, 'unknown')
  const invalidMain = fixture({ mainShas: ['not-a-sha'] })
  assert.equal((await checkBackendFreshness({ api: invalidMain.api, repoPath, headSha: sha('a') })).reason, 'invalid-main-sha')

  const f = fixture({ compareError: true })
  const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
  assert.equal(result.reason, 'compare-api-error')
  assert.equal(result.description.includes('private'), false)
})

test('a moving main SHA retries comparison against a newly pinned revision', async () => {
  const f = fixture({ mainShas: [sha('b'), sha('c'), sha('c'), sha('c')],
    compare: path => compareResult({ head: sha('a'), mergeBase: path.endsWith(sha('c')) ? sha('c') : sha('d') }) })
  const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
  assert.equal(result.state, 'current')
  assert.equal(result.mainSha, sha('c'))
  assert.deepEqual(f.calls.filter(call => call.path.startsWith(`${repoPath}/compare/`)).map(call => call.path), [
    `${repoPath}/compare/${sha('a')}...${sha('b')}`,
    `${repoPath}/compare/${sha('a')}...${sha('c')}`,
  ])
})

test('a main that moves through every bounded attempt fails closed', async () => {
  const f = fixture({ mainShas: [sha('b'), sha('c'), sha('c'), sha('d'), sha('d'), sha('e')],
    compare: compareResult() })
  const result = await checkBackendFreshness({ api: f.api, repoPath, headSha: sha('a') })
  assert.equal(result.state, 'unknown')
  assert.equal(result.reason, 'main-moving')
  assert.equal(result.mainSha, sha('e'))
  assert.equal(f.calls.filter(call => call.path.startsWith(`${repoPath}/compare/`)).length, 3)
})
