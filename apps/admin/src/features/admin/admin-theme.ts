/** The console's light/dark choice lives in a cookie so the server renders the right theme (no inline script under the nonce CSP). */
export const ADMIN_THEME_COOKIE = 'overlay_admin_theme'

export type AdminTheme = 'light' | 'dark'

export function parseAdminTheme(value: string | undefined): AdminTheme {
  return value === 'light' ? 'light' : 'dark'
}
