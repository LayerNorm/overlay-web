#!/usr/bin/env node
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { apiClient } from './preview-control.mjs'
import { PRODUCTION } from './production-control.mjs'
import { canonicalMain, main as promote, verifyProductionActor } from './production-promote.mjs'

/** Dispatch the existing isolated candidate. Only fresh, exact-main proof qualifies. */
export async function prepareAutomaticCandidate({ github, sha,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 180 }) {
  const repo = `/repos/${PRODUCTION.repository}`
  const workflow = `${repo}/actions/workflows/staging-release.yml`
  const current = async () => assert.equal((await github(`${repo}/git/ref/heads/main`)).object?.sha,
    sha, 'Release superseded by newer main')
  await current()
  const previous = await github(`${workflow}/runs`, { query: { head_sha: sha, per_page: 100 } })
  const seen = new Set(previous.workflow_runs.map(run => run.id))
  await github(`${workflow}/dispatches`, { method: 'POST', body: {
    ref: 'main', inputs: { publish_candidate: false },
  } })
  for (let attempt = 0; attempt < attempts; attempt++) {
    await current()
    const runs = await github(`${workflow}/runs`, { query: { head_sha: sha, per_page: 100 } })
    const run = runs.workflow_runs.find(r => !seen.has(r.id) && r.head_sha === sha
      && r.head_branch === 'main' && r.event === 'workflow_dispatch')
    if (run?.status === 'completed') {
      assert.equal(run.conclusion, 'success', 'Release candidate failed; production was not started')
      return run.id
    }
    if (attempt + 1 < attempts) await sleep(15_000)
  }
  throw new Error('Release candidate timed out; production was not started')
}

export async function main(env = process.env) {
  const sha = env.GITHUB_SHA
  // checkout intentionally does not persist credentials in Git configuration.
  assert.ok(env.GITHUB_TOKEN, 'An ephemeral Actions token is required')
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
  process.env.GIT_CONFIG_VALUE_0 = 'AUTHORIZATION: basic '
    + Buffer.from('x-access-token:' + env.GITHUB_TOKEN).toString('base64')
  canonicalMain(sha)
  const github = apiClient({ token: env.GITHUB_TOKEN, service: 'GitHub', base: 'https://api.github.com' })
  await verifyProductionActor(github, env, sha)
  const runId = await prepareAutomaticCandidate({ github, sha })
  console.log(`Accepted candidate run ${runId} for ${sha}`)
  await promote([sha], env)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Automatic production release failed. Inspect candidate and saved promotion evidence.')
    process.exitCode = 1
  })
}
