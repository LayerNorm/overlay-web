import { isPreviewDeployment } from './preview'

/** Only the PR's own app may receive its hosting bypass credential. */
export function appCallbackHeaders(url: string, headers?: HeadersInit): Headers {
  const result = new Headers(headers)
  if (!isPreviewDeployment()) return result
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!origin || !/^https:\/\/pr-[1-9]\d*\.preview\.getoverlay\.io$/.test(origin)) {
    throw new Error('Preview callback requires its canonical PR app origin')
  }
  const target = new URL(url)
  if (target.origin !== origin || target.username || target.password) {
    throw new Error('Preview callback must target its own PR app')
  }
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
  if (!bypass) throw new Error('Preview callback hosting access is not configured')
  result.set('x-vercel-protection-bypass', bypass)
  return result
}

export function fetchAppCallback(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = appCallbackHeaders(url, init.headers)
  return fetch(url, { ...init, headers, ...(isPreviewDeployment() ? {
    redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000),
  } : {}) })
}
