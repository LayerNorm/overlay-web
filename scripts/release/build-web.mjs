import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync('npm', ['run', 'build'], { env: buildWebEnvironment(process.env), stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
