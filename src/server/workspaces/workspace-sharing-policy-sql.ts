import { sql, type SQL } from 'drizzle-orm'
import type { SetWorkspaceSharingPolicyInput } from './WorkspaceRepository'

/**
 * Keep the patch semantics for workspace governance in one SQL boundary.
 * COALESCE preserves stored values for omitted fields while the explicit
 * presence checks preserve an intentional null reset.
 */
export function buildWorkspaceSharingPolicyUpsert(
  input: SetWorkspaceSharingPolicyInput,
  returning: SQL,
): SQL {
  return sql`
    INSERT INTO workspace_sharing_policies (
      workspace_id, public_links_enabled, member_can_create_channels,
      member_can_create_agents, member_can_invite, guest_expiration_days,
      allowed_agent_harnesses, agent_run_budget_cents, channel_retention_days,
      legal_hold, data_residency, rollout_stage,
      updated_by_principal_id, created_at, updated_at
    ) VALUES (
      ${buildPolicyInsertValues(input)}
    )
    ON CONFLICT (workspace_id) DO UPDATE SET ${buildPolicyUpdateValues(input)}
    RETURNING ${returning}
  `
}

function buildPolicyInsertValues(input: SetWorkspaceSharingPolicyInput): SQL {
  return sql`
    ${input.workspaceId},
    ${input.patch.publicLinksEnabled ?? true},
    ${input.patch.memberCanCreateChannels ?? true},
    ${input.patch.memberCanCreateAgents ?? true},
    ${input.patch.memberCanInvite ?? false},
    ${input.patch.guestExpirationDays ?? null},
    ${input.patch.allowedAgentHarnesses ? textArray(input.patch.allowedAgentHarnesses) : sql`NULL`},
    ${input.patch.agentRunBudgetCents ?? null},
    ${input.patch.channelRetentionDays ?? null},
    ${input.patch.legalHold ?? false},
    ${input.patch.dataResidency ?? null},
    ${input.patch.rolloutStage ?? 'general'},
    ${input.updatedByPrincipalId}, ${new Date(input.now)}, ${new Date(input.now)}
  `
}

function buildPolicyUpdateValues(input: SetWorkspaceSharingPolicyInput): SQL {
  return sql`
    public_links_enabled = COALESCE(${input.patch.publicLinksEnabled ?? null}, workspace_sharing_policies.public_links_enabled),
    member_can_create_channels = COALESCE(${input.patch.memberCanCreateChannels ?? null}, workspace_sharing_policies.member_can_create_channels),
    member_can_create_agents = COALESCE(${input.patch.memberCanCreateAgents ?? null}, workspace_sharing_policies.member_can_create_agents),
    member_can_invite = COALESCE(${input.patch.memberCanInvite ?? null}, workspace_sharing_policies.member_can_invite),
    guest_expiration_days = ${'guestExpirationDays' in input.patch ? sql`${input.patch.guestExpirationDays ?? null}` : sql`workspace_sharing_policies.guest_expiration_days`},
    allowed_agent_harnesses = ${'allowedAgentHarnesses' in input.patch
      ? (input.patch.allowedAgentHarnesses ? textArray(input.patch.allowedAgentHarnesses) : sql`NULL`)
      : sql`workspace_sharing_policies.allowed_agent_harnesses`},
    agent_run_budget_cents = ${'agentRunBudgetCents' in input.patch ? sql`${input.patch.agentRunBudgetCents ?? null}` : sql`workspace_sharing_policies.agent_run_budget_cents`},
    channel_retention_days = ${'channelRetentionDays' in input.patch ? sql`${input.patch.channelRetentionDays ?? null}` : sql`workspace_sharing_policies.channel_retention_days`},
    legal_hold = COALESCE(${input.patch.legalHold ?? null}, workspace_sharing_policies.legal_hold),
    data_residency = ${'dataResidency' in input.patch ? sql`${input.patch.dataResidency ?? null}` : sql`workspace_sharing_policies.data_residency`},
    rollout_stage = COALESCE(${input.patch.rolloutStage ?? null}, workspace_sharing_policies.rollout_stage),
    updated_by_principal_id = excluded.updated_by_principal_id,
    updated_at = excluded.updated_at
  `
}

/** Postgres text[] literals: an empty list must still be typed. */
function textArray(values: readonly string[] | undefined): SQL {
  if (!values?.length) return sql`'{}'::text[]`
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`
}
