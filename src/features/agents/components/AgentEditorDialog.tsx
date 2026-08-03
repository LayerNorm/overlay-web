'use client'

import { useMemo, useState } from 'react'
import { Bot, Check, ChevronDown } from 'lucide-react'
import { Button, DialogFrame, Input, ListboxSelect } from '@overlay/ui/primitives'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceManagementItem,
} from '@overlay/workspace-contracts'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import {
  getEnabledChatModels,
  getGatewayCatalogRevision,
} from '@/shared/ai/gateway/model-data'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'

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
  const { revision } = useGatewayModelCatalog({ enabled: open })
  const { settings } = useAppSettings()
  const enabledModelIds = settings.enabledChatModelIds
  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [modelId, setModelId] = useState<string>(agent?.modelId ?? DEFAULT_MODEL_ID)
  const [avatarColor, setAvatarColor] = useState(agent?.avatarColor ?? AVATAR_COLORS[0]!)
  const [teamIds, setTeamIds] = useState<string[]>(agent?.teamIds ?? [])
  const [advanced, setAdvanced] = useState(false)

  // Same catalog the personal chat model picker offers: every model the
  // workspace has enabled in settings, not just the curated defaults.
  const modelOptions = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getEnabledChatModels(enabledModelIds, false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => ({ value: model.id, label: model.name }))
  }, [enabledModelIds, revision])

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
              name: name.trim(),
              description: description.trim() || undefined,
              instructions: instructions.trim(),
              harness: 'overlay',
              modelId: modelId.trim(),
              avatarColor,
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
          <label className="block text-xs font-medium">
            Model
            <ListboxSelect
              className="mt-1.5"
              aria-label="Agent model"
              value={modelOptions.some((option) => option.value === modelId) ? modelId : (modelOptions[0]?.value ?? modelId)}
              options={modelOptions.length > 0 ? modelOptions : [{ value: modelId, label: modelId }]}
              onChange={setModelId}
              portal
              buttonClassName="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
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
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
              <p className="text-[11px] leading-4 text-[var(--muted)]">
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
