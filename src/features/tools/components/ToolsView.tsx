'use client'

// Compatibility wrapper: extension registry metadata is canonical in @overlay/app-core,
// with transport in @overlay/api-client and reusable presentation in @overlay/modules-react.
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { AllExtensionsComingSoonView, ExtensionCatalogPageSkeleton } from '@overlay/modules-react/extensions'
import { ExtensionsScreen } from '@/components/layout/extensions/ExtensionsScreen'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { usePanelScope } from '@/hooks/use-panel-scope'

/** While a view's code loads: its screen and catalog page, with placeholder rows (the same skeleton the view shows for data). */
function catalogLoading(title: string, noun: string, add = true) {
  return function CatalogLoading() {
    return (
      <ExtensionsScreen title={title} overviewHref="/app/tools">
        <ExtensionCatalogPageSkeleton title={title} noun={noun} add={add} />
      </ExtensionsScreen>
    )
  }
}

const IntegrationsView = dynamic(() => import('@/features/integrations/components/IntegrationsView'), { loading: catalogLoading('Connectors', 'connectors') })
const SkillsView = dynamic(() => import('@/features/automations/components/SkillsView'), { loading: catalogLoading('Skills', 'skills') })
const McpServersView = dynamic(() => import('@/features/integrations/components/McpServersView'), { loading: catalogLoading('MCPs', 'MCP servers') })
const AppsView = dynamic(() => import('@/features/tools/components/AppsView'), { loading: catalogLoading('Apps', 'apps', false) })

export default function ToolsView({ userId }: { userId: string }) {
  const searchParams = useSearchParams()
  const view = searchParams?.get('view') ?? null
  const { capabilities } = useOverlayCapabilities()
  const scope = usePanelScope()

  if (view === 'skills' && capabilities.skills) return <SkillsView userId={userId} />
  if (view === 'mcps' && capabilities.mcpServers) return <McpServersView userId={userId} />
  if (view === 'apps') return <AppsView />
  if (view === 'all' && (capabilities.skills || capabilities.mcpServers)) return <AllExtensionsComingSoonView />
  if (!capabilities.integrations && capabilities.skills) return <SkillsView userId={userId} />
  if (!capabilities.integrations && capabilities.mcpServers) return <McpServersView userId={userId} />

  // A fresh view per scope: the personal and workspace accounts are different lists.
  return <IntegrationsView key={scope} userId={userId} />
}
