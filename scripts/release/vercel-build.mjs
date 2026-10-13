import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { STAGING, revision } from './staging-control.mjs'

/** Select the lane before starting a command that can deploy Convex. */
export function buildPlan(env) {
  if (env.OVERLAY_RELEASE_LANE !== 'staging') {
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
    if (env.NEXT_PUBLIC_APP_URL !== 'https://pr-' + pr + '.preview.getoverlay.io') {
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
        args: ['run', 'dev/seed:init', '{}', '--deployment', 'preview/pr-' + pr] }],
      env: childEnv,
      target: 'preview pr-' + pr,
    }
  }

  if (env.VERCEL_ENV === 'production' && env.OVERLAY_DEPLOYMENT_ENV === 'staging') {
    if (env.WORKOS_CLIENT_ID !== 'client_01KJ9A19X317J7VWRWQ6XBME9Z'
      || !env.WORKOS_API_KEY?.trim()) {
      throw new Error('Staging requires the sandbox WorkOS client and a nonempty API key')
    }
    const name = env.OVERLAY_STAGING_CONVEX_DEPLOYMENT
    const keyTarget = (env.CONVEX_DEPLOY_KEY ?? '').split('|')[0]
    if (name !== STAGING.backend || keyTarget !== 'prod:' + STAGING.backend) {
      throw new Error('Staging requires the deploy key for its dedicated staging backend')
    }
    const sha = revision(env.OVERLAY_STAGING_BUILD_SHA)
    if (env.OVERLAY_STAGING_BUILD !== 'trusted-main' || env.VERCEL_GIT_COMMIT_REF !== 'main'
      || env.VERCEL_GIT_COMMIT_SHA !== sha || env.VERCEL_GIT_REPO_OWNER !== 'LayerNorm'
      || env.VERCEL_GIT_REPO_SLUG !== 'overlay-web' || env.NEXT_PUBLIC_APP_URL !== STAGING.origin) {
      throw new Error('Staging requires a trusted main build at the requested SHA and origin')
    }
    return {
      command: './node_modules/.bin/convex',
      // Convex's --cmd runs BEFORE the function push. Staging must instead
      // finish the backend deploy before seeding and building the frontend.
      args: ['deploy', '--typecheck', 'enable', '--yes'],
      after: [
        { command: './node_modules/.bin/convex', args: ['run', 'dev/seed:initStaging', '{}'] },
        { command: 'node', args: ['scripts/release/build-web.mjs'] },
      ],
      env: { ...childEnv, NEXT_PUBLIC_CONVEX_URL: `https://${STAGING.backend}.convex.cloud`,
        CONVEX_URL: `https://${STAGING.backend}.convex.cloud` },
      target: 'staging ' + name,
    }
  }
  throw new Error('Unsupported staging project build environment')
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
  try { process.exitCode = runBuild() } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
