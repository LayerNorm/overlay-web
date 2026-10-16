import 'server-only'
import { previewOrigin } from '@/shared/web/preview-origin'

/** Hosting authentication for this isolated Preview's own server-to-server API calls. */
export function internalPreviewRequestOptions(targetUrl: string): { headers: Record<string, string>; redirect?: 'error' } {
  const empty = { headers: {} }
  if (process.env.VERCEL_ENV !== 'preview' || process.env.OVERLAY_DEPLOYMENT_ENV !== 'preview') return empty
  const origin = previewOrigin(process.env)
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  if (!origin || !secret) return empty
  let target: URL
  try { target = new URL(targetUrl) } catch (_error) { return empty }
  if (target.origin !== origin || target.username || target.password || !target.pathname.startsWith('/api/')) return empty
  return { headers: { 'x-vercel-protection-bypass': secret }, redirect: 'error' }
}
