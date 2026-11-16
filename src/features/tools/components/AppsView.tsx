'use client'

import { Package } from 'lucide-react'
import { ExtensionCatalogPage } from '@overlay/modules-react/extensions'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { ExtensionsScreen } from '@/components/layout/extensions/ExtensionsScreen'
import { useExtensionsRoute } from '@/hooks/use-extensions-route'

/** Apps are not available yet; the page shares the catalog layout so it fills in like the other Extensions pages. */
export default function AppsView() {
  const scope = usePanelScope()
  const route = useExtensionsRoute()
  return (
    <ExtensionsScreen title="Apps" overviewHref={route.overviewHref}>
      <ExtensionCatalogPage
        title="Apps"
        subtitle="Small apps that run inside your workspace."
        noun="apps"
        icon={Package}
        yoursLabel={scope === 'workspace' ? 'Workspace' : 'Yours'}
        browse={[]}
        yours={[]}
        browseEmpty={{ title: 'Apps are on the way', body: 'Apps will appear here in the same list as connectors, skills and MCPs.' }}
        yoursEmpty={{ title: 'No apps yet', body: 'Apps you add or build will appear here.' }}
        category={null}
        onCategoryChange={route.openCategory}
        noResults={{ body: 'There are no apps yet.' }}
      />
    </ExtensionsScreen>
  )
}
