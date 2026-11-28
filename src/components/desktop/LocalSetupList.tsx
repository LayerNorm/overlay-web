'use client'

import { useCallback, useEffect, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { cn } from '@overlay/ui'
import { Button, Checkbox } from '@overlay/ui/primitives'
import { ProviderLogo } from '@overlay/ui/ai'
import type { DesktopBridge, LocalSetupImportResult, LocalSetupItem, LocalSetupScan } from '@overlay/desktop-bridge'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { AGENT_TOOL_PRESETS, toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'
import { useDesktopBridge } from './DesktopProvider'

/**
 * What other AI tools keep on this computer (Claude Code, Codex, Claude Desktop, Cursor, Gemini CLI), as found by the
 * desktop app's `localSetup` scan, with a tick per item. Used by desktop setup's "Bring your setup" step and by
 * Settings → Import. The desktop app reads the ticked items again and imports them; their contents never pass here.
 */

const APP_LOGOS: Record<string, string> = {
  claude_code: '/assets/svg/landing/claude.svg', claude_desktop: '/assets/svg/landing/claude.svg',
  codex: '/assets/svg/landing/openai.svg', cursor: '/assets/svg/landing/cursor.svg',
}
const KIND_TARGET = { instructions: 'Memories', skill: 'Skills', agent: 'Agents', mcp_remote: 'MCP server', mcp_local: 'This computer' } as const
const EMPTY_SCAN: LocalSetupScan = { apps: [], shellKeys: [], subscriptions: { claude: false, chatgpt: false } }

function AppLogo({ id }: { id: string }) {
  if (id === 'gemini_cli') return <ProviderLogo provider="google" size={18} />
  // Monochrome marks follow the theme.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={APP_LOGOS[id]} alt="" className={`size-[18px] ${id === 'codex' || id === 'cursor' ? 'dark:invert' : ''}`} />
}

/** Everything that can come over starts ticked, except servers that send a token (a choice) and what is already in. */
const startsTicked = (item: LocalSetupItem) => item.importable && !item.imported && !item.detail.includes('header token')

/** The scan, the ticks and the import, for one workspace. */
export function useLocalSetupImport(workspaceId: string | null | undefined) {
  const desktop = useDesktopBridge()
  const bridge: DesktopBridge | null = desktop?.info.capabilities.includes('localSetup') ? desktop.bridge : null
  const [scan, setScan] = useState<LocalSetupScan | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LocalSetupImportResult | null>(null)

  const rescan = useCallback(async () => {
    if (!bridge || !workspaceId) return
    try {
      const value = await bridge.call('localSetup.scan', { workspaceId })
      setScan(value)
      setPicked(new Set(value.apps.flatMap((app) => app.items.filter(startsTicked).map((item) => item.id))))
    } catch {
      setScan(EMPTY_SCAN)
    }
  }, [bridge, workspaceId])

  useEffect(() => { void rescan() }, [rescan])

  const toggle = useCallback((id: string, on: boolean) => setPicked((current) => {
    const next = new Set(current)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }), [])

  /** Imports the ticked items; true when all of them came over. Failed ones stay ticked for a retry. */
  const importPicked = useCallback(async (): Promise<boolean> => {
    if (!bridge || !workspaceId || !picked.size) return true
    setBusy(true)
    setError(null)
    try {
      const done = await bridge.call('localSetup.import', {
        workspaceId, itemIds: [...picked],
        // New agents start like any agent made in the web app.
        agentDefaults: { modelId: DEFAULT_MODEL_ID, allowedToolIds: toolIdsForEnabledGroups(new Set(AGENT_TOOL_PRESETS.everything.filter((group) => group !== 'computer'))) },
      })
      setResult(done)
      // Shows what came over as imported; what failed is still offered, ticked.
      await rescan()
      return !done.failed.length
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not import. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }, [bridge, picked, rescan, workspaceId])

  return { available: Boolean(bridge), scan, picked, toggle, busy, error, result, importPicked, rescan }
}

export function LocalSetupList({ scan, picked, busy, onToggle, className = '' }: {
  scan: LocalSetupScan
  picked: ReadonlySet<string>
  busy: boolean
  onToggle(id: string, on: boolean): void
  className?: string
}) {
  const [open, setOpen] = useState<string | null>(() => scan.apps[0]?.id ?? null)
  return (
    <div className={cn('divide-y divide-(--border) overflow-hidden rounded-[10px] border border-(--border) bg-(--surface-elevated)', className)}>
      {scan.apps.map((app) => {
        const count = app.items.filter((item) => picked.has(item.id)).length
        const expanded = open === app.id
        return <div key={app.id}>
          <Button variant="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : app.id)}
            className="h-auto w-full justify-start gap-3 rounded-none px-3.5 py-3 text-left font-normal text-foreground hover:bg-(--surface-subtle)">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--surface-subtle)"><AppLogo id={app.id} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{app.name}</span><span className="block truncate font-mono text-xs text-(--muted)">{app.location}</span></span>
            <span className="text-xs text-(--muted)">{count ? `${count} of ${app.items.length}` : `${app.items.length} found`}</span>
          </Button>
          {expanded ? <div className="pb-2.5 pl-[58px] pr-3.5">
            {app.items.map((item) => {
              const available = item.importable && !item.imported
              return (
                <label key={item.id} className={`flex items-center gap-2.5 py-1.5 text-[13px] ${available ? 'cursor-pointer' : ''}`}>
                  <Checkbox checked={picked.has(item.id) || Boolean(item.imported)} disabled={!available || busy}
                    onCheckedChange={(value) => onToggle(item.id, value === true)} aria-label={`Import ${item.name}`} />
                  <span className={`min-w-0 flex-1 ${available ? '' : 'text-(--muted)'}`}>{item.name}<span className="block truncate text-xs text-(--muted)">{item.detail}</span></span>
                  {item.imported
                    ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--muted)"><CircleCheck size={14} className="text-emerald-500" />Imported</span>
                    : item.importable
                      ? <span className="whitespace-nowrap text-xs text-(--muted)">{KIND_TARGET[item.kind]}</span>
                      : <span className="whitespace-nowrap rounded-full border border-(--border) px-2 py-0.5 text-[11px] text-(--muted)">{item.kind === 'mcp_local' ? 'Coming later' : 'Not supported'}</span>}
                </label>
              )
            })}
          </div> : null}
        </div>
      })}
    </div>
  )
}
