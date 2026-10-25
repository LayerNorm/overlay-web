'use client'

import { ArrowLeft } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { ComputerSize, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import {
  AccessSelector,
  AgentAvatar,
  AgentBehaviorFields,
  type AgentModelFieldProps,
  AgentMemoriesSection,
  OverlayAgentPermissionsField,
  AgentTypeSelector,

  DangerZone,
  MasterAgentNotice,
} from './AgentEditorForm'
import {
  AgentEditorDialog,
  AgentEditorSidePanel,
  SayHelloButton,
} from './AgentEditorPresentation'
import type { useByoConnection } from './use-byo-connection'
import type { useAgentComputer } from './use-agent-computer'
import type { useAgentEditorForm } from './use-agent-editor-form'
import type { useAgentRuntime } from './use-agent-runtime'
import type { useAgentSurfaces } from './use-agent-surfaces'
import { AgentSurfacesField } from './AgentSurfacesField'
import { CloudAgentPanel } from './CloudAgentPanel'
import { CloudAgentAccess } from './CloudAgentAccess'
import { ConnectedAgentSettings } from './ConnectedAgentSettings'
import { AgentEditorSkeleton, EditorLoadGate, useEditorLoad } from './EditorLoadGate'

type AgentEditorFormSectionProps = {
  mode: 'new' | 'edit'
  agent: WorkspaceAgentDirectoryItem | null
  isDefaultMaster: boolean
  showcase: boolean
  computersAvailable: boolean
  connectedAgentsEnabled: boolean
  connectedAgentsChecked: boolean
  modelField: AgentModelFieldProps
  valid: boolean
  busy: boolean
  form: ReturnType<typeof useAgentEditorForm>
  runtime: ReturnType<typeof useAgentRuntime>
  byo: ReturnType<typeof useByoConnection>
  computer: ReturnType<typeof useAgentComputer>
  surfaces: ReturnType<typeof useAgentSurfaces>
  closeEditor(): void
  persistNew(): void
  saveEdit(): void
  cancelEdit(): void
  archiveAgent(): void
}

function AgentEditorFormSection({
  mode,
  agent,
  isDefaultMaster,
  showcase,
  computersAvailable,
  connectedAgentsEnabled,
  connectedAgentsChecked,
  modelField,
  valid,
  busy,
  form,
  runtime,
  byo,
  computer,
  surfaces,
  closeEditor,
  persistNew,
  saveEdit,
  cancelEdit,
  archiveAgent,
}: AgentEditorFormSectionProps) {
  // One loading state for the whole form: it shows when everything (the agent's connection, computer, reachability,
  // machine, memories) has loaded, not piece by piece.
  useEditorLoad(!connectedAgentsChecked || byo.initialLoading || surfaces.initialLoading || computer.initialLoading)
  const {
    name,
    description,
    instructions,
    modelId,
    avatarColor,
    avatarShape,
    visibility,
    permissionMode,
    enabledToolGroups,
    advanced,
    dirty,
    markDirty,
    toggleToolGroup,
    setName,
    setDescription,
    setInstructions,
    setModelId,
    setAvatarColor,
    setAvatarShape,
    setVisibility,
    setPermissionMode,
    setAdvanced,
  } = form
  const {
    agentType,
    setAgentType,
    legacyHostedRuntime,
  } = runtime
  const {
    adapterId,
    harnessOptions,
    chooseHarness,
    environmentChoice,
    setEnvironmentChoice,
    compatibleEnvironments,
    environmentsLoading,
    environmentId,
    chooseEnvironment,
    workingDirectory,
    setWorkingDirectory,
    selectedHarness,
    environmentBusy,
    environmentError,
    command,
    copied,
    copyCommand,
    beginConnection,
    setupEnvironment,
    setupRoots,
    setSetupRoots,
    approveSetupEnvironment,
  } = byo
  const {
    agentComputer,
    currentUserId,
    computerSize,
    setComputerSize,
    computerLoadError,
    computerProvisionError,
    retryComputerLoad,
    computerOpenBusy,
    computerLifecycleBusy,
    openAgentComputer,
    controlAgentComputer,
    toggleAgentComputerPower,
    deleteAgentComputer,
  } = computer

  return (
    <div className="mx-auto w-full max-w-2xl">
      {isDefaultMaster ? <MasterAgentNotice /> : null}

      <div className="mt-5 space-y-5">
        <AgentAvatar
          color={avatarColor}
          shape={avatarShape}
          name={name}
          description={description}
          namePlaceholder={agentType === 'byo' ? 'Local Codex' : 'Research partner'}
          descriptionPlaceholder={agentType === 'byo' ? 'Works in my product repository' : 'Finds evidence and challenges assumptions'}
          onNameChange={(value) => { setName(value); markDirty() }}
          onDescriptionChange={(value) => { setDescription(value); markDirty() }}
          onChange={(color) => { setAvatarColor(color); markDirty() }}
          onShapeChange={(next) => { setAvatarShape(next); markDirty() }}
        />
        <AgentTypeSelector
          hidden={isDefaultMaster || !connectedAgentsEnabled || runtime.cloudAgent}
          value={agentType}
          onChange={(value) => { setAgentType(value); markDirty() }}
        />
        <div className="space-y-5">
          {runtime.cloudAgent && agent ? <><CloudAgentPanel agentId={agent.id} /><CloudAgentAccess agentId={agent.id} allowedToolIds={agent.allowedToolIds} /></> : null}
          {agent && connectedAgentsEnabled && (runtime.cloudAgent || agentType === 'byo') ? <ConnectedAgentSettings key={agent.id}
            agentId={agent.id} modelId={agent.modelId} permissionMode={agent.permissionMode} effort={agent.effort} /> : null}
          {runtime.cloudAgent ? null : <AgentBehaviorFields
            agentType={agentType}
            connectedAgentsEnabled={connectedAgentsEnabled}
            computersAvailable={computersAvailable}
            instructions={instructions}
            onInstructionsChange={(value) => { setInstructions(value); markDirty() }}
            modelId={modelId}
            onModelChange={(value) => { setModelId(value); markDirty() }}
            modelField={modelField}
            enabledToolGroups={enabledToolGroups}
            onToggleToolGroup={toggleToolGroup}
            advanced={advanced}
            onAdvancedChange={setAdvanced}
            legacyHostedRuntime={legacyHostedRuntime}
            adapterId={adapterId}
            harnessOptions={harnessOptions}
            onHarnessChange={(value) => { chooseHarness(value); markDirty() }}
            environmentChoice={environmentChoice}
            onEnvironmentChoiceChange={(value) => { setEnvironmentChoice(value); markDirty() }}
            compatibleEnvironments={compatibleEnvironments}
            environmentsLoading={environmentsLoading}
            environmentId={environmentId}
            onEnvironmentChange={(value) => { chooseEnvironment(value); markDirty() }}
            workingDirectory={workingDirectory}
            onWorkingDirectoryChange={(value) => { setWorkingDirectory(value); markDirty() }}
            selectedHarnessConnectable={Boolean(selectedHarness?.connectable)}
            environmentBusy={environmentBusy}
            environmentError={environmentError}
            command={command}
            copied={copied}
            onCopyCommand={copyCommand}
            onBeginConnection={beginConnection}
            setupEnvironment={setupEnvironment}
            setupRoots={setupRoots}
            onSetupRootsChange={(value) => { setSetupRoots(value); markDirty() }}
            onApproveSetup={approveSetupEnvironment}
            computer={agentType === 'overlay' && computersAvailable ? {
              size: computerSize,
              onSizeChange: (next: ComputerSize) => { setComputerSize(next); markDirty() },
              computer: agentComputer,
              currentUserId,
              agentName: name,
              openBusy: computerOpenBusy,
              lifecycleBusy: computerLifecycleBusy,
              onOpenDesktop: () => void openAgentComputer(),
              onControl: () => void controlAgentComputer(),
              onTogglePower: () => void toggleAgentComputerPower(),
              onDelete: () => void deleteAgentComputer(),
              loadError: computerLoadError,
              provisionError: computerProvisionError,
              onRetryLoad: retryComputerLoad,
              disabled: showcase,
            } : undefined}
          />}

          {agentType === 'overlay' ? (
            <OverlayAgentPermissionsField
              value={permissionMode}
              onChange={(value) => { setPermissionMode(value); markDirty() }}
            />
          ) : null}

          {agentType === 'overlay' ? (
            <AgentSurfacesField agentName={name} hasAgent={Boolean(agent)} surfaces={surfaces} />
          ) : null}

          <AccessSelector value={visibility} onChange={(value) => { setVisibility(value); markDirty() }} />

          {mode === 'edit' && agent?.principalId ? (
            <AgentMemoriesSection agentPrincipalId={agent.principalId} />
          ) : null}

          <DangerZone
            mode={mode}
            hasAgent={Boolean(agent)}
            isDefaultMaster={isDefaultMaster}
            busy={busy}
            agentName={agent?.name ?? 'this agent'}
            onArchive={() => void archiveAgent()}
          />

          <AgentEditorFormFooter
            mode={mode}
            busy={busy}
            valid={valid}
            dirty={dirty}
            onCreate={() => persistNew()}
            onClose={closeEditor}
            onSave={() => saveEdit()}
            onCancel={cancelEdit}
          />
        </div>
      </div>
    </div>
  )
}

function AgentEditorFormFooter({
  mode,
  busy,
  valid,
  dirty,
  onCreate,
  onClose,
  onSave,
  onCancel,
}: {
  mode: 'new' | 'edit'
  busy: boolean
  valid: boolean
  dirty: boolean
  onCreate(): void
  onClose(): void
  onSave(): void
  onCancel(): void
}) {
  return (
    <>
      {mode === 'new' ? (
        <>
          <Button className="mt-2 w-full" disabled={busy || !valid} onClick={onCreate}>
            {busy ? 'Creating…' : 'Create agent'}
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button className="mt-2 w-full" disabled={busy || !valid || !dirty} onClick={onSave}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
    </>
  )
}

export function AgentEditorView({
  presentation,
  embedded,
  panelMode,
  onTogglePanelMode,
  title,
  inPanel,
  showHello,
  mode,
  agent,
  loading,
  loadFailed,
  canCreate,
  isDefaultMaster,
  valid,
  busy,
  showcase,
  computersAvailable,
  connectedAgentsEnabled,
  connectedAgentsChecked,
  modelField,
  form,
  runtime,
  byo,
  computer,
  surfaces,
  closeEditor,
  sayHello,
  persistNew,
  saveEdit,
  cancelEdit,
  archiveAgent,
}: {
  presentation: 'page' | 'panel'
  embedded: boolean
  panelMode?: 'dialog' | 'side'
  onTogglePanelMode?: () => void
  title: string
  inPanel: boolean
  showHello: boolean
  mode: 'new' | 'edit'
  agent: WorkspaceAgentDirectoryItem | null
  loading: boolean
  loadFailed: boolean
  canCreate: boolean
  isDefaultMaster: boolean
  valid: boolean
  busy: boolean
  showcase: boolean
  computersAvailable: boolean
  connectedAgentsEnabled: boolean
  connectedAgentsChecked: boolean
  modelField: AgentModelFieldProps
  form: ReturnType<typeof useAgentEditorForm>
  runtime: ReturnType<typeof useAgentRuntime>
  byo: ReturnType<typeof useByoConnection>
  computer: ReturnType<typeof useAgentComputer>
  surfaces: ReturnType<typeof useAgentSurfaces>
  closeEditor(): void
  sayHello(): void
  persistNew(): void
  saveEdit(): void
  cancelEdit(): void
  archiveAgent(): void
}) {
  const editor = (
    <AppScreenShell
      style={inPanel ? { background: 'transparent' } : undefined}
      header={presentation === 'page' ? (
        <AppScreenHeader
          title={title}
          leading={(
            <Button variant="ghost" size="sm" onClick={closeEditor} aria-label="Back to agents">
              <ArrowLeft size={14} /> Agents
            </Button>
          )}
          actions={(
            <SayHelloButton
              mode={mode}
              hasAgent={Boolean(agent)}
              highlight={showHello}
              showcase={showcase}
              onSayHello={sayHello}
            />
          )}
        />
      ) : undefined}
    >
      <AppScreenBody
        padding={embedded ? 'none' : 'lg'}
        maxWidth={embedded ? 'none' : 'xl'}
        className={inPanel ? 'min-h-full pb-4 sm:pb-4' : 'min-h-full'}
        style={inPanel ? { background: 'transparent' } : undefined}
      >
        {loading ? (
          <AgentEditorSkeleton />
        ) : loadFailed || (mode === 'edit' && !agent) ? (
          <div className="mx-auto w-full max-w-2xl rounded-xl border border-(--border) bg-(--surface-elevated) p-8 text-center">
            <p className="text-sm font-medium text-(--foreground)">Agent not found</p>
            <p className="mt-1 text-xs leading-5 text-(--muted)">It may have been archived, or you may not have access to it.</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={closeEditor}>Back to agents</Button>
          </div>
        ) : mode === 'new' && !canCreate ? (
          <div className="mx-auto w-full max-w-2xl rounded-xl border border-(--border) bg-(--surface-elevated) p-8 text-center">
            <p className="text-sm font-medium text-(--foreground)">You cannot create agents in this workspace</p>
            <p className="mt-1 text-xs leading-5 text-(--muted)">Guests can chat with agents but cannot create new ones.</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={closeEditor}>Back to agents</Button>
          </div>
        ) : (
          <EditorLoadGate key={agent?.id ?? 'new'}>
          <AgentEditorFormSection
            mode={mode}
            agent={agent}
            isDefaultMaster={isDefaultMaster}
            showcase={showcase}
            computersAvailable={computersAvailable}
            connectedAgentsEnabled={connectedAgentsEnabled}
            connectedAgentsChecked={connectedAgentsChecked}
            modelField={modelField}
            valid={valid}
            busy={busy}
            form={form}
            runtime={runtime}
            byo={byo}
            computer={computer}
            surfaces={surfaces}
            closeEditor={closeEditor}
            persistNew={persistNew}
            saveEdit={saveEdit}
            cancelEdit={cancelEdit}
            archiveAgent={archiveAgent}
          />
          </EditorLoadGate>
        )}
      </AppScreenBody>
    </AppScreenShell>
  )

  if (embedded) return editor

  if (presentation === 'panel') {
    if (panelMode === 'side') {
      return (
        <AgentEditorSidePanel
          title={title}
          onTogglePanelMode={onTogglePanelMode}
          onClose={closeEditor}
        >
          {editor}
        </AgentEditorSidePanel>
      )
    }
    return (
      <AgentEditorDialog
        title={title}
        onTogglePanelMode={onTogglePanelMode}
        onClose={closeEditor}
      >
        {editor}
      </AgentEditorDialog>
    )
  }

  return editor
}
