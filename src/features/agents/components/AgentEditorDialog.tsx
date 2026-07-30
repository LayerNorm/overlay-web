'use client'

import { useState } from 'react'
import { Bot, Check, ChevronDown } from 'lucide-react'
import { Button, DialogFrame, Input } from '@overlay/ui/primitives'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceManagementItem,
} from '@overlay/workspace-contracts'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'

const AVATAR_COLORS = ['#64748b', '#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626']

export function AgentEditorDialog({
  open,
  agent,
  teams,
  busy,
  error,
  onOpenChange,
  onSave,
  onArchive,
}: {
  open: boolean
  agent?: WorkspaceAgentDirectoryItem | null
  teams: WorkspaceManagementItem[]
  busy: boolean
  error: string | null
  onOpenChange(open: boolean): void
  onSave(input: WorkspaceAgentCreateInput): void
  onArchive?(): void
}) {
  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [harness, setHarness] = useState<'overlay' | 'claude-code'>(agent?.harness ?? 'overlay')
  const [modelId, setModelId] = useState<string>(agent?.modelId ?? DEFAULT_MODEL_ID)
  const [avatarColor, setAvatarColor] = useState(agent?.avatarColor ?? AVATAR_COLORS[0]!)
  const [teamIds, setTeamIds] = useState<string[]>(agent?.teamIds ?? [])
  const [advanced, setAdvanced] = useState(false)

  const valid = name.trim() && instructions.trim() && modelId.trim()
  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      className="max-h-[92vh] !w-[min(760px,94vw)] overflow-y-auto"
      title={agent ? `Edit ${agent.name}` : 'Create agent'}
      description="Give this workspace a named teammate with a clear job and its own identity."
      footer={(
        <>
          {agent && onArchive ? <Button variant="danger" onClick={onArchive} disabled={busy}>Archive agent</Button> : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            variant="secondary"
            disabled={busy || !valid}
            onClick={() => onSave({
              name: name.trim(), description: description.trim() || undefined,
              instructions: instructions.trim(), harness, modelId: modelId.trim(), avatarColor,
              teamIds,
            })}
          >
            {busy ? 'Saving…' : agent ? 'Save changes' : 'Create agent'}
          </Button>
        </>
      )}
    >
      <div className="mt-5 grid gap-5 sm:grid-cols-[112px_minmax(0,1fr)]">
        <div>
          <div
            className="flex h-28 w-28 items-center justify-center rounded-full border border-[var(--border)] text-white shadow-sm"
            style={{ backgroundColor: avatarColor }}
          >
            <Bot size={38} strokeWidth={1.5} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {AVATAR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color}`}
                onClick={() => setAvatarColor(color)}
                className="flex h-7 items-center justify-center rounded-md border border-[var(--border)]"
                style={{ backgroundColor: color }}
              >
                {avatarColor === color ? <Check size={12} className="text-white" /> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <label className="block text-xs font-medium">
            Agent name
            <Input autoFocus className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} placeholder="Research partner" />
          </label>
          <label className="block text-xs font-medium">
            Short description <span className="font-normal text-[var(--muted-light)]">optional</span>
            <Input className="mt-1.5" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Finds evidence and challenges assumptions" />
          </label>
          <label className="block text-xs font-medium">
            Agent instructions
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Describe what this agent should do, how it should respond, and when it should stop."
              className="mt-1.5 min-h-36 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-5 outline-none focus:border-[var(--muted)]"
            />
          </label>
          {teams.length ? (
            <div>
              <p className="text-xs font-medium">Agent teams</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {teams.map((team) => {
                  const selected = teamIds.includes(team.id)
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => setTeamIds((current) => selected ? current.filter((id) => id !== team.id) : [...current, team.id])}
                      className={`rounded-full border px-3 py-1.5 text-xs ${selected ? 'border-[var(--foreground)] bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'border-[var(--border)] text-[var(--muted)]'}`}
                    >
                      {team.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          <button type="button" onClick={() => setAdvanced((value) => !value)} className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            Advanced <ChevronDown size={13} className={advanced ? 'rotate-180' : ''} />
          </button>
          {advanced ? (
            <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 sm:grid-cols-2">
              <label className="text-xs font-medium">
                Harness
                <select value={harness} onChange={(event) => setHarness(event.target.value as typeof harness)} className="mt-1.5 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs">
                  <option value="overlay">Overlay</option>
                  <option value="claude-code">Claude Code</option>
                </select>
              </label>
              <label className="text-xs font-medium">
                Model ID
                <Input className="mt-1.5" value={modelId} onChange={(event) => setModelId(event.target.value)} />
              </label>
              <p className="sm:col-span-2 text-[11px] leading-4 text-[var(--muted)]">
                Mention-first is enforced. One-to-one agent DMs invoke implicitly; channels and group DMs require a human mention or reply in the agent’s thread.
              </p>
            </div>
          ) : null}
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
      </div>
    </DialogFrame>
  )
}
