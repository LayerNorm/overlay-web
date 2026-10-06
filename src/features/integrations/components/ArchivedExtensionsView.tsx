'use client'

import { useCallback, useEffect, useState } from 'react'
import { Archive, Loader2, RotateCcw, Server, Sparkles } from 'lucide-react'
import {
  EXTENSIONS_CHANGED_EVENT,
  MCPS_CHANGED_EVENT,
  SKILLS_CHANGED_EVENT,
  type McpServerSummary,
  type SkillSummary,
} from '@overlay/app-core'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceChanged } from '@/hooks/use-workspace-changed'
import { ScopeTag } from '@/components/layout/ScopeTag'

type ArchivedRow = {
  id: string
  resource: 'skills' | 'mcp-servers'
  kind: string
  name: string
  description?: string
  from: 'personal' | 'workspace'
}

/** Everything archived from Personal or Workspace, across skills and MCP servers, each tagged with where it came from. */
export default function ArchivedExtensionsView() {
  const [rows, setRows] = useState<ArchivedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [skills, servers] = await Promise.all([
        overlayAppClient.skills.get<SkillSummary[]>({ limit: 100, view: 'archived' }),
        overlayAppClient.mcpServers.get<McpServerSummary[]>({ limit: 100, view: 'archived' }),
      ])
      setRows([
        ...(Array.isArray(skills) ? skills : []).map((skill) => ({
          id: skill._id, resource: 'skills' as const, kind: 'Skill', name: skill.name, description: skill.description,
          from: skill.archivedFromScope ?? skill.scope ?? 'personal',
        })),
        ...(Array.isArray(servers) ? servers : []).map((server) => ({
          id: server._id, resource: 'mcp-servers' as const, kind: 'MCP server', name: server.name, description: server.description,
          from: server.archivedFromScope ?? server.scope ?? 'personal',
        })),
      ])
    } catch {
      setError('Could not load archived extensions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  useWorkspaceChanged(load)

  async function restore(row: ArchivedRow) {
    setBusyId(row.id)
    setError(null)
    try {
      await overlayAppClient.scope.restore(row.resource, row.id)
      setRows((current) => current.filter((item) => item.id !== row.id))
      window.dispatchEvent(new CustomEvent(row.resource === 'skills' ? SKILLS_CHANGED_EVENT : MCPS_CHANGED_EVENT))
      window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
    } catch {
      setError('Could not restore that. You may not have access to it.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AppScreenShell header={<AppScreenHeader title="Archived" className="px-6" />}>
      <AppScreenBody padding="none" maxWidth="none" className="h-full">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 size={20} className="animate-spin text-[var(--muted)]" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Archive size={40} strokeWidth={1} className="text-[var(--muted-light)]" />
            <p className="text-sm font-medium text-[var(--foreground)]">Nothing archived</p>
            <p className="text-xs text-[var(--muted-light)]">Skills and MCP servers you archive from Personal or Workspace appear here.</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-1 px-6 py-6">
            {error ? <p role="alert" className="pb-2 text-xs text-red-500">{error}</p> : null}
            {rows.map((row) => {
              const Icon = row.resource === 'skills' ? Sparkles : Server
              return (
                <div key={row.id} className="group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-[var(--surface-subtle)]">
                  <Icon size={15} className="shrink-0 text-[var(--muted)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--foreground)]">{row.name}</p>
                    {row.description ? <p className="truncate text-xs text-[var(--muted-light)]">{row.description}</p> : null}
                  </div>
                  <span className="shrink-0 text-xs text-[var(--muted-light)]">{row.kind}</span>
                  <ScopeTag scope={row.from} />
                  <button
                    type="button"
                    title={`Restore to ${row.from === 'workspace' ? 'Workspace' : 'Personal'}`}
                    aria-label={`Restore ${row.name}`}
                    disabled={busyId === row.id}
                    onClick={() => void restore(row)}
                    className="shrink-0 rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </AppScreenBody>
    </AppScreenShell>
  )
}
