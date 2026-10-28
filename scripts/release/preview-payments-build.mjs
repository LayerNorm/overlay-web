import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PreviewBackends, previewBackendClient, previewAddress } from './preview-control.mjs'
import { PreviewPayments, stripeTestClient } from './preview-payments.mjs'

const env = process.env
const number = Number(env.VERCEL_GIT_PULL_REQUEST_ID)
previewAddress(number)
if (env.VERCEL_ENV !== 'preview' || env.OVERLAY_DEPLOYMENT_ENV !== 'preview') throw new Error('Preview payments are unavailable outside Preview')
const api = previewBackendClient(env.CONVEX_DEPLOY_KEY)
const keyFile = process.argv[2]
if (!keyFile) throw new Error('Explicit Preview key-only file is required')
const selector = ['--deployment', 'preview/pr-' + number, '--env-file', keyFile]
function convex(args) {
  const result = spawnSync('./node_modules/.bin/convex', [...args, ...selector], {
    env, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60_000,
  })
  if (result.error || result.status !== 0) throw new Error('Preview payment backend configuration failed')
  return result.stdout.trim()
}
const payments = new PreviewPayments({ api: stripeTestClient(env.STRIPE_SECRET_KEY), backends: new PreviewBackends({ api }) })
try {
  const result = await payments.provision(number, {
    readState: async () => {
      const names = new Set(convex(['env', 'list', '--names-only']).split(/\r?\n/))
      return {
        id: names.has('OVERLAY_PREVIEW_STRIPE_WEBHOOK_ID') ? convex(['env', 'get', 'OVERLAY_PREVIEW_STRIPE_WEBHOOK_ID']) : undefined,
        secret: names.has('STRIPE_WEBHOOK_SECRET') ? convex(['env', 'get', 'STRIPE_WEBHOOK_SECRET']) : undefined,
      }
    },
    saveState: async ({ id, secret }) => {
      const directory = mkdtempSync(join(tmpdir(), 'overlay-preview-payment-'))
      try {
        const path = join(directory, 'webhook.env')
        writeFileSync(path, `STRIPE_WEBHOOK_SECRET=${JSON.stringify(secret)}\nOVERLAY_PREVIEW_STRIPE_WEBHOOK_ID=${JSON.stringify(id)}\n`, { mode: 0o600 })
        convex(['env', 'set', '--force', '--from-file', path])
      } finally { rmSync(directory, { recursive: true, force: true }) }
    },
  })
  console.log('Preview payment endpoint configured: ' + result.id)
} catch (error) { console.error(error.message); process.exitCode = 1 }
