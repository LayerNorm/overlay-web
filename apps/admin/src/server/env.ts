import 'server-only'

/**
 * Environment access for the admin app. Plain language:
 *
 * - `ADMIN_CONVEX_SECRET` — shared secret the admin app presents to the Convex
 *   admin functions (`admin/*ByServer`). In local dev this is the engineer dev
 *   backend's INTERNAL_API_SECRET value; in Stage 3 deployment it becomes the
 *   dedicated `ADMIN_API_SECRET` deployed on the Convex side.
 * - `ADMIN_SESSION_SECRET` — HMAC key for the `__Host-overlay_admin_session`
 *   cookie. Separate from the web app's SESSION_SECRET.
 * - `ADMIN_ALLOWED_USER_IDS` — first gate after sign-in: comma-separated
 *   WorkOS user ids allowed to reach the console at all.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required admin environment variable ${name}.`)
  }
  return value
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

export function allowedAdminUserIds(): string[] {
  return (optionalEnv('ADMIN_ALLOWED_USER_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export function workosClientId(): string {
  return requiredEnv('WORKOS_CLIENT_ID')
}

export function workosApiKey(): string {
  return requiredEnv('WORKOS_API_KEY')
}
