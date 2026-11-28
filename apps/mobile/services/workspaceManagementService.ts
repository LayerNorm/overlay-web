/**
 * Workspace management facade — wraps the typed `mobileOverlayAppClient`
 * workspaces + sharing surfaces plus the raw endpoints the typed client
 * doesn't cover (governance metrics, audit export).
 *
 * Mirrors the web `workspaceManagementClient` / `WorkspaceSettingsPanel`
 * call graph: every call carries the active-workspace header (Phase 0
 * plumbing) so organization workspaces stay scoped.
 */
import type {
  ChannelVisibility,
  ConversationParticipant,
  WorkspaceBillingSummaryResponse,
  WorkspaceInvitation,
  WorkspaceInvitationAcceptResponse,
  WorkspaceManagementResponse,
  WorkspaceManagementView,
  WorkspaceMemberMutationInput,
  WorkspaceMembershipRole,
  WorkspaceOperationalMetrics,
  WorkspaceResourceGrant,
  WorkspaceResourceShareResponse,
  WorkspaceShareAccessRole,
  WorkspaceShareImpact,
  WorkspaceShareResourceType,
  WorkspaceShareTargetType,
  WorkspaceSharingPolicy,
} from '@overlay/workspace-contracts'
import { appJson, appRequest } from './appApi'
import { mobileOverlayAppClient } from './overlayClient'
import { api, queryConvex } from './convexClient'

/** Mirrors `WorkspaceSharedResource` in @overlay/api-client (not re-exported
 *  by the package index). */
export type WorkspaceSharedResource = {
  kind: 'conversation' | 'file' | 'automation' | 'agent'
  id: string
  title: string
  snippet?: string
  subtitle?: string
  sharedVia?: 'direct' | 'team' | 'room'
  accessRole?: WorkspaceShareAccessRole
  updatedAt?: number
}

export type { WorkspaceManagementView }

// ---------------------------------------------------------------------------
// Management views — `GET /workspaces/{id}/management?view=`
// ---------------------------------------------------------------------------

export async function loadManagementView(
  workspaceId: string,
  view: WorkspaceManagementView,
): Promise<WorkspaceManagementResponse> {
  if (view === 'sharing') return mobileOverlayAppClient.workspaces.management(workspaceId, view)
  const result = await queryConvex(api.collaboration.management.view, { workspaceId, view })
  if (!result) throw new Error('Workspace management is unavailable.')
  return result
}

// ---------------------------------------------------------------------------
// Members + invitations
// ---------------------------------------------------------------------------

export async function inviteToWorkspace(
  workspaceId: string,
  email: string,
  role: Exclude<WorkspaceMembershipRole, 'owner'>,
): Promise<{ invitation: WorkspaceInvitation; invitePath: string }> {
  return mobileOverlayAppClient.workspaces.invite(workspaceId, { email, role })
}

export async function resendWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await mobileOverlayAppClient.workspaces.resendInvitation(workspaceId, invitationId)
}

export async function cancelWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await mobileOverlayAppClient.workspaces.cancelInvitation(workspaceId, invitationId)
}

export async function updateWorkspaceMember(
  workspaceId: string,
  input: WorkspaceMemberMutationInput,
): Promise<void> {
  await mobileOverlayAppClient.workspaces.updateMember(workspaceId, input)
}

/** Owners and admins set (cents) or remove (`null`) a person's spending cap for each billing period. */
export async function setMemberSpendCap(workspaceId: string, userId: string, capCents: number | null): Promise<void> {
  await appJson(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/billing/member-caps`, {
    method: 'POST',
    workspaceId,
    json: { userId, capCents },
  })
}

export async function removeWorkspaceMember(
  workspaceId: string,
  principalId: string,
): Promise<void> {
  await mobileOverlayAppClient.workspaces.removeMember(workspaceId, principalId)
}

export async function acceptWorkspaceInvitation(
  invitationId: string,
): Promise<WorkspaceInvitationAcceptResponse> {
  return mobileOverlayAppClient.workspaces.acceptInvitation(invitationId)
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function createWorkspaceTeam(
  workspaceId: string,
  name: string,
  description?: string,
): Promise<void> {
  await mobileOverlayAppClient.workspaces.createTeam(workspaceId, {
    name,
    ...(description ? { description } : {}),
  })
}

export async function archiveWorkspaceTeam(workspaceId: string, teamId: string): Promise<void> {
  await mobileOverlayAppClient.workspaces.archiveTeam(workspaceId, teamId)
}

export async function setTeamMembership(
  workspaceId: string,
  teamId: string,
  principalId: string,
  member: boolean,
): Promise<void> {
  if (member) {
    await mobileOverlayAppClient.workspaces.addTeamMember(workspaceId, teamId, { principalId })
  } else {
    await mobileOverlayAppClient.workspaces.removeTeamMember(workspaceId, teamId, { principalId })
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function archiveWorkspace(workspaceId: string): Promise<void> {
  await mobileOverlayAppClient.workspaces.archive(workspaceId)
}

// ---------------------------------------------------------------------------
// Sharing policy + governance
// ---------------------------------------------------------------------------

export async function loadSharingPolicy(
  workspaceId: string,
): Promise<{ policy: WorkspaceSharingPolicy; canManage: boolean }> {
  return mobileOverlayAppClient.workspaces.sharingPolicy(workspaceId)
}

export async function updateSharingPolicy(
  workspaceId: string,
  patch: Partial<WorkspaceSharingPolicy>,
): Promise<{ policy: WorkspaceSharingPolicy; canManage: boolean }> {
  // The typed client only exposes `publicLinksEnabled`; the PATCH route accepts
  // the full WorkspaceSharingPolicyPatch, so call it directly.
  return appJson<{ policy: WorkspaceSharingPolicy; canManage: boolean }>(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/policies`,
    { method: 'PATCH', json: patch, workspaceId },
  )
}

/** Owner/admin-only operational signals; members get 403 → caller degrades. */
export async function loadOperationalMetrics(
  workspaceId: string,
): Promise<WorkspaceOperationalMetrics> {
  const data = await appJson<{ metrics: WorkspaceOperationalMetrics }>(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/governance`,
    { query: { view: 'metrics' }, workspaceId },
  )
  return data.metrics
}

/**
 * Audit export — newline-delimited JSON download. Returns the raw text so
 * the caller can persist/share it as a file (matches the web's
 * `workspace-audit-*.ndjson` attachment).
 */
export async function exportWorkspaceAudit(
  workspaceId: string,
  options: { from?: number; limit?: number } = {},
): Promise<string> {
  const response = await appRequest(
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/audit-export`,
    {
      query: {
        ...(options.from ? { from: options.from } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
      },
      workspaceId,
    },
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `Audit export failed (${response.status})`)
  }
  return response.text()
}

// ---------------------------------------------------------------------------
// Billing — display-only on mobile (App Store: checkout/portal stay on web).
// ---------------------------------------------------------------------------

export async function loadWorkspaceBilling(
  workspaceId: string,
): Promise<WorkspaceBillingSummaryResponse> {
  const result = await queryConvex(api.billing.browse.workspaceSummary, { workspaceId })
  if (!result) throw new Error('Billing information is unavailable.')
  return result
}

// ---------------------------------------------------------------------------
// Shared with me + per-resource grants
// ---------------------------------------------------------------------------

export async function loadSharedWithMe(workspaceId: string): Promise<WorkspaceSharedResource[]> {
  const { results } = await mobileOverlayAppClient.sharing.sharedWithMe(workspaceId)
  return results
}

export interface ShareResourceRef {
  workspaceId: string
  resourceType: WorkspaceShareResourceType
  resourceId: string
}

export async function loadResourceShares(
  resource: ShareResourceRef,
): Promise<WorkspaceResourceShareResponse> {
  return mobileOverlayAppClient.sharing.get(resource)
}

export async function grantResourceShare(
  resource: ShareResourceRef,
  input: {
    targetType: WorkspaceShareTargetType
    targetId: string
    accessRole: WorkspaceShareAccessRole
    confirmRoomExpansion?: boolean
  },
): Promise<WorkspaceResourceGrant> {
  const { grant } = await mobileOverlayAppClient.sharing.grant(resource, input)
  return grant
}

export async function revokeResourceShare(
  resource: ShareResourceRef,
  grantId: string,
): Promise<void> {
  await mobileOverlayAppClient.sharing.revoke(resource, grantId)
}

export async function shareImpact(
  resource: ShareResourceRef,
  target:
    | { targetType: WorkspaceShareTargetType; targetId: string }
    | { grantId: string },
): Promise<WorkspaceShareImpact> {
  const { impact } = await mobileOverlayAppClient.sharing.impact(resource, target)
  return impact
}

export type { ConversationParticipant, ChannelVisibility }
