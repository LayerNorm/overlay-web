import { isPreviewDeployment } from './preview'

function destinations(kind: 'email' | 'webhook'): string[] {
  const key = kind === 'email' ? 'OVERLAY_PREVIEW_EMAIL_RECIPIENTS' : 'OVERLAY_PREVIEW_WEBHOOK_ORIGINS'
  return (process.env[key] ?? '').split(',').map(value => value.trim()).filter(Boolean)
}

export function deliveryEnabled(kind: 'email' | 'webhook'): boolean {
  return !isPreviewDeployment() || destinations(kind).length > 0
}

export function requireDeliveryDestination(kind: 'email' | 'webhook', destination: string): void {
  if (!isPreviewDeployment()) return
  const allowed = destinations(kind)
  if (kind === 'email') {
    if (allowed.some(value => value.toLowerCase() === destination.trim().toLowerCase())) return
  } else {
    const url = new URL(destination)
    if (url.protocol === 'https:' && !url.username && !url.password && allowed.includes(url.origin)) return
  }
  throw new Error('Preview delivery destination is not configured for testing')
}
