export function loadEmailSdk(): Promise<{
  createEmailClient: typeof import('@opencoredev/email-sdk').createEmailClient
  resend: typeof import('@opencoredev/email-sdk/resend').resend
  ses: typeof import('@opencoredev/email-sdk/ses').ses
  smtp: typeof import('@opencoredev/email-sdk/smtp').smtp
}>
