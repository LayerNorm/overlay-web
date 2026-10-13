#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, realpathSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { apiClient } from './preview-control.mjs'
import { revision } from './staging-control.mjs'
import { deploymentEnvFile } from './vercel-build.mjs'
import { PRODUCTION, promotionEvidence, productionCredentials, productionDeploymentMatches,
  verifyProductionProject, verifyProductionLive, verifyStagingLive } from './production-control.mjs'
import { productionSmoke } from './production-smoke.mjs'
import { verifiedSmoke } from './staging-publish.mjs'

const repo = `/repos/${PRODUCTION.repository}`
export const RELEASE_CREDENTIAL_NAMES = Object.freeze(['PRODUCTION_SMOKE_EMAIL',
  'PRODUCTION_SMOKE_PASSWORD', 'PRODUCTION_SMOKE_USER_ID', 'CONVEX_PRODUCTION_DEPLOY_KEY'])

/** Called only after canonical checkout validation. Never loads .env.local. */
export function productionEnvironment(env, file = env.OVERLAY_PRODUCTION_RELEASE_CONFIG
  || join(homedir(), '.config/overlay/release/production.json')) {
  if (RELEASE_CREDENTIAL_NAMES.every(name => env[name])) return env
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  const values = Object.fromEntries(RELEASE_CREDENTIAL_NAMES.map(name => {
    const value = env[name] || saved[name]
    assert.equal(typeof value, 'string', 'Missing private production release setting')
    return [name, value]
  }))
  return { ...env, ...values }
}
const runCommand = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options,
}).trim()

/** Reject a feature checkout before reading credentials or making API calls. */
export function canonicalMain(sha, { cwd = process.cwd(), run = runCommand } = {}) {
  revision(sha)
  const git = args => run('git', args, { cwd })
  const root = realpathSync(git(['rev-parse', '--show-toplevel']))
  const common = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-common-dir']))
  const checkoutGitDir = realpathSync(git(['rev-parse', '--path-format=absolute', '--git-dir']))
  // Primary submodules store Git metadata outside their working directory.
  // Linked feature worktrees have a separate per-worktree Git directory.
  assert.equal(checkoutGitDir, common, 'Use the canonical checkout')
  assert.equal(git(['branch', '--show-current']), 'main', 'Use the main branch')
  assert.equal(git(['status', '--porcelain']), '', 'Canonical main must be clean')
  assert.equal(git(['rev-parse', 'HEAD']), sha, 'Main checkout must be the requested SHA')
  assert.ok(/^https:\/\/github\.com\/LayerNorm\/overlay-web(?:\.git)?$|^git@github\.com:LayerNorm\/overlay-web\.git$/.test(
    git(['remote', 'get-url', 'origin'])), 'Unexpected origin repository')
  git(['fetch', 'origin', 'main'])
  assert.equal(git(['rev-parse', 'origin/main']), sha, 'Use the current accepted main revision')
  const project = JSON.parse(readFileSync(join(root, '.vercel/project.json'), 'utf8'))
  assert.ok(project.projectId === PRODUCTION.projectId && project.orgId === PRODUCTION.teamId,
    'Canonical checkout is not linked to the production project')
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
  assert.equal(config.git?.deploymentEnabled?.main, false, 'Automatic main deployment must remain disabled')
  return root
}

/** Independent steps keep web publication ahead of the production backend push. */
export async function promote({ sha, checkOnly = false, env, github, vercel, verifyCheckout,
  acceptStaging, buildWeb, publishWeb, pushBackend, smoke, record = () => {} }) {
  revision(sha)
  let phase = 'checkout', state = { sha, state: 'pending', backend: PRODUCTION.backend }
  const checkpoint = patch => { state = { ...state, ...patch, phase }; record(state) }
  try {
    verifyCheckout()
    productionCredentials(env)
    phase = 'owner and project'
    assert.equal((await github('/user')).login, 'DevelopedByDev', 'Use Divyansh GitHub identity')
    assert.equal((await vercel('/v2/user')).user?.username, 'developedbydev1', 'Use Divyansh Vercel identity')
    await verifyProductionProject(vercel)
    phase = 'accepted release candidate evidence'
    const evidence = verifiedSmoke(await acceptStaging(sha), sha)
    await verifyStagingLive({ github, vercel, evidence, sha })
    const previous = await vercel(`/v4/aliases/${PRODUCTION.hostname}`)
    assert.ok(previous.projectId === PRODUCTION.projectId && /^dpl_[A-Za-z0-9]+$/.test(previous.deployment?.id ?? ''),
      'Cannot identify the current production deployment')
    checkpoint({ stagingRunId: evidence.runId, stagingDeploymentId: evidence.deploymentId,
      previousDeploymentId: previous.deployment.id, state: checkOnly ? 'preflight-passed' : 'accepted' })
    if (checkOnly) return state
    phase = 'remote web build'
    const deployment = await buildWeb(sha)
    assert.ok(productionDeploymentMatches(deployment, sha), 'Built web provenance mismatch')
    checkpoint({ deploymentId: deployment.id, state: 'web-built' })
    phase = 'web publication'
    verifyCheckout()
    await verifyStagingLive({ github, vercel, evidence, sha })
    const before = await vercel(`/v4/aliases/${PRODUCTION.hostname}`)
    assert.equal(before.deployment?.id, previous.deployment.id, 'Production changed during build')
    await publishWeb(deployment)
    await verifyProductionLive(vercel, await vercel(`/v13/deployments/${deployment.id}`), sha)
    checkpoint({ state: 'web-live' })
    phase = 'production Convex push'
    verifyCheckout()
    await verifyProductionLive(vercel, await vercel(`/v13/deployments/${deployment.id}`), sha)
    await pushBackend()
    checkpoint({ state: 'web-and-backend-live' })
    phase = 'authenticated production smoke'
    const checks = await smoke(deployment)
    for (const name of ['authenticatedIdentity', 'noteCrudAndStaleEdit', 'realChatReplyAndPersistence',
      'filesUi', 'realtimeAuthorization']) assert.equal(checks[name], true, 'Production smoke incomplete')
    await verifyProductionLive(vercel, await vercel(`/v13/deployments/${deployment.id}`), sha)
    checkpoint({ state: 'verified', checks })
    return state
  } catch {
    checkpoint({ state: 'failed', lastCompletedState: state.state })
    throw new Error('Production promotion failed at ' + phase + '; inspect the saved checkpoint')
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  assert.ok(args.length === 1 || (args.length === 2 && args[1] === '--check'),
    'Usage: bash scripts/release/promote.sh <40-character main SHA> [--check]')
  const sha = revision(args[0]), checkOnly = args[1] === '--check'
  const root = canonicalMain(sha)
  env = productionEnvironment(env)
  productionCredentials(env)
  const githubToken = env.GH_TOKEN || env.GITHUB_TOKEN || runCommand('gh', ['auth', 'token'])
  const vercelToken = env.VERCEL_TOKEN || JSON.parse(readFileSync(
    join(homedir(), 'Library/Application Support/com.vercel.cli/auth.json'), 'utf8')).token
  const github = apiClient({ token: githubToken, service: 'GitHub', base: 'https://api.github.com' })
  const vercel = apiClient({ token: vercelToken, service: 'Vercel', base: 'https://api.vercel.com', teamId: PRODUCTION.teamId })
  const directory = mkdtempSync(join(tmpdir(), 'overlay-production-promotion-'))
  const output = join(root, 'artifacts/release-workflow/promotions', sha + '-' + Date.now())
  // Artifacts must be ignored so checkpoints/screenshots cannot dirty main.
  runCommand('git', ['check-ignore', 'artifacts/release-workflow/promotions/proof.json'], { cwd: root })
  mkdirSync(output, { recursive: true, mode: 0o700 })
  let locked = false
  const common = runCommand('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root })
  const lock = join(common, 'overlay-production-promotion.lock')
  // Scope the reviewed CLI exception to this child; retain repository dependency age policy.
  const cliEnv = { ...env, VERCEL_TOKEN: vercelToken, npm_config_min_release_age: '0' }
  const cli = args => runCommand('npx', ['--yes', 'vercel@63.1.2', ...args,
    '--scope', PRODUCTION.teamSlug, '--non-interactive'], { cwd: root, env: cliEnv })
  try {
    mkdirSync(lock); locked = true
    const result = await promote({ sha, checkOnly, env, github, vercel,
      verifyCheckout: () => canonicalMain(sha),
      record: state => writeFileSync(join(output, 'promotion.json'), JSON.stringify(state, null, 2), { mode: 0o600 }),
      acceptStaging: async () => {
        const list = await github(`${repo}/actions/workflows/staging-release.yml/runs`, {
          query: { head_sha: sha, status: 'success', per_page: 100 } })
        const run = list.workflow_runs.find(r => r.head_sha === sha && r.head_branch === 'main' && r.event === 'workflow_dispatch')
        assert.ok(run, 'No successful staging smoke run for this SHA')
        const jobs = await github(`${repo}/actions/runs/${run.id}/jobs`, { query: { per_page: 100 } })
        const job = jobs.jobs.find(j => j.name === 'deploy')
        const artifacts = await github(`${repo}/actions/runs/${run.id}/artifacts`, { query: { per_page: 100 } })
        assert.ok(artifacts.artifacts.some(a => a.name === 'staging-smoke-' + sha && !a.expired),
          'Staging smoke artifact is unavailable')
        runCommand('gh', ['run', 'download', String(run.id), '--repo', PRODUCTION.repository,
          '--name', 'staging-smoke-' + sha, '--dir', directory], { env: { ...env, GH_TOKEN: githubToken } })
        return promotionEvidence(JSON.parse(readFileSync(join(directory, 'staging-smoke.json'), 'utf8')), sha, run, job)
      },
      buildWeb: async () => {
        const inspected = JSON.parse(cli(['project', 'inspect', '--format', 'json']))
        assert.equal(inspected.id, PRODUCTION.projectId, 'CLI project mismatch')
        const stdout = cli(['deploy', '--prod', '--skip-domain', '--yes',
          '--meta', 'overlayReleaseLane=production', '--meta', 'overlayReleaseSha=' + sha,
          '--meta', 'overlayConvexBackend=' + PRODUCTION.backend,
          '--meta', 'githubCommitSha=' + sha, '--meta', 'githubCommitRef=main'])
        const urls = stdout.split(/\s+/).filter(s => /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(s))
        assert.equal(urls.length, 1, 'Expected one native deployment URL on stdout')
        return vercel('/v13/deployments/' + new URL(urls[0]).hostname)
      },
      publishWeb: async d => { cli(['promote', 'https://' + d.url, '--yes']) },
      pushBackend: async () => {
        console.log('release target: customer production Convex ' + PRODUCTION.backend + ' at ' + sha)
        const path = join(directory, 'production.env')
        writeFileSync(path, deploymentEnvFile({ CONVEX_DEPLOY_KEY: env.CONVEX_PRODUCTION_DEPLOY_KEY }), { mode: 0o600 })
        const child = { ...env }
        for (const key of ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'CONVEX_DEPLOYMENT_TOKEN',
          'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY', 'DEV_NEXT_PUBLIC_CONVEX_URL']) delete child[key]
        runCommand('npm', ['run', 'convex:push:prod', '--', '--env-file', path, '--typecheck', 'enable'], { cwd: root, env: child })
      },
      smoke: async deployment => {
        const { chromium } = await import('playwright')
        return productionSmoke({ env, vercel, deployment, sha, evidenceDirectory: output,
          launch: () => chromium.launch({ headless: true }) })
      },
    })
    console.log(JSON.stringify(result))
    console.log('Evidence: ' + output)
  } finally {
    rmSync(directory, { recursive: true, force: true })
    if (locked) rmSync(lock, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message.startsWith('Production promotion failed')
    ? error.message : 'Production promotion preflight failed; verify clean canonical main, exact SHA, identities and required credentials')
    process.exitCode = 1 })
}
