'use client'

import { useState } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { Button, toast } from '@overlay/ui/primitives'
import { SettingsGroup } from '@overlay/modules-react/settings'
import { GitHubMark } from '@/components/brand/AppMarks'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { SettingsAppRow } from './SettingsAppRow'
import { api } from '../../../../../convex/_generated/api'
import { navigateToExternalFlow } from '@/components/chrome/chrome-extension'

const RETURN_TO = '/app/settings?section=connected-apps&app=github'

/** Settings › Connected apps › GitHub: the GitHub App installations connected to this workspace. */
export function GitHubSettings() {
  const { activeWorkspaceId } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const args = activeWorkspaceId && isAuthenticated && !isLoading ? { workspaceId: activeWorkspaceId } : 'skip'
  const installations = useQuery(api.integrations.githubInstallations.list, args)
  const remove = useMutation(api.integrations.githubInstallations.remove)
  const [busy, setBusy] = useState<number | null>(null)

  const disconnect = async (installationId: number) => {
    if (!activeWorkspaceId) return
    setBusy(installationId)
    try {
      await remove({ workspaceId: activeWorkspaceId, installationId })
    } catch {
      toast.error('Only the person who connected this account, or an owner or admin, can disconnect it.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-(--muted)">Repositories your agents can clone and open pull requests on.</p>
        <Button
          variant="secondary"
          size="sm"
          disabled={!activeWorkspaceId}
          onClick={() => activeWorkspaceId && navigateToExternalFlow(overlayAppClient.github.connectUrl(activeWorkspaceId, RETURN_TO))}
        >
          Connect GitHub
        </Button>
      </div>
      {installations?.length ? (
        <SettingsGroup>
          {installations.map((installation) => (
            <SettingsAppRow
              key={installation.installationId}
              icon={<GitHubMark size={14} />}
              title={installation.accountLogin}
              description={installation.accountType === 'Organization' ? 'Organization' : 'Personal account'}
            >
              <Button variant="ghost" size="sm" disabled={busy === installation.installationId} onClick={() => void disconnect(installation.installationId)}>
                Disconnect
              </Button>
            </SettingsAppRow>
          ))}
        </SettingsGroup>
      ) : installations ? (
        <SettingsGroup>
          <SettingsAppRow icon={<GitHubMark size={14} />} title="No accounts connected" description="Connect GitHub to choose repositories for your agents." />
        </SettingsGroup>
      ) : null}
    </>
  )
}
