import 'server-only'
import type {SandboxInstance} from '@overlay/sandbox-runtime'
import {previewOrigin} from '@/shared/web/preview-origin'
import {CLOUD_AGENT_STATE_DIR} from './cloud-agent-machine'

export const CLOUD_AGENT_PREVIEW_ACCESS_PATH = `${CLOUD_AGENT_STATE_DIR}/preview-hosting.json`

/** Use the existing environment-scoped Preview credential, never a command argument or provider variable. */
export async function prepareCloudAgentPreviewAccess(machine: Pick<SandboxInstance, 'writeFiles'>, serverUrl?: string,
  env: Record<string, string | undefined> = process.env): Promise<string | undefined> {
  if (env.VERCEL_ENV !== 'preview' || env.OVERLAY_DEPLOYMENT_ENV !== 'preview') return undefined
  const origin = previewOrigin(env), secret = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  if (!origin || !secret || !/^[\x21-\x7e]{1,4096}$/.test(secret)) throw Error('Preview machine access is not configured')
  if (serverUrl) {
    const server = new URL(serverUrl)
    if (server.origin !== origin || server.username || server.password) throw Error('Preview machine server does not match this deployment')
  }
  try {
    await machine.writeFiles([{path: CLOUD_AGENT_PREVIEW_ACCESS_PATH, mode: 0o600,
      contents: new TextEncoder().encode(JSON.stringify({origin, secret}))}])
  } catch (_error) {throw Error('Preview machine access could not be prepared')}
  return CLOUD_AGENT_PREVIEW_ACCESS_PATH
}
