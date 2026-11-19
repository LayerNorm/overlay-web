'use client'

import {
  BookOpen,
  Blocks,
  Bot,
  FileText,
  Globe,
  ImagePlay,
  Link2,
  Laptop,
  ListChecks,
  Monitor,
  Sparkles,
  Workflow,
  Wrench,
} from 'lucide-react'
import { Toggle, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@overlay/ui/primitives'
import {
  AccessSelector,
  AgentComputerSection,
  AgentMemoriesSection,
  DangerZone,
  OverlayAgentPermissionsField,
} from './AgentEditorForm'
import { AgentSurfacesField } from './AgentSurfacesField'
import { AGENT_TOOL_GROUPS } from '@/shared/agents/tool-groups'
import type { ReactNode } from 'react'
import type { useAgentEditorController } from './AgentEditorPage'

type Controller = ReturnType<typeof useAgentEditorController>

const toolIcons: Record<string, typeof Wrench> = {
  memory: BookOpen,
  files: FileText,
  web_search: Globe,
  integrations: Link2,
  mcp: Blocks,
  skills: Sparkles,
  automations: Workflow,
  tasks: ListChecks,
  media: ImagePlay,
  computer: Monitor,
  local_computer: Laptop,
  agents: Bot,
}

const toolLabels: Record<string, string> = {
  memory: 'Memory',
  files: 'Files',
  web_search: 'Web search',
  integrations: 'Connected apps',
  mcp: 'MCP servers',
  skills: 'Skills',
  automations: 'Automations',
  tasks: 'Tasks',
  media: 'Media generation',
  computer: 'Cloud computer',
  local_computer: 'Local computer',
  agents: 'Agents',
}

function visibleToolGroups(computersAvailable: boolean) {
  return computersAvailable
    ? AGENT_TOOL_GROUPS
    : AGENT_TOOL_GROUPS.filter((group) => group.id !== 'computer')
}

export function getEnabledToolGroupCount(editor: Controller) {
  return visibleToolGroups(editor.computersAvailable)
    .filter((group) => editor.form.enabledToolGroups.has(group.id))
    .length
}

export function AgentSidebarTools({ editor }: { editor: Controller }) {
  const toolGroups = visibleToolGroups(editor.computersAvailable)

  return (
    <div className="rounded-[10px] bg-(--surface-subtle) p-1">
      <TooltipProvider>
        {toolGroups.map((group) => {
          const Icon = toolIcons[group.id] ?? Wrench
          return (
            <div key={group.id} className="flex h-[38px] items-center gap-2.5 rounded-md px-2">
              <Icon size={15} className="shrink-0 text-(--muted)" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="min-w-0 flex-1 truncate text-xs text-(--foreground)">
                    {toolLabels[group.id] ?? group.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{group.description}</TooltipContent>
              </Tooltip>
              <Toggle
                checked={editor.form.enabledToolGroups.has(group.id)}
                onCheckedChange={() => editor.form.toggleToolGroup(group.id)}
                aria-label={group.label}
                className="scale-90"
              />
            </div>
          )
        })}
      </TooltipProvider>
    </div>
  )
}

export function AgentSidebarAdvancedSettings({ editor }: { editor: Controller }) {
  const { form, agent, computer, surfaces } = editor

  return (
    <div className="space-y-[22px]">
      <section>
        <OverlayAgentPermissionsField
          value={form.permissionMode}
          onChange={(value) => { form.setPermissionMode(value); form.markDirty() }}
        />
      </section>
      <section>
        <SectionHeading>Mentions</SectionHeading>
        <p className="mt-2 rounded-[10px] bg-(--surface-subtle) p-3 text-xs leading-5 text-(--muted)">
          Mention-first is enforced. One-to-one agent DMs invoke implicitly. Group DMs require a human mention or reply in the agent&apos;s thread.
        </p>
      </section>
      {editor.computersAvailable ? (
        <section>
          <SectionHeading>Computer</SectionHeading>
          <div className="mt-2">
            <AgentComputerSection
              enabled={form.enabledToolGroups.has('computer')}
              size={computer.computerSize}
              onSizeChange={(size) => { computer.setComputerSize(size); form.markDirty() }}
              computer={computer.agentComputer}
              currentUserId={computer.currentUserId}
              agentName={form.name}
              openBusy={computer.computerOpenBusy}
              lifecycleBusy={computer.computerLifecycleBusy}
              onOpenDesktop={() => void computer.openAgentComputer()}
              onControl={() => void computer.controlAgentComputer()}
              onTogglePower={() => void computer.toggleAgentComputerPower()}
              onDelete={() => void computer.deleteAgentComputer()}
              loadError={computer.computerLoadError}
              provisionError={computer.computerProvisionError}
              onRetryLoad={computer.retryComputerLoad}
              disabled={false}
            />
          </div>
        </section>
      ) : null}
      <section>
        <div className="mt-2">
          <AgentSurfacesField
            agentName={form.name}
            hasAgent={Boolean(agent)}
            surfaces={surfaces}
          />
        </div>
      </section>
      {!agent?.agentRole || agent.agentRole === 'agent' ? <section>
        <div className="rounded-[10px] bg-(--surface-subtle) p-3">
          <AccessSelector
            value={form.visibility}
            onChange={(value) => { form.setVisibility(value); form.markDirty() }}
          />
        </div>
      </section> : null}
      {agent?.principalId ? (
        <section>
          <div className="mt-2">
            <AgentMemoriesSection agentPrincipalId={agent.principalId} sidebarCompact />
          </div>
        </section>
      ) : null}
      {agent && !editor.isDefaultMaster ? (
        <section>
          <SectionHeading>Archive</SectionHeading>
          <div className="mt-2">
            <DangerZone
              mode="edit"
              hasAgent={Boolean(agent)}
              isDefaultMaster={editor.isDefaultMaster}
              busy={editor.busy}
              agentName={agent.name}
              onArchive={() => void editor.archiveAgent()}
              sidebarCompact
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium text-(--muted)">{children}</h3>
}
