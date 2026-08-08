'use strict'

exports.loadEmailSdk = async function loadEmailSdk() {
  const [core, sesAdapter, smtpAdapter, resendAdapter] = await Promise.all([
    import('@opencoredev/email-sdk'),
    import('@opencoredev/email-sdk/ses'),
    import('@opencoredev/email-sdk/smtp'),
    import('@opencoredev/email-sdk/resend'),
  ])
  return {
    createEmailClient: core.createEmailClient,
    ses: sesAdapter.ses,
    smtp: smtpAdapter.smtp,
    resend: resendAdapter.resend,
  }
}
