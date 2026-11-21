import { PREVIEW_HOSTNAME_PATTERN, PREVIEW_PARENT_DOMAIN } from './preview-origin'

/** A wildcard domain must never make the staging deployment look like a PR. */
export function previewHostnameAllowed(hostname: string, deploymentType: string | undefined, appUrl: string): boolean {
  if (!hostname.toLowerCase().endsWith(`.${PREVIEW_PARENT_DOMAIN}`)) return true
  if (deploymentType !== 'preview') return false
  try {
    const origin = new URL(appUrl)
    return origin.protocol === 'https:' && PREVIEW_HOSTNAME_PATTERN.test(origin.hostname)
      && hostname.toLowerCase() === origin.hostname
  } catch {
    return false
  }
}
