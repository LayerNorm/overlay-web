/** Parent domain of isolated PR previews (`pr-<n>.preview.overlay.works`). Keep in sync with scripts/release/preview-domain.mjs. */
export const PREVIEW_PARENT_DOMAIN = 'preview.overlay.works'
const PARENT = PREVIEW_PARENT_DOMAIN.replaceAll('.', '\\.')
/** Matches a canonical PR preview hostname; group 1 is the PR number. */
export const PREVIEW_HOSTNAME_PATTERN = new RegExp(`^pr-([1-9]\\d*)\\.${PARENT}$`)
/** Matches a canonical PR preview origin (HTTPS, no port or path); group 1 is the PR number. */
export const PREVIEW_ORIGIN_PATTERN = new RegExp(`^https://pr-([1-9]\\d*)\\.${PARENT}$`)

/** Read the origin provisioned by trusted PR automation, never a request Host. */
export function previewOrigin(env: Record<string, string | undefined>): string | undefined {
  if (env.OVERLAY_DEPLOYMENT_ENV !== 'preview') return undefined
  if (env.VERCEL_ENV !== 'preview') throw new Error('Preview configuration requires a Vercel preview')
  const origin = env.NEXT_PUBLIC_APP_URL?.trim() ?? ''
  const match = PREVIEW_ORIGIN_PATTERN.exec(origin)
  if (!match || (env.VERCEL_GIT_PULL_REQUEST_ID && env.VERCEL_GIT_PULL_REQUEST_ID !== match[1])) {
    throw new Error('Preview app URL must be the provisioned HTTPS origin for this PR')
  }
  return origin
}
