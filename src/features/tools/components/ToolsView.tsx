'use client'

// Compatibility wrapper: extension registry metadata is canonical in @overlay/app-core,
// with transport in @overlay/api-client and reusable presentation in @overlay/modules-react.
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { AllExtensionsComingSoonView, AppsComingSoonView } from '@overlay/modules-react/extensions'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'

const IntegrationsView = dynamic(() => import('@/features/integrations/components/IntegrationsView'))
const SkillsView = dynamic(() => import('@/features/automations/components/SkillsView'))
const McpServersView = dynamic(() => import('@/features/integrations/components/McpServersView'))

export default function ToolsView({ userId }: { userId: string }) {
  const searchParams = useSearchParams()
  const view = searchParams?.get('view') ?? null
  const { capabilities } = useOverlayCapabilities()

  if (view === 'skills' && capabilities.skills) return <SkillsView userId={userId} />
  if (view === 'mcps' && capabilities.mcpServers) return <McpServersView userId={userId} />
  if (view === 'apps') return <AppsComingSoonView />
  if (view === 'all' && (capabilities.skills || capabilities.mcpServers)) return <AllExtensionsComingSoonView />
  if (!capabilities.integrations && capabilities.skills) return <SkillsView userId={userId} />
  if (!capabilities.integrations && capabilities.mcpServers) return <McpServersView userId={userId} />

  return <IntegrationsView userId={userId} title={view === 'connectors' ? 'Connectors' : 'Integrations'} />
}
