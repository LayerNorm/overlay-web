import { Bot, Link2, Shield, Users, UsersRound, WalletCards } from 'lucide-react'
import type { WorkspaceSettingsTab } from '@/shared/workspaces/types'

export const WORKSPACE_SETTINGS_TABS: ReadonlyArray<{
  id: WorkspaceSettingsTab
  label: string
  icon: typeof Users
  emptyTitle: string
  emptyDescription: string
  action: string
}> = [
  {
    id: 'people',
    label: 'People',
    icon: Users,
    emptyTitle: 'No other people yet',
    emptyDescription: 'Invite teammates to collaborate in chats and on shared resources.',
    action: 'Invite people',
  },
  {
    id: 'chats-agents',
    label: 'Agents',
    icon: Bot,
    emptyTitle: 'No shared agents',
    emptyDescription: 'Named agents for this workspace will be managed here.',
    action: 'Add agent',
  },
  {
    id: 'teams',
    label: 'Teams',
    icon: UsersRound,
    emptyTitle: 'No teams yet',
    emptyDescription: 'Group people and agents so access can be managed together.',
    action: 'Create team',
  },
  {
    id: 'roles',
    label: 'Roles & permissions',
    icon: Shield,
    emptyTitle: 'No custom roles',
    emptyDescription: 'Built-in workspace roles are ready. Custom roles will appear here.',
    action: 'Create role',
  },
  {
    id: 'sharing',
    label: 'Sharing & links',
    icon: Link2,
    emptyTitle: 'Sharing policy',
    emptyDescription: 'Control how resources leave this workspace.',
    action: 'Update policy',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: WalletCards,
    emptyTitle: 'Workspace billing',
    emptyDescription: 'Manage shared credits and usage.',
    action: 'Manage billing',
  },
]

export function isWorkspaceSettingsTab(value: string | null | undefined): value is WorkspaceSettingsTab {
  return WORKSPACE_SETTINGS_TABS.some((tab) => tab.id === value)
}
