export type LifecycleEmailEvent = {
  attributes: Record<string, unknown>
  idempotencyKey: string
  name:
    | 'user.created'
    | 'subscription.changed'
    | 'topup.succeeded'
    | 'automation.failed'
    | 'api_key.changed'
    | 'workspace.invitation_sent'
    | 'workspace.mention'
    | 'workspace.dm_received'
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
    html: renderHtml(content, appUrl),
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
    case 'workspace.invitation_sent': {
      const workspaceName = stringAttribute(event.attributes.workspaceName) ?? 'a workspace'
      const invitationId = stringAttribute(event.resource.id)
      const invitationUrl = invitationId
        ? new URL(`/app/invitations/${encodeURIComponent(invitationId)}`, appUrl).toString()
        : appUrl
      return {
        appUrl: invitationUrl,
        subject: `You've been invited to ${workspaceName} on Overlay`,
        heading: `You're invited to ${workspaceName}`,
        body: `You've been invited to join ${workspaceName} on Overlay. Sign in with the email address that received this invitation to accept.`,
      }
    }
    case 'workspace.mention': {
      const workspaceName = stringAttribute(event.attributes.workspaceName) ?? 'your workspace'
      const mentionedBy = stringAttribute(event.attributes.mentionedByDisplayName) ?? 'Someone'
      const conversationTitle = stringAttribute(event.attributes.conversationTitle) ?? 'a conversation'
      return {
        appUrl,
        subject: `${mentionedBy} mentioned you in ${conversationTitle}`,
        heading: `${mentionedBy} mentioned you`,
        body: `${mentionedBy} mentioned you in ${conversationTitle} in ${workspaceName}. Open Overlay to view the message.`,
      }
    }
    case 'workspace.dm_received': {
      const fromName = stringAttribute(event.attributes.fromDisplayName) ?? 'Someone'
      const workspaceName = stringAttribute(event.attributes.workspaceName) ?? 'your workspace'
      return {
        appUrl,
        subject: `${fromName} sent you a message on Overlay`,
        heading: `${fromName} started a conversation`,
        body: `${fromName} sent you a direct message in ${workspaceName}. Open Overlay to read and reply.`,
      }
    }
  }
}

function siteOrigin(appUrl: string): string {
  try {
    const origin = new URL(appUrl).origin
    return origin === 'https://getoverlay.io' ? 'https://www.getoverlay.io' : origin
  } catch {
    return 'https://www.getoverlay.io'
  }
}

function renderHtml(
  content: {
    appUrl: string
    body: string
    heading: string
  },
  originUrl: string,
): string {
  const ctaUrl = escapeHtml(content.appUrl)
  const logoUrl = escapeHtml(`${siteOrigin(originUrl)}/assets/overlay-logo.png`)
  const heading = escapeHtml(content.heading)
  const body = escapeHtml(content.body)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#171717;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;">
    <tr>
      <td align="center" style="background:#ffffff;padding:48px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;">
          <tr>
            <td style="background:#ffffff;padding:0 0 28px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <img src="${logoUrl}" width="28" height="28" alt="" style="display:block;border:0;width:28px;height:28px;">
                  </td>
                  <td style="vertical-align:middle;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;font-size:22px;line-height:28px;color:#171717;">
                    overlay
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:0 0 16px;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;font-weight:700;color:#171717;">
              ${heading}
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:0 0 28px;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;font-size:16px;line-height:1.65;color:#525252;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:0 0 32px;">
              <a href="${ctaUrl}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#404040;color:#ffffff;text-decoration:none;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;font-size:14px;font-weight:700;">Open Overlay</a>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:20px 0 0;border-top:1px solid #e5e5e5;font-family:'Libre Baskerville',Georgia,'Times New Roman',serif;font-size:12px;line-height:1.55;color:#737373;">
              This is a transactional account email. Overlay does not use this channel for password reset or email verification.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
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
