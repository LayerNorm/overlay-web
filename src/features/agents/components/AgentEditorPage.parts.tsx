'use client'

import { ArrowLeft } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { ComputerSize, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import {
  AccessSelector,
  AgentAvatar,
  type AgentModelFieldProps,
  AgentMemoriesSection,
  OverlayAgentFields,
  OverlayAgentPermissionsField,
  DangerZone,
  MasterAgentNotice,
} from './AgentEditorForm'
import {
  AgentEditorDialog,
  AgentEditorSidePanel,
  SayHelloButton,
} from './AgentEditorPresentation'
import type { useAgentComputer } from './use-agent-computer'
import type { useAgentEditorForm } from './use-agent-editor-form'
import { AgentEditorSkeleton, EditorLoadGate, useEditorLoad } from './EditorLoadGate'
import { usesOverlayMark } from '@/shared/agents/chief-identity'

function getAgentEditorControls(agent: WorkspaceAgentDirectoryItem | null, isDefaultMaster: boolean) {
  return {
    canEdit: agent?.canEdit !== false,
    showMasterNotice: isDefaultMaster && agent?.agentRole !== 'personal_chief',
    showAccessSelector: !agent?.agentRole || agent.agentRole === 'agent',
  }
}

type AgentEditorFormSectionProps = {
  mode: 'new' | 'edit'
  agent: WorkspaceAgentDirectoryItem | null
  isDefaultMaster: boolean
  computersAvailable: boolean
  modelField: AgentModelFieldProps
  valid: boolean
  busy: boolean
  form: ReturnType<typeof useAgentEditorForm>
  computer: ReturnType<typeof useAgentComputer>
  closeEditor(): void
  persistNew(): void
  saveEdit(): void
  cancelEdit(): void
  archiveAgent(): void
  movedToWorkspace(agent: WorkspaceAgentDirectoryItem): void
}

function AgentEditorFormSection({
  mode,
  agent,
  isDefaultMaster,
  computersAvailable,
  modelField,
  valid,
  busy,
  form,
  computer,
  closeEditor,
  persistNew,
  saveEdit,
  cancelEdit,
  archiveAgent,
  movedToWorkspace,
}: AgentEditorFormSectionProps) {
  // One loading state for the whole form: it shows when everything (computer, memories) has loaded,
  // not piece by piece.
  useEditorLoad(computer.initialLoading)
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

  const controls = getAgentEditorControls(agent, isDefaultMaster)
  if (!controls.canEdit) return <p className="px-5 py-6 text-sm text-(--muted)">You do not have permission to edit this agent.</p>

  return (
    <div className="mx-auto w-full max-w-2xl">
      {controls.showMasterNotice ? <MasterAgentNotice /> : null}

      <div className="mt-5 space-y-5">
        <AgentAvatar
          isDefault={usesOverlayMark(agent)}
          color={avatarColor}
          shape={avatarShape}
          name={name}
          description={description}
          namePlaceholder="Research partner"
          descriptionPlaceholder="Finds evidence and challenges assumptions"
          onNameChange={(value) => { setName(value); markDirty() }}
          onDescriptionChange={(value) => { setDescription(value); markDirty() }}
          onChange={(color) => { setAvatarColor(color); markDirty() }}
          onShapeChange={(next) => { setAvatarShape(next); markDirty() }}
        />
        <div className="space-y-5">
          <OverlayAgentFields
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
            computer={computersAvailable ? {
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
              disabled: false,
            } : undefined}
          />

          <OverlayAgentPermissionsField
            value={permissionMode}
            onChange={(value) => { setPermissionMode(value); markDirty() }}
          />

          {controls.showAccessSelector ? (
            <AccessSelector
              value={visibility}
              onChange={(value) => { setVisibility(value); markDirty() }}
              agent={mode === 'edit' ? agent : null}
              onMovedToWorkspace={movedToWorkspace}
            />
          ) : null}

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
  computersAvailable,
  modelField,
  form,
  computer,
  closeEditor,
  sayHello,
  persistNew,
  saveEdit,
  cancelEdit,
  archiveAgent,
  movedToWorkspace,
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
  computersAvailable: boolean
  modelField: AgentModelFieldProps
  form: ReturnType<typeof useAgentEditorForm>
  computer: ReturnType<typeof useAgentComputer>
  closeEditor(): void
  sayHello(): void
  persistNew(): void
  saveEdit(): void
  cancelEdit(): void
  archiveAgent(): void
  movedToWorkspace(agent: WorkspaceAgentDirectoryItem): void
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
            computersAvailable={computersAvailable}
            modelField={modelField}
            valid={valid}
            busy={busy}
            form={form}
            computer={computer}
            closeEditor={closeEditor}
            persistNew={persistNew}
            saveEdit={saveEdit}
            cancelEdit={cancelEdit}
            archiveAgent={archiveAgent}
            movedToWorkspace={movedToWorkspace}
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
