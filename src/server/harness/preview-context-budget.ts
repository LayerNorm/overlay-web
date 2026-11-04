import { previewOrigin } from '@/shared/web/preview-origin'

export function previewHarnessContextBudget(
  env: Record<string, string | undefined>,
  actorUserId?: string,
): number | undefined {
  if (env.VERCEL_ENV !== 'preview' || env.OVERLAY_DEPLOYMENT_ENV !== 'preview'
    || !actorUserId?.startsWith('user_') || actorUserId !== env.PREVIEW_LOGIN_USER_ID) return undefined
  const value = env.HARNESS_PREVIEW_CONTEXT_TOKENS ?? ''
  if (!/^\d{4,5}$/.test(value)) return undefined
  const budget = Number(value)
  if (budget < 8_192 || budget > 32_000) return undefined
  try {
    return previewOrigin(env) ? budget : undefined
  } catch (_error) {
    return undefined
  }
}
