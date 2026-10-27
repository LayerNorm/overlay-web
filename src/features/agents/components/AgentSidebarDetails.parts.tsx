'use client'

import {
  BookOpen,
  Blocks,
  FileImage,
  Folder,
  Globe,
  Link2,
  Monitor,
  PanelsTopLeft,
  Search,
  Sparkles,
  StickyNote,
  Video,
  Wrench,
  Zap,
} from 'lucide-react'
import { Toggle, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@overlay/ui/primitives'
import {
  AccessSelector,
  AgentComputerSection,
  AgentMemoriesSection,
  AgentTypeSelector,
  ByoAgentFields,
  DangerZone,
  OverlayAgentPermissionsField,
} from './AgentEditorForm'
import { AgentSurfacesField } from './AgentSurfacesField'
import { CloudAgentPanel } from './CloudAgentPanel'
import { CloudAgentAccess } from './CloudAgentAccess'
import { ConnectedAgentSettings } from './ConnectedAgentSettings'
import { AGENT_TOOL_GROUPS } from '@/shared/agents/tool-groups'
import type { ReactNode } from 'react'
import type { useAgentEditorController } from './AgentEditorPage'

type Controller = ReturnType<typeof useAgentEditorController>

const toolIcons: Record<string, typeof Wrench> = {
  memory: BookOpen,
  knowledge: Search,
  files: Folder,
  web_search: Globe,
  integrations: Link2,
  mcp: Blocks,
  notes: StickyNote,
  skills: Sparkles,
  automations: Zap,
  image: FileImage,
  video: Video,
  browser: PanelsTopLeft,
  computer: Monitor,
}

const toolLabels: Record<string, string> = {
  memory: 'Memory',
  knowledge: 'Knowledge',
  files: 'Files',
  web_search: 'Web search',
  integrations: 'Connected apps',
  mcp: 'MCP servers',
  notes: 'Notes',
  skills: 'Skills',
  automations: 'Automations',
  image: 'Image generation',
  video: 'Video generation',
  browser: 'Browser',
  computer: 'Computer',
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
      <TooltipProvider delayDuration={350}>
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
  const { form, runtime, agent, computer, surfaces } = editor
  const overlaySettings = runtime.agentType === 'overlay' && !runtime.cloudAgent

  return (
    <div className="space-y-[22px]">
      {!runtime.cloudAgent ? (
        <section>
          <AgentTypeSelector
            hidden={editor.isDefaultMaster || !editor.connectedAgentsEnabled}
            value={runtime.agentType}
            onChange={(value) => {
              runtime.setAgentType(value)
              form.markDirty()
            }}
          />
        </section>
      ) : null}
      {runtime.cloudAgent && agent ? (
        <section>
          <SectionHeading>Computer</SectionHeading>
          <div className="mt-2 space-y-3">
            <CloudAgentPanel agentId={agent.id} />
            <CloudAgentAccess agentId={agent.id} allowedToolIds={agent.allowedToolIds} />
            {editor.connectedAgentsEnabled ? (
              <ConnectedAgentSettings
                key={agent.id}
                agentId={agent.id}
                modelId={agent.modelId}
                permissionMode={agent.permissionMode}
                effort={agent.effort}
              />
            ) : null}
          </div>
        </section>
      ) : null}
      {runtime.agentType === 'byo' && !runtime.cloudAgent ? (
        <section>
          <SectionHeading>Connected agent</SectionHeading>
          <div className="mt-2 space-y-3 rounded-[10px] bg-(--surface-subtle) p-3">
            {agent && editor.connectedAgentsEnabled ? (
              <ConnectedAgentSettings
                key={agent.id}
                agentId={agent.id}
                modelId={agent.modelId}
                permissionMode={agent.permissionMode}
                effort={agent.effort}
              />
            ) : null}
            <ByoAgentFields
              adapterId={editor.byo.adapterId}
              harnessOptions={editor.byo.harnessOptions}
              onHarnessChange={(value) => { editor.byo.chooseHarness(value); form.markDirty() }}
              choice={editor.byo.environmentChoice}
              onChoiceChange={(value) => { editor.byo.setEnvironmentChoice(value); form.markDirty() }}
              compatibleEnvironments={editor.byo.compatibleEnvironments}
              environmentsLoading={editor.byo.environmentsLoading}
              environmentId={editor.byo.environmentId}
              onEnvironmentChange={(value) => { editor.byo.chooseEnvironment(value); form.markDirty() }}
              workingDirectory={editor.byo.workingDirectory}
              onWorkingDirectoryChange={(value) => { editor.byo.setWorkingDirectory(value); form.markDirty() }}
              selectedHarnessConnectable={Boolean(editor.byo.selectedHarness?.connectable)}
              environmentBusy={editor.byo.environmentBusy}
              environmentError={editor.byo.environmentError}
              command={editor.byo.command}
              copied={editor.byo.copied}
              onCopyCommand={editor.byo.copyCommand}
              onBeginConnection={editor.byo.beginConnection}
              setupEnvironment={editor.byo.setupEnvironment}
              setupRoots={editor.byo.setupRoots}
              onSetupRootsChange={(value) => { editor.byo.setSetupRoots(value); form.markDirty() }}
              onApproveSetup={editor.byo.approveSetupEnvironment}
            />
          </div>
        </section>
      ) : null}
      {overlaySettings ? (
        <>
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
              <SectionHeading>Computer settings</SectionHeading>
              <div className="mt-2 rounded-[10px] bg-(--surface-subtle) p-3">
                <AgentComputerSection
                  enabled={form.enabledToolGroups.has('computer')}
                  size={computer.computerSize}
                  onSizeChange={(size) => { computer.setComputerSize(size); form.markDirty() }}
                  computer={computer.agentComputer}
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
            <div className="mt-2 rounded-[10px] bg-(--surface-subtle) p-3">
              <AgentSurfacesField
                agentName={form.name}
                hasAgent={Boolean(agent)}
                surfaces={surfaces}
              />
            </div>
          </section>
        </>
      ) : null}
      <section>
        <div className="rounded-[10px] bg-(--surface-subtle) p-3">
          <AccessSelector
            value={form.visibility}
            onChange={(value) => { form.setVisibility(value); form.markDirty() }}
          />
        </div>
      </section>
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
