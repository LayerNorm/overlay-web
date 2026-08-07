export type LifecycleEmailEvent = {
  attributes: Record<string, unknown>
  idempotencyKey: string
  name:
    | 'user.created'
    | 'subscription.changed'
    | 'topup.succeeded'
    | 'automation.failed'
    | 'api_key.changed'
  resource: Record<string, unknown>
  userId: string
}

export type LifecycleEmailContent = {
  subject: string
  text: string
  html: string
}

export function renderLifecycleEmail(
  event: LifecycleEmailEvent,
  appUrl = 'https://getoverlay.io',
): LifecycleEmailContent {
  const content = contentForEvent(event, appUrl)
  return {
    subject: content.subject,
    text: `${content.heading}\n\n${content.body}\n\nOpen Overlay: ${content.appUrl}`,
    html: renderHtml(content),
  }
}

function contentForEvent(event: LifecycleEmailEvent, appUrl: string): {
  appUrl: string
  body: string
  heading: string
  subject: string
} {
  switch (event.name) {
    case 'user.created':
      return {
        appUrl,
        subject: 'Welcome to Overlay',
        heading: 'Your Overlay account is ready',
        body: 'You can now use Overlay. Account verification and password recovery remain managed by your identity provider.',
      }
    case 'subscription.changed': {
      const status = stringAttribute(event.attributes.status) ?? 'updated'
      return {
        appUrl,
        subject: `Your Overlay subscription is ${subscriptionLabel(status)}`,
        heading: 'Subscription updated',
        body: `Your Overlay subscription status is now ${subscriptionLabel(status)}. Review billing details in Account settings.`,
      }
    }
    case 'topup.succeeded':
      return {
        appUrl,
        subject: 'Overlay top-up confirmed',
        heading: 'Top-up credits added',
        body: 'Your purchased top-up credits are now available. You can view the remaining balance in Account settings.',
      }
    case 'automation.failed':
      return {
        appUrl,
        subject: 'An Overlay automation needs attention',
        heading: 'Automation run failed',
        body: 'An automation did not complete successfully. Open Overlay to review the run and decide whether to retry it.',
      }
    case 'api_key.changed': {
      const action = stringAttribute(event.attributes.action) ?? 'changed'
      return {
        appUrl,
        subject: `Overlay API key ${action}`,
        heading: `API key ${action}`,
        body: 'An API key on your Overlay account changed. If this was not you, revoke active keys and contact your administrator immediately.',
      }
    }
  }
}

function renderHtml(content: {
  appUrl: string
  body: string
  heading: string
}): string {
  const appUrl = escapeHtml(content.appUrl)
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;color:#171717;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e5e5e5;border-radius:12px"><tr><td style="padding:32px"><p style="margin:0 0 20px;font-size:14px;font-weight:700">Overlay</p><h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">${escapeHtml(content.heading)}</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#525252">${escapeHtml(content.body)}</p><a href="${appUrl}" style="display:inline-block;padding:11px 16px;border-radius:8px;background:#171717;color:#fff;text-decoration:none;font-weight:600">Open Overlay</a><p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#737373">This is a transactional account email. Overlay does not use this channel for password reset or email verification.</p></td></tr></table></td></tr></table></body></html>`
}

function subscriptionLabel(status: string): string {
  return status.replaceAll('_', ' ')
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
