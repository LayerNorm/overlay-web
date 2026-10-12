export function isPreviewDeployment(): boolean {
  return process.env.OVERLAY_DEPLOYMENT_ENV === 'preview'
}

export function requirePreviewDeployment(): void {
  if (!isPreviewDeployment()) throw new Error('Preview seed is unavailable on this deployment')
}
