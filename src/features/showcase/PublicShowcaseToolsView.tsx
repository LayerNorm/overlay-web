'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import type { McpServerSummary, SkillSummary } from '@overlay/app-core'
import { filterConnectorCatalog } from '@overlay/app-core'
import {
  ExtensionPageHeader,
  IntegrationsPanel,
  McpServersPanel,
  SkillsPanel,
} from '@overlay/modules-react/extensions'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import {
  SHOWCASE_CONNECTORS,
  SHOWCASE_MCPS,
  SHOWCASE_SKILLS,
} from './showcase-data'

const timestamp = Date.parse('2026-07-22T18:00:00.000Z')
const skills: SkillSummary[] = SHOWCASE_SKILLS.map(([name, description], index) => ({
  _id: `showcase-skill-${index}`,
  name,
  description,
  instructions: description,
  enabled: true,
  createdAt: timestamp - index * 60_000,
  updatedAt: timestamp - index * 60_000,
}))
const servers: McpServerSummary[] = SHOWCASE_MCPS.map(([name, description], index) => ({
  _id: `showcase-mcp-${index}`,
  name,
  description,
  transport: 'streamable-http',
  url: `https://mcp.getoverlay.ai/${index === 0 ? 'browser' : 'sandbox'}`,
  enabled: true,
  authType: 'bearer',
  hasAuth: true,
  createdAt: timestamp - index * 60_000,
  updatedAt: timestamp - index * 60_000,
}))

export function PublicShowcaseToolsView() {
  const searchParams = useSearchParams()
  const view = searchParams?.get('view') ?? 'connectors'
  const { requireAuth } = useGuestGate()
  const [query, setQuery] = useState('')
  const connected = useMemo(
    () => filterConnectorCatalog(SHOWCASE_CONNECTORS.filter((item) => item.isConnected), query),
    [query],
  )
  const available = useMemo(
    () => filterConnectorCatalog(SHOWCASE_CONNECTORS.filter((item) => !item.isConnected), query),
    [query],
  )
  const gate = () => requireAuth('nav')
  const gateToggle = (_item: unknown, event?: MouseEvent) => {
    event?.stopPropagation()
    gate()
  }

  const title = view === 'skills' ? 'Skills' : view === 'mcps' ? 'MCP Servers' : 'Integrations'
  return (
    <AppScreenShell
      header={(
        <ExtensionPageHeader
          title={title}
          searchQuery={query}
          searchPlaceholder={`Search ${title.toLowerCase()}…`}
          searchTitle={`Search ${title.toLowerCase()}`}
          onSearchQueryChange={setQuery}
        />
      )}
    >
      {view === 'skills' ? (
        <SkillsPanel
          loading={false}
          skills={skills}
          filteredSkills={skills.filter((skill) => skill.name.toLowerCase().includes(query.toLowerCase()))}
          onCreate={gate}
          onEdit={gate}
          onToggle={gateToggle}
        />
      ) : view === 'mcps' ? (
        <McpServersPanel
          loading={false}
          servers={servers}
          filteredServers={servers.filter((server) => server.name.toLowerCase().includes(query.toLowerCase()))}
          onCreate={gate}
          onEdit={gate}
          onToggle={gateToggle}
        />
      ) : (
        <IntegrationsPanel
          loading={false}
          loadingFallback={null}
          connectedRows={connected}
          availableRows={available}
          connectedVisible={20}
          availableVisible={20}
          onClearError={() => {}}
          onConnectToggle={gate}
          onShowMoreConnected={() => {}}
          onShowMoreAvailable={() => {}}
          onOpenCatalog={gate}
        />
      )}
    </AppScreenShell>
  )
}
