'use client'

import { Bot } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { AgentEditorPage } from './AgentEditorPage'
import { agentsForCreatorScope } from '@/shared/agents/last-agent-by-workspace'
import type { PanelScope } from '@/shared/workspaces/panel-scope'

export function AgentEditorPanel({
  mode,
  agentId,
  panelMode,
  onTogglePanelMode,
  onClose,
  onCreated,
  onArchived,
}: {
  mode: 'new' | 'edit'
  agentId: string | null
  panelMode: 'dialog' | 'side'
  onTogglePanelMode(): void
  onClose(): void
  onCreated(agent: WorkspaceAgentDirectoryItem): void
  onArchived(): void
}) {
  return (
    <AgentEditorPage
      mode={mode}
      agentId={mode === 'edit' ? (agentId ?? undefined) : undefined}
      presentation="panel"
      panelMode={panelMode}
      onTogglePanelMode={onTogglePanelMode}
      onClose={onClose}
      onCreated={onCreated}
      onArchived={onArchived}
    />
  )
}

export function AgentDirectoryScreen({
  settingsButton,
  sideEditor,
  onRightPanelClose,
  activeWorkspaceId,
  directory,
  viewerPrincipalId,
  scope,
  resolving,
  error,
  loadError,
  onRetry,
  onCreate,
}: {
  settingsButton: ReactNode
  sideEditor: ReactNode
  onRightPanelClose(): void
  activeWorkspaceId: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
  viewerPrincipalId: string | null
  scope: PanelScope
  resolving: boolean
  error: string | null
  loadError: string | null
  onRetry(): void
  onCreate(): void
}) {
  const displayError = error ?? loadError
  const scopedDirectory = directory === null ? null : agentsForCreatorScope(directory, viewerPrincipalId, scope)
  const resolvingConversation = scopedDirectory !== null && scopedDirectory.length > 0 && !displayError
  const loading = activeWorkspaceId !== null && (directory === null || resolving || resolvingConversation)
  const empty = scopedDirectory !== null && scopedDirectory.length === 0 && !displayError

  return (
    <AppScreenShell
      header={<AppScreenHeader title="Agents" actions={settingsButton} />}
      rightPanel={sideEditor}
      rightPanelMode="docked"
      rightPanelWidth="lg"
      onRightPanelClose={onRightPanelClose}
    >
      <AppScreenBody className="flex min-h-full items-center justify-center p-6" padding="none">
        {loading ? (
          <div className="flex items-center gap-1.5" role="status" aria-label="Opening your agent">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-(--muted)"
                style={{ animationDelay: `${dot * 150}ms` }}
              />
            ))}
          </div>
        ) : (
          <div className="max-w-sm text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-subtle) text-(--muted)">
              <Bot size={18} />
            </span>
            <h1 className="mt-4 text-sm font-medium text-(--foreground)">
              {displayError ? 'Could not open your agent' : 'Your agents work from here'}
            </h1>
            <p className="mt-1.5 text-xs leading-5 text-(--muted)">
              {displayError ?? (empty
                ? 'Create one for a new outcome.'
                : 'Select an agent to open its conversation, or create one for a new outcome.')}
            </p>
            {displayError ? (
              <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
                Retry
              </Button>
            ) : (
              <Button variant="secondary" size="sm" className="mt-4" onClick={onCreate}>
                Create agent
              </Button>
            )}
          </div>
        )}
      </AppScreenBody>
    </AppScreenShell>
  )
}
