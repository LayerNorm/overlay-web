import { redirect } from 'next/navigation'
import { DEFAULT_OVERLAY_NAVIGATION, sidebarLandingHref, type AppSettings } from '@overlay/app-core'
import { ROOT_APP_FALLBACK_DESTINATION } from '@/shared/auth/root-entry'
import { getOverlaySession } from '@/server/auth/session'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

/** Opens the first page in the person's sidebar; Work when they never arranged it or the read fails. */
export default async function AppPage() {
  let destination = ROOT_APP_FALLBACK_DESTINATION
  try {
    const session = await getOverlaySession()
    if (session?.user) {
      const settings = await convex.query<AppSettings>('platform/uiSettings:getByServer', {
        userId: session.user.id,
        serverSecret: getInternalApiSecret(),
      })
      destination = sidebarLandingHref(DEFAULT_OVERLAY_NAVIGATION, settings?.sidebarPinnedPageIds, ROOT_APP_FALLBACK_DESTINATION)
    }
  } catch {
    // Work is always a valid place to land.
  }
  redirect(destination)
}
