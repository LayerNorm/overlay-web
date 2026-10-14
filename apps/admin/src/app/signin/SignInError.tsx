'use client'

import { useSearchParams } from 'next/navigation'

const MESSAGES: Record<string, string> = {
  oauth_state: 'The sign-in flow expired. Try again.',
  oauth_exchange: 'WorkOS sign-in could not be completed. Try again.',
}

export function SignInError() {
  const params = useSearchParams()
  const error = params.get('error')
  const text = error ? MESSAGES[error] : null
  if (!text) return null
  return <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{text}</p>
}
