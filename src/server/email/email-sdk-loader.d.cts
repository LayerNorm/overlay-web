export function loadEmailSdk(): Promise<{
  createEmailClient: typeof import('@opencoredev/email-sdk').createEmailClient
  ses: typeof import('@opencoredev/email-sdk/ses').ses
  smtp: typeof import('@opencoredev/email-sdk/smtp').smtp
}>
