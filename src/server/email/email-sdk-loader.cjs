'use strict'

exports.loadEmailSdk = async function loadEmailSdk() {
  const [core, sesAdapter, smtpAdapter] = await Promise.all([
    import('@opencoredev/email-sdk'),
    import('@opencoredev/email-sdk/ses'),
    import('@opencoredev/email-sdk/smtp'),
  ])
  return {
    createEmailClient: core.createEmailClient,
    ses: sesAdapter.ses,
    smtp: smtpAdapter.smtp,
  }
}
