/**
 * The web app the side panel frames. Production builds use overlay.works; preview QA and local development build with
 * `VITE_OVERLAY_APP_ORIGIN` set to `https://pr-<n>.preview.overlay.works` or `http://localhost:3000`.
 */
export function resolveAppOrigin(configured: string | undefined): string {
  const origin = new URL(configured?.trim() || 'https://overlay.works').origin
  if (!origin.startsWith('https://') && !/^http:\/\/localhost(?::\d+)?$/.test(origin)) {
    throw new Error(`The side panel must frame an https origin or localhost, not ${origin}.`)
  }
  return origin
}

export const APP_ORIGIN = resolveAppOrigin(import.meta.env.VITE_OVERLAY_APP_ORIGIN)
