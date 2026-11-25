'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { Building2, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { Button, ListboxSelect, toast } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { SettingsGroup, SettingsToggle } from '@overlay/modules-react/settings'
import { SlackMark } from '@/components/brand/AppMarks'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { SettingsAppRow } from './SettingsAppRow'
import { api } from '../../../../../convex/_generated/api'

const RETURN_TO = '/app/settings?section=connected-apps&app=slack'

const RESULT_MESSAGES: Record<string, string> = {
  installed: 'Overlay was added to Slack.',
  linked: 'Your Slack account is linked.',
}

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: 'Slack isn’t set up on this deployment.',
  not_installed: 'Add Overlay to Slack before linking your account.',
  forbidden: 'Only workspace owners and admins can add Overlay to Slack.',
  other_workspace: 'That Slack workspace is already connected to another Overlay workspace.',
  other_team: 'This Overlay workspace is connected to a different Slack workspace.',
  enterprise_install: 'Overlay can’t be installed org-wide on Enterprise Grid yet; install it in a single workspace.',
  cancelled: 'Slack was cancelled.',
  expired: 'That link expired. Try again.',
  signed_in_as_someone_else: 'You were signed in to Overlay as someone else. Try again.',
}

function slackFlowUrl(path: 'install' | 'link', workspaceId: string): string {
  return '/api/v1/integrations/slack/' + path + '?' + new URLSearchParams({ workspaceId, returnTo: RETURN_TO }).toString()
}

/** Settings › Connected apps › Slack: the connected Slack workspace, your linked account and who Overlay answers. */
export function SlackSettings() {
  const router = useRouter()
  const params = useSearchParams()
  const { activeWorkspaceId } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const status = useQuery(api.integrations.slack.status, activeWorkspaceId && isAuthenticated && !isLoading ? { workspaceId: activeWorkspaceId } : 'skip')
  const updateSettings = useMutation(api.integrations.slack.updateSettings)
  const disconnect = useMutation(api.integrations.slack.disconnect)
  const unlink = useMutation(api.integrations.slack.unlink)
  const setPersonAccess = useMutation(api.integrations.slack.setPersonAccess)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const result = params?.get('slack')
  const error = params?.get('slackError')
  useEffect(() => {
    if (!result && !error) return
    if (result) toast.success(RESULT_MESSAGES[result] ?? 'Done.')
    else toast.error(ERROR_MESSAGES[error!] ?? 'Slack couldn’t finish. Try again.')
    router.replace(RETURN_TO)
  }, [result, error, router])

  if (!activeWorkspaceId || status === undefined) return null
  if (status === null) {
    return <SettingsGroup><SettingsAppRow icon={<SlackMark size={14} />} title="Slack" description="Slack settings aren’t available for this workspace." /></SettingsGroup>
  }

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true)
    try {
      await action()
    } catch {
      toast.error(failure)
    } finally {
      setBusy(false)
    }
  }

  const { installation, link, settings, people, canManage } = status
  const save = (change: Partial<typeof settings>) => void run(
    () => updateSettings({ workspaceId: activeWorkspaceId, ...settings, ...change }), 'Couldn’t save the setting.',
  )
  const listMode = settings.whoCanAsk === 'linked' ? null : settings.whoCanAsk
  if (!installation) {
    return (
      <SettingsGroup>
        <SettingsAppRow
          icon={<SlackMark size={14} />}
          title="Not connected"
          description={canManage ? 'Add Overlay to your Slack workspace.' : 'Ask a workspace owner or admin to add Overlay to Slack.'}
        >
          {canManage ? <Button variant="secondary" size="sm" onClick={() => window.location.assign(slackFlowUrl('install', activeWorkspaceId))}>Add to Slack</Button> : null}
        </SettingsAppRow>
      </SettingsGroup>
    )
  }

  return (
    <>
      <SettingsGroup>
        <SettingsAppRow
          icon={<SlackMark size={14} />}
          title={installation.teamName}
          description={installation.installedByName ? 'Connected by ' + installation.installedByName : 'Connected'}
        >
          {canManage ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(true)}>Disconnect</Button> : null}
        </SettingsAppRow>
        <SettingsAppRow
          icon={<UserRound size={15} />}
          title="Your account"
          description={link ? 'Linked as ' + (link.slackUserName ?? link.slackUserId) : 'Link your Slack account to ask Overlay in Slack.'}
        >
          {link
            ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => unlink({ workspaceId: activeWorkspaceId }), 'Couldn’t unlink your account.')}>Unlink</Button>
            : <Button variant="secondary" size="sm" onClick={() => window.location.assign(slackFlowUrl('link', activeWorkspaceId))}>Link</Button>}
        </SettingsAppRow>
      </SettingsGroup>
      <SettingsGroup>
        <SettingsAppRow icon={<UsersRound size={15} />} title="Who can ask Overlay" description="People who can mention or message Overlay in Slack.">
          <ListboxSelect aria-label="Who can ask Overlay" className="w-52" value={settings.whoCanAsk} disabled={!canManage || busy} onChange={(value) => save({ whoCanAsk: value as typeof settings.whoCanAsk })} options={[
            { value: 'linked', label: 'All linked members' },
            { value: 'everyone', label: 'Everyone except blocked' },
            { value: 'specific', label: 'Only allowed people' },
          ]} />
        </SettingsAppRow>
        <SettingsAppRow icon={<Building2 size={15} />} title="Slack Connect" description="Answer linked members in channels shared with other companies. People from those companies can read the answers, which may draw on workspace memories and files.">
          <SettingsToggle
            checked={settings.slackConnect}
            disabled={!canManage || busy}
            onChange={() => save({ slackConnect: !settings.slackConnect })}
            aria-label="Slack Connect"
          />
        </SettingsAppRow>
        <SettingsAppRow icon={<ShieldCheck size={15} />} title="Actions in channels" description="Sending, editing or deleting for someone.">
          <ListboxSelect aria-label="Actions in channels" className="w-44" value={settings.actionsInChannels} disabled onChange={() => undefined} options={[
            { value: 'ask', label: 'Ask first' },
            { value: 'allow', label: 'Allow' },
            { value: 'never', label: 'Never' },
          ]} />
        </SettingsAppRow>
      </SettingsGroup>
      {canManage && listMode ? (
        <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-(--muted)">Linked members</h3>
        <SettingsGroup>
          {people.length === 0
            ? <SettingsAppRow icon={<UsersRound size={15} />} title="No linked members yet" description="People appear here once they link their Slack account." />
            : people.map((person) => {
              const canAsk = listMode === 'specific' ? person.access === 'allowed' : person.access !== 'blocked'
              const next = canAsk
                ? (listMode === 'specific' ? null : 'blocked' as const)
                : (listMode === 'specific' ? 'allowed' as const : null)
              return (
                <SettingsAppRow
                  key={person.userId}
                  icon={<UserRound size={15} />}
                  title={person.name}
                  description={person.slackUserName ? 'Slack: ' + person.slackUserName : 'Linked'}
                >
                  <SettingsToggle
                    checked={canAsk}
                    disabled={busy}
                    onChange={() => void run(() => setPersonAccess({ workspaceId: activeWorkspaceId, userId: person.userId, access: next }), 'Couldn’t save the change.')}
                    aria-label={'Let ' + person.name + ' ask Overlay'}
                  />
                </SettingsAppRow>
              )
            })}
        </SettingsGroup>
        </section>
      ) : null}
      <ConfirmDialog
        isOpen={confirming}
        title="Disconnect Slack?"
        description={'Overlay stops answering in ' + installation.teamName + '. Threads that started in Slack stay in Overlay.'}
        confirmLabel="Disconnect"
        busy={busy}
        busyLabel="Disconnecting…"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void run(async () => {
          await disconnect({ workspaceId: activeWorkspaceId })
          setConfirming(false)
        }, 'Couldn’t disconnect Slack.')}
      />
    </>
  )
}
