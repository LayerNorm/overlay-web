'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, FolderUp, Terminal } from 'lucide-react'
import type { AgentProfileImportCodeResource, AgentProfileResource, AgentProfileStateResource } from '@overlay/api-client'
import { Button } from '@overlay/ui/primitives'
import { AGENT_PROFILE_TOP_LEVEL, AGENT_PROFILE_LIMITS } from '@layernorm/overlay-agent-bridge-protocol'
import { useEditorLoad } from './EditorLoadGate'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { FieldLabel } from './InfoTip'

const POLL_WAITING_MS = 2_500
const POLL_IDLE_MS = 20_000
const INPUT = 'w-full rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-[var(--foreground)]'

type Harness = 'claude-code' | 'codex'

function describe(profile: AgentProfileResource): string {
  const s = profile.summary
  if (!s) return 'Waiting for the upload'
  const parts = [
    s.skills ? `${s.skills} skill${s.skills === 1 ? '' : 's'}` : '',
    s.commands ? `${s.commands} command${s.commands === 1 ? '' : 's'}` : '',
    s.subagents ? `${s.subagents} subagent${s.subagents === 1 ? '' : 's'}` : '',
    s.prompts ? `${s.prompts} prompt${s.prompts === 1 ? '' : 's'}` : '',
    s.outputStyles ? `${s.outputStyles} output style${s.outputStyles === 1 ? '' : 's'}` : '',
    s.mcpServers ? `${s.mcpServers} MCP server${s.mcpServers === 1 ? '' : 's'}` : '',
    s.claudeMd ? 'CLAUDE.md' : '',
    s.agentsMd ? 'AGENTS.md' : '',
    s.settings ? 'settings' : '',
  ].filter(Boolean)
  return parts.join(' · ') || 'Nothing importable'
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).blob()
}

/** Reads the allowlisted files of a picked ~/.claude or ~/.codex folder; the server cleans them again before storing. */
async function readFolder(files: FileList, harness: Harness) {
  const allowed = new Set(AGENT_PROFILE_TOP_LEVEL[harness])
  const picked: Array<{ path: string; content: string }> = []
  let total = 0
  for (const file of Array.from(files)) {
    const parts = (file.webkitRelativePath || file.name).split('/').slice(1)
    if (parts.length === 0 || !allowed.has(parts[0] ?? '')) continue
    if (parts.includes('node_modules') || parts.includes('.git')) continue
    if (file.size > AGENT_PROFILE_LIMITS.maxFileBytes || total + file.size > AGENT_PROFILE_LIMITS.maxTotalBytes) continue
    const content = await file.text()
    if (content.includes('\u0000')) continue
    total += file.size
    picked.push({ path: parts.join('/'), content })
    if (picked.length >= AGENT_PROFILE_LIMITS.maxFiles) break
  }
  return picked
}

/**
 * The Claude Code / Codex config this agent runs with: skills, commands, subagents, MCP servers, instructions.
 * Imported from the person's own machine (never credentials or history), reviewed, then applied to the agent's machine.
 */
export function CloudAgentConfig({ agentId, harness }: { agentId: string; harness: Harness }) {
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const [state, setState] = useState<AgentProfileStateResource | null>(null)
  const [code, setCode] = useState<AgentProfileImportCodeResource | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [hooksOn, setHooksOn] = useState(false)
  const [showDropped, setShowDropped] = useState(false)
  const folderRef = useRef<HTMLInputElement>(null)
  useEditorLoad(state === null && error === null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try { setState(await overlayAppClient.agentProfiles.state(workspaceId, agentId)); setError(null) }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Could not load the config.') }
  }, [workspaceId, agentId])

  const staged = state?.profiles.find((profile) => profile.status === 'staged') ?? null
  const active = state?.profiles.find((profile) => profile.status === 'active') ?? null
  const waiting = code !== null && !staged

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), waiting ? POLL_WAITING_MS : POLL_IDLE_MS)
    return () => window.clearInterval(timer)
  }, [load, waiting])

  useEffect(() => { if (staged) setCode(null) }, [staged])
  useEffect(() => { setHooksOn(staged?.hooksEnabled ?? false) }, [staged?.id, staged?.hooksEnabled])

  const run = async (label: string, task: () => Promise<unknown>) => {
    if (busy) return
    setBusy(label)
    setError(null)
    try { await task(); await load() }
    catch (taskError) { setError(taskError instanceof Error ? taskError.message : 'That did not work. Try again.') }
    finally { setBusy(null) }
  }

  const startImport = () => run('code', async () => {
    if (!workspaceId) return
    setCode(await overlayAppClient.agentProfiles.createImportCode(workspaceId, agentId, harness))
  })

  const upload = (files: FileList | null) => {
    if (!files || files.length === 0) return
    void run('upload', async () => {
      if (!workspaceId) return
      const created = code ?? await overlayAppClient.agentProfiles.createImportCode(workspaceId, agentId, harness)
      setCode(created)
      const picked = await readFolder(files, harness)
      if (picked.length === 0) throw new Error(`That folder has none of the files we import (${AGENT_PROFILE_TOP_LEVEL[harness].join(', ')}). Pick your ${harness === 'codex' ? '.codex' : '.claude'} folder.`)
      const body = await gzip(JSON.stringify({ harness, files: picked }))
      const response = await fetch(created.uploadUrl.replace(/^https?:\/\/[^/]+/, ''), {
        method: 'POST', headers: { Authorization: `Bearer ${created.code}`, 'Content-Type': 'application/gzip' }, body,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error ?? 'The upload did not go through.')
      }
    })
  }

  const copy = async () => {
    if (!code) return
    try { await navigator.clipboard.writeText(code.command); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }
    catch { /* clipboard blocked: the command is selectable */ }
  }

  const missing = (state?.secrets ?? []).filter((secret) => !secret.set)
  const wantsSecrets = staged && (staged.meta?.secrets.length ?? 0) > 0
  const history = (state?.profiles ?? []).filter((profile) => profile.status === 'superseded')

  return (
    <div>
      <FieldLabel info="Your Claude Code or Codex setup: instructions, skills, commands, subagents, and MCP servers. Passwords, tokens, and chat history are never copied.">
        Config
      </FieldLabel>
      <div className="space-y-2.5 rounded-xl border border-[var(--border)] p-3">
        {active ? (
          <p className="text-xs text-[var(--muted)]">
            <span className="font-medium text-[var(--foreground)]">Version {active.version}</span> is on the machine — {describe(active)}
          </p>
        ) : !staged ? <p className="text-xs text-[var(--muted)]">Nothing imported yet. This agent uses a clean setup.</p> : null}

        {!staged ? (
          <>
            {code ? (
              <div className="space-y-1.5">
                <p className="text-[11px] leading-4 text-[var(--muted)]">Run this in a terminal on the computer that has your setup. It lists what it found before sending anything. Expires in 15 minutes.</p>
                <div className="flex items-start gap-1.5">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-[var(--surface-subtle)] px-2 py-1.5 text-[11px] leading-4">{code.command}</code>
                  <Button variant="secondary" size="sm" onClick={() => void copy()} aria-label="Copy command"><Copy size={13} />{copied ? 'Copied' : 'Copy'}</Button>
                </div>
                <p className="text-[11px] text-[var(--muted)]" role="status">Waiting for your computer…</p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" className="w-full" disabled={busy !== null} onClick={() => void startImport()}>
                <Terminal size={13} />{busy === 'code' ? 'Preparing…' : code ? 'New command' : 'From your computer'}
              </Button>
              <Button variant="secondary" size="sm" className="w-full" disabled={busy !== null} onClick={() => folderRef.current?.click()}>
                <FolderUp size={13} />{busy === 'upload' ? 'Uploading…' : 'Upload folder'}
              </Button>
              <input
                ref={folderRef} type="file" className="hidden" multiple aria-label="Choose a config folder"
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(event) => { upload(event.target.files); event.target.value = '' }}
              />
            </div>
          </>
        ) : (
          <div className="space-y-2.5">
            <div>
              <p className="text-xs font-medium">Ready to review</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{describe(staged)}</p>
              {staged.meta?.mcpServers.length ? <p className="mt-0.5 text-[11px] text-[var(--muted)]">MCP servers: {staged.meta.mcpServers.join(', ')}</p> : null}
            </div>

            {staged.meta?.warnings.length ? (
              <ul className="space-y-0.5 text-[11px] leading-4 text-amber-600">
                {staged.meta.warnings.slice(0, 8).map((warning) => <li key={`${warning.path}:${warning.message}`}>{warning.path}: {warning.message}</li>)}
              </ul>
            ) : null}

            {wantsSecrets ? (
              <div className="space-y-1.5">
                <p className="text-[11px] leading-4 text-[var(--muted)]">These servers need values we did not copy. Add them here; they are stored encrypted and given to the agent only while it runs.</p>
                {state?.secrets.map((secret) => (
                  <div key={secret.name} className="flex items-center gap-1.5">
                    <span className="w-40 shrink-0 truncate text-[11px] font-mono" title={secret.usedBy}>{secret.name}</span>
                    {secret.set ? (
                      <>
                        <span className="min-w-0 flex-1 text-[11px] text-emerald-600">Set</span>
                        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void run('secret', () => overlayAppClient.agentProfiles.deleteSecret(workspaceId!, agentId, secret.name))}>Remove</Button>
                      </>
                    ) : (
                      <>
                        <input
                          type="password" autoComplete="off" className={INPUT} placeholder="Value" aria-label={`${secret.name} value`}
                          value={secretValues[secret.name] ?? ''} onChange={(event) => setSecretValues((current) => ({ ...current, [secret.name]: event.target.value }))}
                        />
                        <Button
                          variant="secondary" size="sm" disabled={busy !== null || !(secretValues[secret.name] ?? '').trim()}
                          onClick={() => void run('secret', async () => {
                            await overlayAppClient.agentProfiles.setSecret(workspaceId!, agentId, secret.name, secretValues[secret.name]!.trim())
                            setSecretValues((current) => { const next = { ...current }; delete next[secret.name]; return next })
                          })}
                        >Save</Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {staged.meta?.hooks.length ? (
              <label className="flex items-start gap-2 text-[11px] leading-4">
                <input
                  type="checkbox" className="mt-0.5" checked={hooksOn}
                  onChange={(event) => setHooksOn(event.target.checked)}
                />
                <span>
                  Also turn on {staged.meta.hooks.length} command{staged.meta.hooks.length === 1 ? '' : 's'} that run automatically
                  <span className="block text-[var(--muted)]">{staged.meta.hooks.slice(0, 4).map((hook) => `${hook.event}: ${hook.command}`).join(' · ')}</span>
                </span>
              </label>
            ) : null}

            {staged.summary?.dropped ? (
              <div>
                <button type="button" className="text-[11px] text-[var(--muted)] underline-offset-2 hover:underline" onClick={() => setShowDropped((value) => !value)}>
                  {staged.summary.dropped} item{staged.summary.dropped === 1 ? '' : 's'} left out {showDropped ? '(hide)' : '(show)'}
                </button>
                {showDropped ? (
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11px] leading-4 text-[var(--muted)]">
                    {staged.meta?.dropped.map((drop) => <li key={`${drop.path}:${drop.reason}`}><span className="font-mono">{drop.path}</span> — {drop.reason}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => void run('apply', () => overlayAppClient.agentProfiles.apply(workspaceId!, agentId, staged.id, hooksOn))}>
                {busy === 'apply' ? 'Applying…' : missing.length ? 'Apply (some values missing)' : 'Apply to the machine'}
              </Button>
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void run('discard', () => overlayAppClient.agentProfiles.discard(workspaceId!, agentId, staged.id))}>Discard</Button>
            </div>
          </div>
        )}

        {active && !staged && (active.meta?.hooks.length ?? 0) > 0 ? (
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox" checked={active.hooksEnabled} disabled={busy !== null}
              onChange={(event) => void run('hooks', async () => {
                await overlayAppClient.agentProfiles.setHooks(workspaceId!, agentId, active.id, event.target.checked)
                await overlayAppClient.agentProfiles.apply(workspaceId!, agentId, active.id, event.target.checked)
              })}
            />
            Run imported hooks and commands
          </label>
        ) : null}

        {history.length > 0 && !staged ? (
          <details className="text-[11px] text-[var(--muted)]">
            <summary className="cursor-pointer">Earlier versions</summary>
            <ul className="mt-1 space-y-1">
              {history.map((profile) => (
                <li key={profile.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">Version {profile.version} — {describe(profile)}</span>
                  <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void run('restore', () => overlayAppClient.agentProfiles.apply(workspaceId!, agentId, profile.id))}>Restore</Button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
      </div>
    </div>
  )
}
