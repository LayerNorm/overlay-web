/** Issuer for short-lived browser→Convex subscription tokens. */
export const BROWSER_CONVEX_TOKEN_ISS = 'overlay-browser-convex'

/** Audience bound to Convex query/mutation access checks. */
export const BROWSER_CONVEX_TOKEN_AUD = 'overlay-convex'

/**
 * Browser tokens refresh every ~4 minutes from ConvexAuthProvider.
 * Keep TTL longer than that refresh interval so mid-flight queries stay valid.
 */
export const BROWSER_CONVEX_TOKEN_TTL_MS = 10 * 60 * 1000
