import { spawnSync } from 'node:child_process'

const backend = new URL(process.env.NEXT_PUBLIC_CONVEX_URL ?? '')
if (backend.protocol !== 'https:' || !backend.hostname.endsWith('.convex.cloud')) {
  throw new Error('Hosted release build requires its injected Convex cloud URL')
}
const result = spawnSync('npm', ['run', 'build'], {
  env: { ...process.env,
    NEXT_PUBLIC_CONVEX_SITE_URL: backend.origin.replace(/\.convex\.cloud$/, '.convex.site'),
    NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ENV: process.env.OVERLAY_DEPLOYMENT_ENV,
  }, stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
