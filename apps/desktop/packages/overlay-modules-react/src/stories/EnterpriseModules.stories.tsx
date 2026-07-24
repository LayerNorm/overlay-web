import { buildTree } from '@overlay/app-core/modules'
import type {
  AccountEntitlements,
  AutomationSummary,
  IntegrationSummary,
  KnowledgeFile,
  McpServerSummary,
  MemoryRow,
  NoteDoc,
  OutputSummary,
  OverlaySettingsPanel,
  OverlaySettingsSection,
  ProjectSummary,
  SkillSummary,
} from '@overlay/app-core'
import {
  AccountSubscriptionCard,
  AutomationEditorForm,
  AutomationGraphCanvas,
  AutomationsInlineList,
  BillingControlsPanel,
  ExtensionCatalog,
  KnowledgeFileTree,
  McpServerForm,
  MemoryList,
  NotesEditorShell,
  OutputGallery,
  ProjectDetail,
  ProjectTree,
  SettingsCard,
  SettingsPageShell,
  SettingsSectionRenderer,
} from '..'
import { KnowledgeFileDetailPanel, KnowledgeViewHeader } from '../knowledge'
import { useRef } from 'react'

const now = Date.now()

const panelClass = 'rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6'
const headingClass = 'text-[var(--foreground)]'
const mutedClass = 'text-[var(--muted)]'

const paidEntitlements: AccountEntitlements = {
  tier: 'pro',
  planKind: 'paid',
  planAmountCents: 2000,
  status: 'active',
  autoTopUpEnabled: true,
  topUpAmountCents: 1000,
  autoTopUpAmountCents: 1000,
  autoTopUpConsentGranted: true,
  budgetUsedCents: 4200,
  budgetTotalCents: 10000,
  budgetRemainingCents: 5800,
  creditsUsed: 12,
  creditsTotal: 100,
  overlayStorageBytesUsed: 1_000_000,
  overlayStorageBytesLimit: 10_000_000,
  limits: {
    askPerDay: 100,
    agentPerDay: 50,
    writePerDay: 50,
    tokenBudget: 100000,
    transcriptionSecondsPerWeek: 3600,
    overlayStorageBytes: 10_000_000,
  },
  usage: {
    ask: 4,
    agent: 2,
    write: 1,
    tokenCostAccrued: 42,
    transcriptionSeconds: 120,
    overlayStorageBytes: 1_000_000,
  },
  remaining: {
    ask: 96,
    agent: 48,
    write: 49,
    tokenCostAccrued: 58,
    transcriptionSeconds: 3480,
    overlayStorageBytes: 9_000_000,
  },
  billingPeriodEnd: now + 14 * 24 * 60 * 60 * 1000,
}

const automations: AutomationSummary[] = [
  {
    _id: 'auto-1',
    name: 'Weekly digest',
    enabled: true,
    schedule: { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 9, minuteUTC: 0 },
    createdAt: now,
    updatedAt: now,
  },
  {
    _id: 'auto-2',
    name: 'Incident triage',
    enabled: false,
    lastError: 'Last run failed: timeout',
    schedule: { kind: 'interval', intervalMinutes: 30 },
    createdAt: now,
    updatedAt: now,
  },
]

const sampleFlowSource = `flowchart TD
start["Collect metrics"]
analyze["Analyze anomalies"]
notify["Notify on-call"]
start --> analyze
analyze --> notify`

const files: KnowledgeFile[] = [
  { _id: 'folder-1', name: 'Policies', type: 'folder', kind: 'folder', parentId: null, createdAt: now, updatedAt: now },
  { _id: 'file-1', name: 'AI acceptable use.md', type: 'file', kind: 'upload', parentId: 'folder-1', createdAt: now, updatedAt: now },
  { _id: 'file-2', name: 'Security FAQ.pdf', type: 'file', kind: 'upload', parentId: null, createdAt: now, updatedAt: now },
]

const outputs: OutputSummary[] = [
  { _id: 'out-1', type: 'image', status: 'completed', prompt: 'Product mockup', modelId: 'gpt-image-1', fileName: 'mockup.png', createdAt: now },
  { _id: 'out-2', type: 'video', status: 'pending', prompt: 'Demo loop', modelId: 'veo', fileName: 'demo.mp4', createdAt: now },
]

const memories: MemoryRow[] = [
  { key: 'm1:0', memoryId: 'm1', segmentIndex: 0, content: 'Prefer concise project summaries.', fullContent: 'Prefer concise project summaries.', source: 'manual', status: 'approved', createdAt: now },
  { key: 'm2:0', memoryId: 'm2', segmentIndex: 0, content: 'Security reviews require owner sign-off.', fullContent: 'Security reviews require owner sign-off.', source: 'chat', status: 'candidate', createdAt: now },
]

const notes: NoteDoc[] = [
  { _id: 'note-1', title: 'Launch Notes', content: 'Outline enterprise launch plan.', tags: [], createdAt: now, updatedAt: now },
  { _id: 'note-2', title: 'Customer Brief', content: 'Summarize deployment requirements.', tags: [], createdAt: now, updatedAt: now },
]

const projects: ProjectSummary[] = [
  { _id: 'project-1', name: 'Enterprise Rollout', instructions: 'Keep docs concise.', parentId: null, createdAt: now, updatedAt: now },
  { _id: 'project-2', name: 'Security', parentId: 'project-1', createdAt: now, updatedAt: now },
]

const composioCapabilities = {
  provider: 'composio' as const,
  hosted: true,
  selfHosted: false,
  oauthOwnership: 'provider-managed' as const,
  connectionSetup: 'in-app-oauth' as const,
  connectionLifecycle: 'overlay-managed' as const,
  supportsApprovals: false,
  supportsDisconnect: true,
  supportedSchemas: ['native'] as const,
}

const integrations: Array<{ kind: 'integration' } & IntegrationSummary> = [
  { kind: 'integration', slug: 'github', providerKey: 'github', provider: 'composio', capabilities: { ...composioCapabilities, supportedSchemas: ['native'] }, name: 'GitHub', description: 'Repository and pull request workflows', logoUrl: null, isConnected: true },
  { kind: 'integration', slug: 'slack', providerKey: 'slack', provider: 'composio', capabilities: { ...composioCapabilities, supportedSchemas: ['native'] }, name: 'Slack', description: 'Workspace messaging', logoUrl: null, isConnected: false },
]

const skills: Array<{ kind: 'skill' } & SkillSummary> = [
  { kind: 'skill', _id: 'skill-1', name: 'Release Writer', description: 'Drafts release notes', instructions: 'Write clearly.', enabled: true },
]

const mcps: Array<{ kind: 'mcp' } & McpServerSummary> = [
  { kind: 'mcp', _id: 'mcp-1', name: 'Internal Tools', transport: 'streamable-http', url: 'https://tools.example/mcp', enabled: true, authType: 'bearer', createdAt: now, updatedAt: now },
]

const settingsSections: OverlaySettingsSection[] = [
  { id: 'general', label: 'General' },
  { id: 'security', label: 'Security' },
]

const settingsPanels: OverlaySettingsPanel[] = [
  { id: 'general', sectionId: 'general', label: 'General', componentKey: 'overlay.settings.general' },
  { id: 'policy', sectionId: 'security', label: 'Policy Gates', componentKey: 'enterprise.settings.policy' },
]

const meta = {
  title: 'Enterprise Modules',
}

export default meta

export function KnowledgeFileTreeStory() {
  return <KnowledgeFileTree nodes={buildTree(files)} selectedId="file-1" />
}

export function OutputGalleryStory() {
  return <OutputGallery outputs={outputs} />
}

export function MemoryListStory() {
  return <MemoryList memories={memories} />
}

export function NotesEditorShellStory() {
  return (
    <NotesEditorShell
      notes={notes}
      selectedNoteId="note-1"
      title="Launch Notes"
      content="Outline enterprise launch plan."
      dirty
    />
  )
}

export function ProjectTreeDetailStory() {
  return (
    <div className="flex h-[520px]">
      <div className="w-72 border-r border-[var(--border)]">
        <ProjectTree nodes={buildTree(projects)} selectedProjectId="project-1" />
      </div>
      <div className="flex-1">
        <ProjectDetail project={projects[0]!} notes={notes} files={files} />
      </div>
    </div>
  )
}

export function ExtensionCatalogStory() {
  return <ExtensionCatalog items={[...integrations, ...skills, ...mcps]} policyDisabledIds={new Set(['slack'])} />
}

export function McpFormStory() {
  return (
    <div className="max-w-xl p-4">
      <McpServerForm
        value={{
          name: 'Internal Tools',
          description: 'Private enterprise tools',
          transport: 'streamable-http',
          url: 'https://tools.example/mcp',
          enabled: true,
          authType: 'bearer',
        }}
        onChange={() => undefined}
      />
    </div>
  )
}

export function SettingsRendererStory() {
  return (
    <div className="h-[520px]">
      <SettingsSectionRenderer
        sections={settingsSections}
        panels={settingsPanels}
        activeSectionId="security"
        renderPanel={(panel) => (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-sm">
            Rendered by <code>{panel.componentKey}</code>
          </div>
        )}
      />
    </div>
  )
}

export function SettingsPageShellStory() {
  return (
    <div className="h-[520px]">
      <SettingsPageShell
        activeLabel="Customization"
        actions={
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)]"
          >
            Save
          </button>
        }
      >
        <SettingsCard title="Appearance">
          Theme controls and other setting rows inherit the shared app screen header and body layout.
        </SettingsCard>
        <SettingsCard title="Models">
          Settings subpages keep their current panel contents while sharing the shell frame.
        </SettingsCard>
      </SettingsPageShell>
    </div>
  )
}

export function AutomationsInlineListStory() {
  return (
    <div className="w-72 p-2">
      <AutomationsInlineList
        automations={automations}
        activeAutomationId="auto-1"
        editingAutomationName=""
        onNavigateAutomation={() => undefined}
        onBeginRename={() => undefined}
        onEditingNameChange={() => undefined}
        onCommitRename={() => undefined}
        onCancelRename={() => undefined}
        onRequestDelete={() => undefined}
        onConfirmDelete={() => undefined}
        onClearPendingDelete={() => undefined}
      />
    </div>
  )
}

export function AutomationGraphCanvasStory() {
  return (
    <div className="h-[420px] p-4">
      <AutomationGraphCanvas source={sampleFlowSource} onSourceChange={() => undefined} />
    </div>
  )
}

export function AutomationEditorFormStory() {
  return (
    <div className="h-[720px]">
      <AutomationEditorForm
        name="Weekly digest"
        description="Summarize product metrics"
        instructions="Review the last week and draft a concise update."
        enabled
        scheduleKind="weekly"
        intervalMinutes={60}
        timezone="America/Los_Angeles"
        time="09:00"
        dayOfWeek={1}
        dayOfMonth={1}
        graphSource={sampleFlowSource}
        modelId="gpt-4.1"
        timeZoneOptions={[{ value: 'America/Los_Angeles', label: 'Pacific Time', offsetMinutes: -480 }]}
        modelOptions={[{ id: 'gpt-4.1', name: 'GPT-4.1' }]}
        saveState="idle"
        testState="idle"
        onNameChange={() => undefined}
        onDescriptionChange={() => undefined}
        onInstructionsChange={() => undefined}
        onEnabledChange={() => undefined}
        onScheduleKindChange={() => undefined}
        onIntervalMinutesChange={() => undefined}
        onTimezoneChange={() => undefined}
        onTimeChange={() => undefined}
        onDayOfWeekChange={() => undefined}
        onDayOfMonthChange={() => undefined}
        onGraphSourceChange={() => undefined}
        onModelIdChange={() => undefined}
        onSave={() => undefined}
        onTest={() => undefined}
        renderInstructionsEditor={({ value, onChange }) => (
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 min-h-32 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          />
        )}
      />
    </div>
  )
}

export function AccountSubscriptionCardStory() {
  return (
    <div className="max-w-2xl p-4">
      <AccountSubscriptionCard
        panelClass={panelClass}
        headingClass={headingClass}
        mutedClass={mutedClass}
        entitlements={paidEntitlements}
        actions={
          <button
            type="button"
            className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)]"
          >
            Manage billing
          </button>
        }
      />
    </div>
  )
}

export function BillingControlsPanelStory() {
  return (
    <div className="max-w-2xl p-4">
      <BillingControlsPanel panelClass={panelClass} headingClass={headingClass} mutedClass={mutedClass}>
        <p className="text-sm text-[var(--muted)]">Top-up preference controls render here from the app shell.</p>
      </BillingControlsPanel>
    </div>
  )
}

export function KnowledgeFileDetailPanelEditableStory() {
  return (
    <div className="max-w-3xl border border-[var(--border)] bg-[var(--background)] p-4">
      <KnowledgeFileDetailPanel
        fileName="runbook.md"
        isEditable
        fileContent={'# Incident runbook\n\n1. Triage\n2. Escalate'}
        onContentChange={() => undefined}
        renderViewer={() => null}
      />
    </div>
  )
}

export function KnowledgeFileDetailPanelPreviewStory() {
  return (
    <div className="max-w-3xl border border-[var(--border)] bg-[var(--background)] p-4">
      <KnowledgeFileDetailPanel
        fileName="Security FAQ.pdf"
        isEditable={false}
        fileContent=""
        onContentChange={() => undefined}
        renderViewer={() => (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">
            PDF preview slot
          </div>
        )}
      />
    </div>
  )
}

export function KnowledgeViewHeaderBrowseStory() {
  const createMenuRef = useRef<HTMLDivElement>(null)
  const fileUploadRef = useRef<HTMLInputElement>(null)
  const folderUploadRef = useRef<HTMLInputElement>(null)
  const uploadMenuRef = useRef<HTMLDivElement>(null)
  const outputFilterRef = useRef<HTMLDivElement>(null)

  return (
    <KnowledgeViewHeader
      activeFolder={null}
      activeTab="files"
      bulkDeleting={false}
      createMenuOpen={false}
      createMenuRef={createMenuRef}
      fileCount={files.length}
      fileSearchOpen={false}
      fileSearchQuery=""
      filesCategory="files"
      fileTitle=""
      fileUploadRef={fileUploadRef}
      folderBreadcrumb={[]}
      folderUploadRef={folderUploadRef}
      isSavingFile={false}
      layout="list"
      memoryCount={memories.length}
      memorySearchOpen={false}
      memorySearchQuery=""
      mode="files"
      moveFileToParent={() => undefined}
      navigateToFolder={() => undefined}
      onBulkDeleteFiles={() => undefined}
      onBulkDeleteMemories={() => undefined}
      onBulkDeleteOutputs={() => undefined}
      onCloseFile={() => undefined}
      onCreateNoteFile={() => undefined}
      onExitSelectMode={() => undefined}
      onFileTitleChange={() => undefined}
      onSetFileSearchOpen={() => undefined}
      onSetFileSearchQuery={() => undefined}
      onImportMemory={() => undefined}
      onNewMemory={() => undefined}
      onRefreshOutputs={() => undefined}
      onSetMemorySearchOpen={() => undefined}
      onSetMemorySearchQuery={() => undefined}
      onSetSelectMode={() => undefined}
      onUpdateQuery={() => undefined}
      outputFilter="all"
      outputFilterOpen={false}
      outputFilterRef={outputFilterRef}
      rootItemCount={files.length}
      selectedFile={null}
      selectedFileCount={0}
      selectedMemoryCount={0}
      selectedOutputCount={0}
      selectMode={false}
      setCreateMenuOpen={() => undefined}
      setDialog={() => undefined}
      setDialogName={() => undefined}
      setOutputFilterOpen={() => undefined}
      setUploadMenuOpen={() => undefined}
      uploadMenuOpen={false}
      uploadMenuRef={uploadMenuRef}
      onCommitOutputFilter={() => undefined}
    />
  )
}
