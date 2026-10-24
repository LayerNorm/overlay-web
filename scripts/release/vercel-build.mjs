import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** A Git push can start building before the draft PR is opened. */
export async function previewBuildEnvironment(env, { fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  if (env.VERCEL_ENV !== 'preview' || /^[1-9]\d*$/.test(env.VERCEL_GIT_PULL_REQUEST_ID ?? '')) return env
  if (env.VERCEL_GIT_REPO_OWNER !== 'LayerNorm' || env.VERCEL_GIT_REPO_SLUG !== 'overlay-web'
    || !env.VERCEL_GIT_COMMIT_REF || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) {
    throw new Error('Missing trusted Git metadata for PR lookup')
  }
  // This repository is public. Never send provider or deployment credentials
  // to GitHub, and accept only an open internal main PR at this exact revision.
  const url = new URL('https://api.github.com/repos/LayerNorm/overlay-web/pulls')
  url.search = new URLSearchParams({ state: 'open', base: 'main',
    head: 'LayerNorm:' + env.VERCEL_GIT_COMMIT_REF, per_page: '100' }).toString()
  const deadline = now() + 120_000
  do {
    const response = await fetchImpl(url, { headers: { accept: 'application/vnd.github+json' },
      redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Public PR lookup failed: HTTP ' + response.status)
    const matches = (await response.json()).filter(pr => pr.state === 'open'
      && pr.base?.ref === 'main' && pr.base?.repo?.full_name === 'LayerNorm/overlay-web'
      && pr.head?.repo?.full_name === 'LayerNorm/overlay-web'
      && pr.head?.ref === env.VERCEL_GIT_COMMIT_REF && pr.head?.sha === env.VERCEL_GIT_COMMIT_SHA)
    if (matches.length > 1) throw new Error('Ambiguous preview PR source')
    if (matches.length === 1 && Number.isSafeInteger(matches[0].number) && matches[0].number > 0) {
      return { ...env, VERCEL_GIT_PULL_REQUEST_ID: String(matches[0].number) }
    }
    await sleep(10_000)
  } while (now() < deadline)
  throw new Error('Open a main PR for this exact revision before building its preview')
}

/** Select the lane before starting a command that can deploy Convex. */
export function buildPlan(env) {
  // Existing PR heads still expect the old lane name. New heads use preview.
  if (!['preview', 'staging'].includes(env.OVERLAY_RELEASE_LANE)) {
    return { command: 'npm', args: ['run', 'build'], env: { ...env }, target: 'web only' }
  }

  const childEnv = { ...env }
  for (const [provider, feature] of [['INTEGRATIONS', 'INTEGRATIONS'],
    ['BROWSER', 'BROWSER_USE'], ['SANDBOX', 'SANDBOXES'], ['WEB_SEARCH', 'WEB_SEARCH']]) {
    if (env['OVERLAY_PROVIDER_' + provider] === 'none'
      && env['OVERLAY_FEATURE_' + feature] !== 'false') {
      throw new Error('Disabled ' + provider + ' provider requires its feature flag to be false')
    }
  }
  // A deploy key must be the only deployment selector in a hosted build.
  delete childEnv.CONVEX_DEPLOYMENT
  delete childEnv.CONVEX_DEPLOYMENT_TOKEN
  delete childEnv.CONVEX_SELF_HOSTED_URL
  delete childEnv.CONVEX_SELF_HOSTED_ADMIN_KEY
  delete childEnv.DEV_NEXT_PUBLIC_CONVEX_URL
  delete childEnv.NEXT_PUBLIC_DEV_CONVEX_URL

  if (env.VERCEL_ENV === 'preview') {
    if (env.VERCEL_GIT_REPO_OWNER !== 'LayerNorm' || env.VERCEL_GIT_REPO_SLUG !== 'overlay-web') {
      throw new Error('Preview source must be the internal Overlay repository')
    }
    const pr = env.VERCEL_GIT_PULL_REQUEST_ID
    if (!/^[1-9]\d*$/.test(pr ?? '')) throw new Error('A preview requires an open PR number')
    const origin = 'https://pr-' + pr + '.preview.getoverlay.io'
    // Native Git builds can start before the domain controller provisions the
    // branch override. Vercel's internal PR metadata supplies the same origin.
    if (!env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_APP_URL === 'https://preview-unassigned.invalid') {
      childEnv.NEXT_PUBLIC_APP_URL = origin
    }
    if (childEnv.NEXT_PUBLIC_APP_URL !== origin) {
      throw new Error('Provision the canonical PR app URL before building')
    }
    if (!/^preview:[^:|]+:[^|]+\|.+/.test(env.CONVEX_DEPLOY_KEY ?? '')) {
      throw new Error('A preview requires a project-scoped Convex preview deploy key')
    }
    if (env.OVERLAY_DEPLOYMENT_ENV !== 'preview') {
      throw new Error('Preview runtime must explicitly identify itself as preview')
    }
    childEnv.CONVEX_PREVIEW = '1'
    return {
      command: './node_modules/.bin/convex',
      // --preview-name preserves preview data between pushes. --preview-create
      // deletes an existing backend and must not be used for ordinary updates.
      args: ['deploy', '--preview-name', 'pr-' + pr, '--typecheck', 'enable',
        '--cmd', 'node scripts/release/build-web.mjs', '--cmd-url-env-var-name', 'NEXT_PUBLIC_CONVEX_URL',
        '--preview-run', 'dev/seed:init'],
      // --preview-run only runs for a newly claimed backend. An interrupted
      // first build can leave it empty, so repair missing fixtures after every push.
      after: [{ command: './node_modules/.bin/convex',
        args: ['run', 'dev/seed:init', '{}', '--deployment', 'preview/pr-' + pr] },
        ...(env.OVERLAY_PREVIEW_QA_FIXTURES === 'paid-workspace' ? [{
          command: './node_modules/.bin/convex',
          args: ['run', 'dev/seed:initQa', '{}', '--deployment', 'preview/pr-' + pr],
        }] : [])],
      env: childEnv,
      target: 'preview pr-' + pr,
    }
  }

  throw new Error('Unsupported preview build environment')
}

export function deploymentEnvFile(env) {
  const key = env.CONVEX_DEPLOY_KEY
  if (!key || /[\r\n"]/.test(key)) throw new Error('Invalid Convex deploy key')
  // --env-file replaces Convex's selection AND authentication inputs. Keep
  // exactly the approved key, without reading a checkout's .env.local.
  return 'CONVEX_DEPLOY_KEY="' + key + '"\n'
}

export function runBuild(env = process.env, spawn = spawnSync) {
  const plan = buildPlan(env)
  console.log('release-build target: ' + plan.target)
  let directory
  try {
    if (plan.command.includes('convex')) {
      directory = mkdtempSync(join(tmpdir(), 'overlay-convex-build-'))
      const envFile = join(directory, 'deployment.env')
      writeFileSync(envFile, deploymentEnvFile(plan.env), { mode: 0o600 })
      for (const step of [plan, ...(plan.after ?? [])]) {
        if (step.command.includes('convex')) step.args.push('--env-file', envFile)
      }
    }
    for (const step of [plan, ...(plan.after ?? [])]) {
      const result = spawn(step.command, step.args, { env: plan.env, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) return result.status ?? 1
    }
    return 0
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = runBuild(await previewBuildEnvironment(process.env)) } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
