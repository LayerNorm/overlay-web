import { describe, expect, it } from 'vitest'
import { cloudDictationErrorMessage } from './cloud-dictation-errors'

describe('cloudDictationErrorMessage', () => {
  it('explains a workspace without billing instead of reporting a bare status', () => {
    const message = cloudDictationErrorMessage(402, {
      error: 'workspace_billing_required',
      reason: 'workspace_wallet_not_configured'
    })
    expect(message).toMatch(/billing for this workspace/)
    expect(message).toMatch(/local model/)
    expect(message).not.toMatch(/402/)
  })

  it('keeps the existing plan and allowance messages', () => {
    expect(
      cloudDictationErrorMessage(403, { error: 'hosted_transcription_requires_paid_plan' })
    ).toMatch(/requires a paid plan/)
    expect(cloudDictationErrorMessage(403, { error: 'transcription_limit_exceeded' })).toMatch(
      /allowance is used up/
    )
  })

  it('explains exhausted credit and a forbidden wallet', () => {
    expect(cloudDictationErrorMessage(402, { error: 'insufficient_budget' })).toMatch(
      /out of usage credit/
    )
    expect(cloudDictationErrorMessage(403, { error: 'workspace_wallet_forbidden' })).toMatch(
      /can't use this workspace's billing/
    )
  })

  it('falls back to the status for unknown or unreadable failures', () => {
    expect(cloudDictationErrorMessage(500, { error: 'Failed to transcribe audio' })).toBe(
      'Cloud dictation failed (500).'
    )
    expect(cloudDictationErrorMessage(502, null)).toBe('Cloud dictation failed (502).')
  })
})
