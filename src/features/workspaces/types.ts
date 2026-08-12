export type {
  WorkspaceOperationalMetrics,
  WorkspaceSharingPolicy,
  WorkspaceSharingPolicyPatch,
  WorkspaceSharingPolicyResponse,
  WorkspaceRolloutStage,
  WorkspaceActivateResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceKind,
  WorkspaceListResponse,
  WorkspaceMembershipRole,
  WorkspaceStatus,
  WorkspaceSummary,
  WorkspaceManagementItem,
  WorkspaceManagementResponse,
  WorkspaceManagementView,
  WorkspaceBillingCheckoutInput,
  WorkspaceBillingSummaryResponse,
  WorkspaceBillingTopUpInput,
  WorkspaceBillingVerificationInput,
  WorkspaceBillingVerificationResponse,
} from '@overlay/workspace-contracts'

import type {
  WorkspaceActivateResponse,
  WorkspaceCreateInput,
  WorkspaceCreateResponse,
  WorkspaceListResponse,
  WorkspaceInviteInput,
  WorkspaceInviteResponse,
  WorkspaceManagementResponse,
  WorkspaceManagementView,
  WorkspaceBillingCheckoutInput,
  WorkspaceBillingSummaryResponse,
  WorkspaceBillingTopUpInput,
  WorkspaceBillingVerificationInput,
  WorkspaceBillingVerificationResponse,
  WorkspaceMemberMutationInput,
  WorkspaceMemberMutationResponse,
  WorkspaceOperationalMetrics,
  WorkspaceSharingPolicyPatch,
  WorkspaceSharingPolicyResponse,
  WorkspaceTeamCreateInput,
  WorkspaceTeamCreateResponse,
} from '@overlay/workspace-contracts'

export interface WorkspaceClient {
  list(signal?: AbortSignal): Promise<WorkspaceListResponse>
  create(input: WorkspaceCreateInput): Promise<WorkspaceCreateResponse>
  activate(workspaceId: string): Promise<WorkspaceActivateResponse>
}

export type WorkspaceLifecycleStatus = 'idle' | 'loading' | 'ready' | 'error'

export type WorkspaceSettingsTab =
  WorkspaceManagementView | 'billing'

export interface WorkspaceManagementLoader {
  load(
    workspaceId: string,
    tab: WorkspaceSettingsTab,
    signal?: AbortSignal,
  ): Promise<WorkspaceManagementResponse>
}

export interface WorkspaceManagementClient extends WorkspaceManagementLoader {
  billing(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceBillingSummaryResponse>
  initializeBilling(workspaceId: string): Promise<WorkspaceBillingSummaryResponse>
  createBillingCheckout(workspaceId: string, input: WorkspaceBillingCheckoutInput): Promise<{ url: string | null }>
  createBillingTopUp(workspaceId: string, input: WorkspaceBillingTopUpInput): Promise<{ url: string | null }>
  createBillingPortal(workspaceId: string): Promise<{ url: string | null }>
  verifyBillingCheckout(
    workspaceId: string,
    input: WorkspaceBillingVerificationInput,
  ): Promise<WorkspaceBillingVerificationResponse>
  sharingPolicy(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceSharingPolicyResponse>
  setSharingPolicy(
    workspaceId: string,
    input: WorkspaceSharingPolicyPatch,
  ): Promise<WorkspaceSharingPolicyResponse>
  /** Owner/admin only; absent on clients that do not surface governance. */
  operationalMetrics?(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceOperationalMetrics>
  invite(workspaceId: string, input: WorkspaceInviteInput): Promise<WorkspaceInviteResponse>
  resendInvitation(workspaceId: string, invitationId: string): Promise<WorkspaceInviteResponse>
  cancelInvitation(workspaceId: string, invitationId: string): Promise<void>
  updateMember(
    workspaceId: string,
    input: WorkspaceMemberMutationInput,
  ): Promise<WorkspaceMemberMutationResponse>
  removeMember(workspaceId: string, principalId: string): Promise<void>
  createTeam(
    workspaceId: string,
    input: WorkspaceTeamCreateInput,
  ): Promise<WorkspaceTeamCreateResponse>
  archiveTeam(workspaceId: string, teamId: string): Promise<void>
  addTeamMember(workspaceId: string, teamId: string, principalId: string): Promise<void>
  removeTeamMember(workspaceId: string, teamId: string, principalId: string): Promise<void>
  archiveWorkspace(workspaceId: string): Promise<void>
}
