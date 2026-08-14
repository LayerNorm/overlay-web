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
import {
  AGENT_TOOL_GROUPS,
  enabledAgentToolGroupIds,
  toolIdsForEnabledGroups,
} from '@/shared/agents/tool-groups'

const AVATAR_COLORS = ['#64748b', '#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626']

export function AgentEditorDialog({
  open,
  agent,
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
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(
    () => enabledAgentToolGroupIds(agent?.allowedToolIds ?? []),
  )
  const [advanced, setAdvanced] = useState(false)

  const toggleToolGroup = (groupId: string) => {
    setEnabledToolGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // Same catalog the personal chat model picker offers: every model the
  // workspace has enabled in settings, not just the curated defaults.
  const modelOptions = useMemo(() => {
    void revision
    void getGatewayCatalogRevision()
    return getEnabledChatModels(enabledModelIds, false)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
      .map((model) => ({ value: model.id, label: model.name }))
  }, [enabledModelIds, revision])

  const isDefaultMaster = Boolean(agent?.isDefault || agent?.name.toLowerCase() === 'overlay')
  const valid = name.trim() && instructions.trim() && modelId.trim()
  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      className="max-h-[92vh] !w-[min(760px,94vw)] overflow-y-auto"
      title={agent ? `Edit ${agent.name}` : 'Create agent'}
      description={isDefaultMaster ? 'Master workspace agent with full access to workspace context, memory, and tools (cannot be deleted).' : 'Give this workspace a named teammate with a clear job and its own identity.'}
      footer={(
        <>
          {agent && onArchive && !isDefaultMaster ? <Button variant="danger" onClick={onArchive} disabled={busy}>Archive agent</Button> : null}
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
              allowedToolIds: toolIdsForEnabledGroups(enabledToolGroups),
              teamIds: agent?.teamIds ?? [],
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
          <div>
            <p className="text-xs font-medium">Tools</p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">
              Grant this agent the same tools the personal chat can use. It only acts on what you enable here.
            </p>
            <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {AGENT_TOOL_GROUPS.map((group) => {
                const active = enabledToolGroups.has(group.id)
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="switch"
                    aria-checked={active}
                    onClick={() => toggleToolGroup(group.id)}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                      active
                        ? 'border-[var(--muted)] bg-[var(--surface-subtle)]'
                        : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        active ? 'border-[var(--muted)] bg-[var(--muted)] text-[var(--background)]' : 'border-[var(--border)]'
                      }`}
                    >
                      {active ? <Check size={11} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-[var(--foreground)]">{group.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">{group.description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
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
