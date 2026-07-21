const STORAGE_KEY = 'overlay_mobile_pkce_challenge'
const DESKTOP_STORAGE_KEY = 'overlay_desktop_pkce_challenge'

export function persistMobilePkceChallengeFromUrl(searchParams: Pick<URLSearchParams, 'get'> | null): void {
  if (typeof window === 'undefined' || !searchParams) return
  
  // Mobile app uses codeChallenge
  const mobileChallenge = searchParams.get('codeChallenge')?.trim()
  if (mobileChallenge) {
    try {
      sessionStorage.setItem(STORAGE_KEY, mobileChallenge)
    } catch {
      // ignore quota / private mode
    }
  }
  
  // Desktop app uses desktop_code_challenge
  const desktopChallenge = searchParams.get('desktop_code_challenge')?.trim()
  if (desktopChallenge) {
    try {
      sessionStorage.setItem(DESKTOP_STORAGE_KEY, desktopChallenge)
    } catch {
      // ignore quota / private mode
    }
  }
}

export function getStoredMobilePkceChallenge(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(STORAGE_KEY)?.trim() || null
  } catch {
    return null
  }
}

export function getStoredDesktopPkceChallenge(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(DESKTOP_STORAGE_KEY)?.trim() || null
  } catch {
    return null
  }
}

export function clearStoredMobilePkceChallenge(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(DESKTOP_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function clearStoredDesktopPkceChallenge(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(DESKTOP_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** PKCE challenge for SSO: prefer current URL (app-opened tab), else session fallback across in-site navigation. */
export function resolveCodeChallengeForSso(searchParams: Pick<URLSearchParams, 'get'> | null): string | null {
  // Check mobile challenge from URL
  const mobileFromUrl = searchParams?.get('codeChallenge')?.trim()
  if (mobileFromUrl) return mobileFromUrl
  
  // Check desktop challenge from URL
  const desktopFromUrl = searchParams?.get('desktop_code_challenge')?.trim()
  if (desktopFromUrl) return desktopFromUrl
  
  // Fall back to stored challenges
  return getStoredMobilePkceChallenge() || getStoredDesktopPkceChallenge()
}
