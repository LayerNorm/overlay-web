import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPlan, deploymentEnvFile } from './vercel-build.mjs'

export function buildWebEnvironment(env) {
  const backend = new URL(env.NEXT_PUBLIC_CONVEX_URL ?? '')
  if (backend.protocol !== 'https:' || !backend.hostname.endsWith('.convex.cloud')) {
    throw new Error('Hosted release build requires its injected Convex cloud URL')
  }
  const childEnv = { ...env,
    NEXT_PUBLIC_CONVEX_SITE_URL: backend.origin.replace(/\.convex\.cloud$/, '.convex.site'),
    NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ENV: env.OVERLAY_DEPLOYMENT_ENV,
  }
  if (env.OVERLAY_BUILD_DIAGNOSTICS === '1') {
    const preload = fileURLToPath(new URL('./build-resource-diagnostics.mjs', import.meta.url))
    childEnv.NODE_OPTIONS = [env.NODE_OPTIONS, '--import=' + JSON.stringify(preload)].filter(Boolean).join(' ')
  }
  return childEnv
}

export function runHostedWebBuild(env, spawn = spawnSync) {
  const plan = buildPlan(env)
  if (!plan.target.startsWith('preview pr-')) throw new Error('Auth preflight requires an isolated PR Preview')
  const childEnv = buildWebEnvironment(plan.env)
  const provider = env.OVERLAY_PROVIDER_AUTH?.trim() || env.AUTH_PROVIDER?.trim() || 'workos'
  if (provider !== 'workos') throw new Error('Hosted Preview login requires WorkOS')
  const clientId = env.WORKOS_CLIENT_ID?.trim()
  if (!clientId || /[\r\n]/.test(clientId)) throw new Error('Hosted Preview requires WORKOS_CLIENT_ID')
  const directory = mkdtempSync(join(tmpdir(), 'overlay-preview-auth-'))
  try {
    const keyFile = join(directory, 'deployment.env')
    const authFile = join(directory, 'auth.env')
    writeFileSync(keyFile, deploymentEnvFile(plan.env), { mode: 0o600 })
    writeFileSync(authFile, 'OVERLAY_PROVIDER_AUTH="workos"\nWORKOS_CLIENT_ID=' + JSON.stringify(clientId) + '\n', { mode: 0o600 })
    // convex deploy claims the backend before --cmd and evaluates auth afterward.
    const prepared = spawn('./node_modules/.bin/convex', ['env', 'set', '--from-file', authFile,
      '--force', '--deployment', 'preview/pr-' + plan.env.VERCEL_GIT_PULL_REQUEST_ID, '--env-file', keyFile],
    { env: childEnv, stdio: 'inherit' })
    if (prepared.error) throw prepared.error
    if (prepared.status !== 0) return prepared.status ?? 1
    const result = spawn('npm', ['run', 'build'], { env: childEnv, stdio: 'inherit' })
    if (result.error) throw result.error
    return result.status ?? 1
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runHostedWebBuild(process.env)
}
