import { getOverlaySession } from '@/server/auth/session'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'
import overlayAppConfig from '@/overlay.config'
import {
  resolveFeatureModuleForPath,
  resolveOverlayAppShellConfig,
} from '@overlay/app-core'
import { renderExtensionComponent } from '@/extensions/registry'
import { notFound, redirect } from 'next/navigation'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

type ExtensionPageParams = {
  slug?: string[]
}

function extensionPathname(slug: readonly string[]): string {
  return slug.length > 0 ? `/app/x/${slug.join('/')}` : '/app/x'
}

export default async function ExtensionPage({
  params,
}: {
  params: Promise<ExtensionPageParams>
}) {
  const session = await getOverlaySession()
  if (!session) redirect('/app/chat?signin=nav')

  const { slug = [] } = await params
  const pathname = extensionPathname(slug)
  const capabilities = getOverlayCapabilitiesSync()
  const appShell = resolveOverlayAppShellConfig(overlayAppConfig, { capabilities })
  const featureModule = resolveFeatureModuleForPath(pathname, appShell.featureModules)
  if (!featureModule) notFound()

  const rendered = renderExtensionComponent(featureModule.componentKey, {
    featureModule,
    pathname,
    slug,
  })
  if (!rendered) notFound()

  return rendered
}
