const MESSAGES: Record<string, string> = {
  hosted_transcription_requires_paid_plan:
    'Cloud dictation requires a paid plan. Choose a local model in Desktop settings to dictate on this Mac.',
  transcription_limit_exceeded:
    'Your cloud dictation allowance is used up. Choose a local model in Desktop settings.',
  workspace_billing_required:
    'Cloud dictation needs billing for this workspace. Set it up in Billing, or choose a local model in Desktop settings.',
  workspace_wallet_forbidden:
    "You can't use this workspace's billing for cloud dictation. Choose a local model in Desktop settings.",
  insufficient_budget:
    'This workspace is out of usage credit. Add credit in Billing, or choose a local model in Desktop settings.'
}

/** Turn a refused `/api/v1/transcribe` response into a message the user can act on. */
export function cloudDictationErrorMessage(status: number, failure: unknown): string {
  const error =
    failure && typeof failure === 'object' ? (failure as { error?: unknown }).error : undefined
  return (
    (typeof error === 'string' && Object.hasOwn(MESSAGES, error) && MESSAGES[error]) ||
    `Cloud dictation failed (${status}).`
  )
}
