import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PRODUCTION_BACKEND = 'colorful-chickadee-419'

/** Select the lane before starting a command that can deploy Convex. */
export function buildPlan(env) {
  if (env.OVERLAY_RELEASE_LANE !== 'staging') {
    return { command: 'npm', args: ['run', 'build'], env: { ...env }, target: 'web only' }
  }

  const childEnv = { ...env }
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
      env: childEnv,
      target: 'preview pr-' + pr,
    }
  }

  if (env.VERCEL_ENV === 'production' && env.OVERLAY_DEPLOYMENT_ENV === 'staging') {
    const name = env.OVERLAY_STAGING_CONVEX_DEPLOYMENT
    const keyTarget = (env.CONVEX_DEPLOY_KEY ?? '').split('|')[0]
    if (!name || name === PRODUCTION_BACKEND || keyTarget !== 'prod:' + name) {
      throw new Error('Staging requires the deploy key for its dedicated staging backend')
    }
    return {
      command: './node_modules/.bin/convex',
      args: ['deploy', '--typecheck', 'enable', '--cmd', 'node scripts/release/build-web.mjs',
        '--cmd-url-env-var-name', 'NEXT_PUBLIC_CONVEX_URL'],
      env: childEnv,
      target: 'staging ' + name,
    }
  }
  throw new Error('Unsupported staging project build environment')
}

export function runBuild(env = process.env) {
  const plan = buildPlan(env)
  console.log('release-build target: ' + plan.target)
  let directory
  try {
    if (plan.command.includes('convex')) {
      directory = mkdtempSync(join(tmpdir(), 'overlay-convex-build-'))
      const envFile = join(directory, 'deployment.env')
      writeFileSync(envFile, '', { mode: 0o600 })
      plan.args.push('--env-file', envFile)
    }
    const result = spawnSync(plan.command, plan.args, { env: plan.env, stdio: 'inherit' })
    if (result.error) throw result.error
    return result.status ?? 1
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
