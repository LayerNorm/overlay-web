const PKCE_CHALLENGE_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export function shouldReuseExistingWebSession(input: {
  authLoading: boolean;
  isAuthenticated: boolean;
  forceLogin: boolean;
  isDirectDesktopCallback: boolean;
}): boolean {
  return (
    !input.authLoading &&
    input.isAuthenticated &&
    !input.forceLogin &&
    !input.isDirectDesktopCallback
  );
}

export function shouldStartDesktopHandoff(input: {
  codeChallenge: string;
  isAuthenticated: boolean;
  userId: string | null;
  sessionCheckComplete: boolean;
}): boolean {
  return (
    PKCE_CHALLENGE_RE.test(input.codeChallenge) &&
    input.isAuthenticated &&
    Boolean(input.userId) &&
    input.sessionCheckComplete
  );
}

export function isValidDesktopCodeChallenge(value: string): boolean {
  return PKCE_CHALLENGE_RE.test(value);
}
