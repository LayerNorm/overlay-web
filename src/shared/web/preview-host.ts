/** A wildcard domain must never make the staging deployment look like a PR. */
export function previewHostnameAllowed(hostname: string, deploymentType: string | undefined, appUrl: string): boolean {
  if (!hostname.toLowerCase().endsWith('.preview.getoverlay.io')) return true
  if (deploymentType !== 'preview') return false
  try {
    const origin = new URL(appUrl)
    return origin.protocol === 'https:' && /^pr-[1-9]\d*\.preview\.getoverlay\.io$/.test(origin.hostname)
      && hostname.toLowerCase() === origin.hostname
  } catch {
    return false
  }
}
