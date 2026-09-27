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

type EmailContent = {
  /** Plain-text body; also escaped into the HTML body unless bodyHtml is set. */
  body: string
  bodyHtml?: string
  ctaLabel: string
  ctaUrl: string
  /** Trusted feature-card HTML built by the helpers below (all values escaped). */
  feature?: string
  heading: string
  reason: string
  /** Adds a "Manage email preferences" footer link (notification-type emails). */
  showPreferences?: boolean
  subject: string
}

const SERIF = `'Libre Baskerville',Georgia,'Times New Roman',serif`
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`

export function renderLifecycleEmail(
  event: LifecycleEmailEvent,
  appUrl = 'https://getoverlay.io',
): LifecycleEmailContent {
  const content = contentForEvent(event, appUrl)
  const preferencesUrl = content.showPreferences ? appPath(appUrl, '/app/settings') : null
  const textParts = [content.heading, '', content.body, '', `${content.ctaLabel}: ${content.ctaUrl}`, '', '--', content.reason]
  if (preferencesUrl) textParts.push(`Manage email preferences: ${preferencesUrl}`)
  return {
    subject: content.subject,
    text: textParts.join('\n'),
    html: renderHtml(content, appUrl, preferencesUrl),
  }
}

function contentForEvent(event: LifecycleEmailEvent, appUrl: string): EmailContent {
  switch (event.name) {
    case 'user.created': return welcomeContent(appUrl)
    case 'subscription.changed': return subscriptionContent(event, appUrl)
    case 'topup.succeeded': return topupContent(appUrl)
    case 'automation.failed': return automationFailedContent(event, appUrl)
    case 'api_key.changed': return apiKeyContent(event, appUrl)
    case 'workspace.invitation_sent': return invitationContent(event, appUrl)
    case 'workspace.mention': return mentionContent(event, appUrl)
    case 'workspace.dm_received': return dmContent(event, appUrl)
  }
}

function welcomeContent(appUrl: string): EmailContent {
  return {
    body: 'Your account is ready. One workspace for the models you ask, the agents that act, and the people you work with.',
    ctaLabel: 'Open Overlay',
    ctaUrl: appPath(appUrl, '/app/chat'),
    feature: featureRows([
      ['Ask anything', 'Chat with frontier models in one place', appPath(appUrl, '/app/chat')],
      ['Hand off work', 'Agents run tasks in the background while you move on', appPath(appUrl, '/app/automations')],
      ['Bring the team', 'Shared workspaces, mentions, and direct messages', appPath(appUrl, '/app/settings?section=workspace')],
    ]),
    heading: 'Welcome to Overlay',
    reason: 'You received this because an Overlay account was created for you.',
    subject: 'Welcome to Overlay',
  }
}

function subscriptionContent(event: LifecycleEmailEvent, appUrl: string): EmailContent {
  const status = stringAttribute(event.attributes.status) ?? 'updated'
  const label = subscriptionLabel(status)
  const billingUrl = appPath(appUrl, '/app/settings?section=account')
  const feature = statusCard(label, status)
  if (status === 'past_due') {
    return {
      body: `We couldn't collect your latest payment. Update your payment method to keep your plan and agents running.`,
      ctaLabel: 'Update billing',
      ctaUrl: billingUrl,
      feature,
      heading: 'Payment is past due',
      reason: 'You received this because the subscription on your account changed.',
      subject: 'Your Overlay subscription is past due',
    }
  }
  if (status === 'canceled') {
    return {
      body: 'Your paid plan has ended and the account moved to the free tier. You can restart it any time from billing settings.',
      ctaLabel: 'Review billing',
      ctaUrl: billingUrl,
      feature,
      heading: 'Your subscription is canceled',
      reason: 'You received this because the subscription on your account changed.',
      subject: 'Your Overlay subscription is canceled',
    }
  }
  if (status === 'active' || status === 'trialing') {
    return {
      body: status === 'trialing'
        ? 'Your trial is active. Model usage, agents, and credits are all managed from Account settings.'
        : `You're on a paid plan. Model usage, agents, and credits are all managed from Account settings.`,
      ctaLabel: 'Review billing',
      ctaUrl: billingUrl,
      feature,
      heading: status === 'trialing' ? 'Your trial is active' : 'Your subscription is active',
      reason: 'You received this because the subscription on your account changed.',
      subject: `Your Overlay subscription is ${label}`,
    }
  }
  return {
    body: `Your Overlay subscription status is now ${label}. Review billing details in Account settings.`,
    ctaLabel: 'Review billing',
    ctaUrl: billingUrl,
    feature,
    heading: 'Subscription updated',
    reason: 'You received this because the subscription on your account changed.',
    subject: 'Your Overlay subscription was updated',
  }
}

function topupContent(appUrl: string): EmailContent {
  return {
    body: 'Your credits are ready to use. Agents, models, and sandboxes draw from this balance first.',
    ctaLabel: 'View balance',
    ctaUrl: appPath(appUrl, '/app/settings?section=account'),
    feature: card(
      `<table role="presentation" cellspacing="0" cellpadding="0"><tr>` +
      `<td style="vertical-align:middle;padding-right:10px;">${statusDot('#10b981')}</td>` +
      `<td style="font-family:${SANS};font-size:12.5px;color:#0a0a0a;vertical-align:middle;">Credits added to your balance</td>` +
      `</tr></table>`,
    ),
    heading: 'Top-up confirmed',
    reason: 'You received this because a credit purchase completed on your account.',
    subject: 'Your Overlay top-up is confirmed',
  }
}

function automationFailedContent(event: LifecycleEmailEvent, appUrl: string): EmailContent {
  const automationId = stringAttribute(event.resource.automationId)
  const automationName = stringAttribute(event.attributes.automationName) ?? 'Automation run'
  const execution = event.attributes.execution === 'manual' ? 'Manual' : 'Scheduled'
  const failure = failureLabel(stringAttribute(event.attributes.failureClass))
  return {
    body: `One of your automations didn't finish. Open the run to see what happened and retry it when you're ready.`,
    ctaLabel: 'Review the run',
    ctaUrl: automationId
      ? appPath(appUrl, `/app/automations?automationId=${encodeURIComponent(automationId)}`)
      : appPath(appUrl, '/app/automations'),
    feature: card(
      `<table role="presentation" cellspacing="0" cellpadding="0" width="100%"><tr>` +
      `<td style="vertical-align:top;padding-top:3px;padding-right:10px;width:7px;">${statusDot('#ef4444')}</td>` +
      `<td><div style="font-family:${SANS};font-size:12.5px;font-weight:500;color:#0a0a0a;">${escapeHtml(automationName)}</div>` +
      `<div style="font-family:${SANS};font-size:11.5px;color:#71717a;padding-top:3px;">${execution} run &middot; ${failure}</div></td>` +
      `</tr></table>`,
    ),
    heading: 'An automation run failed',
    reason: 'You received this because an automation you own failed.',
    showPreferences: true,
    subject: 'An Overlay automation needs attention',
  }
}

function apiKeyContent(event: LifecycleEmailEvent, appUrl: string): EmailContent {
  const action = stringAttribute(event.attributes.action) ?? 'changed'
  const accountUrl = appPath(appUrl, '/app/settings?section=account')
  const feature = card(
    `<table role="presentation" cellspacing="0" cellpadding="0"><tr>` +
    `<td style="vertical-align:middle;padding-right:10px;font-family:${SANS};font-size:14px;color:#71717a;">&#9679;</td>` +
    `<td><span style="font-family:${SANS};font-size:12.5px;color:#0a0a0a;">API key</span> ${pill(escapeHtml(action))}</td>` +
    `</tr></table>`,
  )
  const bodies: Record<string, string> = {
    created: `A new API key can act on your account. If this wasn't you, revoke it from settings and tell your admin.`,
    revoked: `The key can no longer be used. If you didn't expect this, check the rest of your keys in settings.`,
    rotated: 'The old secret stopped working. Update anywhere that still calls Overlay with it.',
  }
  return {
    body: bodies[action]
      ?? 'An API key on your Overlay account changed. If this was not you, revoke active keys and contact your administrator.',
    ctaLabel: 'Review API keys',
    ctaUrl: accountUrl,
    feature,
    heading: `API key ${action}`,
    reason: 'You received this security notice because an API key on your account changed.',
    subject: `An API key was ${action} on your Overlay account`,
  }
}

function invitationContent(event: LifecycleEmailEvent, appUrl: string): EmailContent {
  const workspaceName = stringAttribute(event.attributes.workspaceName) ?? 'a workspace'
  const role = stringAttribute(event.attributes.role) ?? 'member'
  const invitationId = stringAttribute(event.resource.id)
  const invitationUrl = invitationId
    ? new URL(`/app/invitations/${encodeURIComponent(invitationId)}`, appUrl).toString()
    : appUrl
  return {
    body: `You've been invited to collaborate in ${workspaceName}. Sign in with the email address that received this invitation to accept.`,
    bodyHtml: `You've been invited to collaborate in this workspace. Sign in with the email address that received this invitation to accept.`,
    ctaLabel: 'Accept invitation',
    ctaUrl: invitationUrl,
    feature: card(
      `<table role="presentation" cellspacing="0" cellpadding="0"><tr>` +
      `<td style="vertical-align:middle;">${avatar(initials(workspaceName))}</td>` +
      `<td style="vertical-align:middle;padding-left:12px;">` +
      `<div style="font-family:${SANS};font-size:13px;font-weight:500;color:#0a0a0a;">${escapeHtml(workspaceName)}</div>` +
      `<div style="font-family:${SANS};font-size:11.5px;color:#71717a;padding-top:2px;">Invited you as ${escapeHtml(role)}</div></td>` +
      `</tr></table>`,
    ),
    heading: `Join ${workspaceName}`,
    reason: 'You received this because someone invited this email address to an Overlay workspace.',
    subject: `You've been invited to ${workspaceName} on Overlay`,
  }
}

function mentionContent(event: LifecycleEmailEvent, appUrl: string): EmailContent {
  const workspaceName = stringAttribute(event.attributes.workspaceName) ?? 'your workspace'
  const mentionedBy = stringAttribute(event.attributes.mentionedByDisplayName) ?? 'Someone'
  const conversationTitle = stringAttribute(event.attributes.conversationTitle) ?? 'a conversation'
  const conversationId = stringAttribute(event.attributes.conversationId)
  return {
    body: `${mentionedBy} mentioned you in ${conversationTitle} in ${workspaceName}. Open Overlay to see the context and reply.`,
    bodyHtml: 'You were mentioned in a conversation. Open it to see the context and reply.',
    ctaLabel: 'Open conversation',
    ctaUrl: conversationId
      ? appPath(appUrl, `/app/chat?view=channels&id=${encodeURIComponent(conversationId)}`)
      : appPath(appUrl, '/app/chat'),
    feature: chatCard(mentionedBy, `${conversationTitle} · ${workspaceName}`),
    heading: `${mentionedBy} mentioned you`,
    reason: 'You received this because someone mentioned you in a workspace conversation.',
    showPreferences: true,
    subject: `${mentionedBy} mentioned you in ${conversationTitle}`,
  }
}

function dmContent(event: LifecycleEmailEvent, appUrl: string): EmailContent {
  const fromName = stringAttribute(event.attributes.fromDisplayName) ?? 'Someone'
  const workspaceName = stringAttribute(event.attributes.workspaceName) ?? 'your workspace'
  const conversationId = stringAttribute(event.attributes.conversationId)
  return {
    body: `${fromName} sent you a direct message in ${workspaceName}. Open Overlay to read and reply.`,
    bodyHtml: 'You have a new direct message waiting in your workspace.',
    ctaLabel: 'Reply in Overlay',
    ctaUrl: conversationId
      ? appPath(appUrl, `/app/chat?view=dms&id=${encodeURIComponent(conversationId)}`)
      : appPath(appUrl, '/app/chat'),
    feature: chatCard(fromName, workspaceName),
    heading: `${fromName} sent you a message`,
    reason: 'You received this because someone sent you a direct message.',
    showPreferences: true,
    subject: `${fromName} sent you a message on Overlay`,
  }
}

function appPath(appUrl: string, path: string): string {
  try {
    return new URL(path, appUrl).toString()
  } catch {
    return `https://getoverlay.io${path.startsWith('/') ? path : `/${path}`}`
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

function renderHtml(content: EmailContent, originUrl: string, preferencesUrl: string | null): string {
  const ctaUrl = escapeHtml(content.ctaUrl)
  const logoUrl = escapeHtml(`${siteOrigin(originUrl)}/assets/overlay-logo.png`)
  const heading = escapeHtml(content.heading)
  const body = content.bodyHtml ?? escapeHtml(content.body)
  const reason = escapeHtml(content.reason)
  const preferencesLink = preferencesUrl
    ? ` &middot; <a href="${escapeHtml(preferencesUrl)}" style="color:#a1a1aa;text-decoration:underline;text-underline-offset:2px;">Manage email preferences</a>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#fafafa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafa;">
    <tr>
      <td align="center" style="padding:44px 16px 64px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;">
          <tr>
            <td style="padding:0 4px 18px;">
              <span style="line-height:1;"><img src="${logoUrl}" width="12" height="12" alt="" style="display:inline-block;vertical-align:middle;border:0;"><span style="font-family:${SERIF};font-size:20px;font-weight:500;letter-spacing:-0.02em;color:#0a0a0a;padding-left:8px;vertical-align:middle;">overlay</span></span>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:28px 28px 24px;box-shadow:0 1px 2px rgba(0,0,0,0.04),0 16px 48px -24px rgba(0,0,0,0.12);">
              <div style="font-family:${SERIF};font-size:24px;line-height:1.32;font-weight:400;letter-spacing:-0.02em;color:#0a0a0a;padding-bottom:12px;">
                ${heading}
              </div>
              <div style="font-family:${SANS};font-size:14px;line-height:1.65;color:#525252;padding-bottom:20px;">
                ${body}
              </div>
              ${content.feature ?? ''}
              <div style="padding:${content.feature ? '20' : '4'}px 0 6px;">
                <a href="${ctaUrl}" style="display:inline-block;padding:10px 20px;border-radius:999px;background:#0a0a0a;color:#ffffff;text-decoration:none;font-family:${SANS};font-size:13px;font-weight:500;">${escapeHtml(content.ctaLabel)}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 6px 0;">
              <div style="font-family:${SANS};font-size:11px;line-height:1.7;color:#a1a1aa;">
                ${reason}${preferencesLink}<br>
                LayerNorm Inc &middot; <a href="${escapeHtml(siteOrigin(originUrl))}" style="color:#a1a1aa;text-decoration:underline;text-underline-offset:2px;">getoverlay.io</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function card(inner: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;"><tr><td style="padding:14px 16px;">${inner}</td></tr></table>`
}

function featureRows(rows: ReadonlyArray<readonly [label: string, description: string, href: string]>): string {
  const body = rows
    .map(([label, description, href]) =>
      `<tr><td style="padding:11px 0;border-bottom:1px solid #f0f0f0;">` +
      `<a href="${escapeHtml(href)}" style="text-decoration:none;">` +
      `<span style="display:block;font-family:${SERIF};font-size:13px;color:#0a0a0a;">${escapeHtml(label)}</span>` +
      `<span style="display:block;font-family:${SANS};font-size:12px;color:#71717a;margin-top:2px;">${escapeHtml(description)} &rarr;</span>` +
      `</a></td></tr>`)
    .join('')
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #f0f0f0;">${body}</table>`
}

function statusCard(label: string, status: string): string {
  const colors: Record<string, [bg: string, fg: string]> = {
    active: ['#ecfdf5', '#047857'],
    canceled: ['#f5f5f5', '#525252'],
    past_due: ['#fef2f2', '#b91c1c'],
  }
  const [bg, fg] = colors[status] ?? ['#f5f5f5', '#525252']
  return card(
    `<table role="presentation" cellspacing="0" cellpadding="0"><tr>` +
    `<td style="font-family:${SANS};font-size:12px;color:#a1a1aa;padding-right:14px;vertical-align:middle;">Plan status</td>` +
    `<td style="vertical-align:middle;">${pill(escapeHtml(label), bg, fg)}</td>` +
    `</tr></table>`,
  )
}

function chatCard(name: string, context: string): string {
  return card(
    `<table role="presentation" cellspacing="0" cellpadding="0"><tr>` +
    `<td style="vertical-align:top;">${avatar(initials(name))}</td>` +
    `<td style="vertical-align:top;padding-left:12px;">` +
    `<div style="font-family:${SANS};font-size:12.5px;color:#0a0a0a;"><strong>${escapeHtml(name)}</strong>` +
    `<span style="color:#a1a1aa;"> &middot; ${escapeHtml(context)}</span></div>` +
    `</td></tr></table>`,
  )
}

function pill(text: string, bg = '#f5f5f5', fg = '#0a0a0a'): string {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${bg};border:1px solid #e4e4e7;color:${fg};font-family:${SANS};font-size:11px;font-weight:500;">${text}</span>`
}

function statusDot(color: string): string {
  return `<span style="display:inline-block;width:7px;height:7px;border-radius:999px;background:${color};"></span>`
}

function avatar(initialLetters: string, size = 30): string {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:999px;` +
    `background:linear-gradient(135deg,#d4d4d8,#71717a);color:#ffffff;font-family:${SANS};` +
    `font-size:${Math.round(size * 0.36)}px;font-weight:600;line-height:${size}px;text-align:center;` +
    `vertical-align:middle">${initialLetters}</span>`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((part) => [...part][0] ?? '')
  return escapeHtml(letters.join('').toUpperCase() || 'O')
}

function failureLabel(failureClass: string | undefined): string {
  switch (failureClass) {
    case 'authorization': return 'authorization error'
    case 'provider': return 'provider error'
    case 'transient': return 'transient error'
    case 'validation': return 'validation error'
    default: return 'failed'
  }
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
