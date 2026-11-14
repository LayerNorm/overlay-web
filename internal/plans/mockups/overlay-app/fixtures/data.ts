import { composeWorkspaceBillingSummary } from '@/shared/billing/workspace-billing-summary'
import { defineQueries } from './convex'
import { route } from './fetch'
import { installWorkFixtures } from './work'
import { installAgentFixtures } from './agents'
import { installRoomFixtures } from './rooms'
import { installWorkspaceFixtures } from './workspace'

export const NOW = Date.now()
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const MOCK_USER = {
  id: 'user_mercedes',
  email: 'mercedes@northwind.example',
  firstName: 'Mercedes',
  lastName: 'Alvarez',
  emailVerified: true,
}

export const PERSONAL_WORKSPACE = { id: 'ws_personal', name: 'Personal', slug: 'mercedes', kind: 'personal', status: 'active', role: 'owner', humanMemberCount: 1, agentMemberCount: 3, routingHandle: 'mercedes' }
export const TEAM_WORKSPACE = { id: 'ws_northwind', name: 'Northwind', slug: 'northwind', kind: 'team', status: 'active', role: 'owner', humanMemberCount: 4, agentMemberCount: 5, routingHandle: 'northwind' }
export const WORKSPACE_ID = TEAM_WORKSPACE.id

export const UI_SETTINGS = {
  theme: new URLSearchParams(globalThis.location.search).get('theme') === 'dark' ? 'dark' : 'light',
  lightThemePreset: 'default',
  darkThemePreset: 'default',
  useSecondarySidebar: true,
  chatStreamingMode: 'token',
  autoContinue: true,
  collapseAgentWork: true,
  linkOpenPreference: 'in-app',
  defaultChatMode: 'ask',
}

const ENTITLEMENTS = {
  tier: 'pro',
  planKind: 'paid',
  status: 'active',
  planAmountCents: 2000,
  creditsUsed: 6.4,
  creditsTotal: 20,
  budgetUsedCents: 640,
  budgetTotalCents: 2000,
  budgetRemainingCents: 1360,
  allowanceTotalCents: 2000,
  allowanceUsedCents: 640,
  allowancePercentUsed: 32,
  topUpBalanceCents: 0,
  overlayStorageBytesUsed: 1.3 * 1024 ** 3,
  overlayStorageBytesLimit: 10 * 1024 ** 3,
  dailyUsage: { ask: 12, write: 3, agent: 8 },
  dailyLimits: { ask: 1000, write: 1000, agent: 1000 },
}

const BILLING_SUMMARY = composeWorkspaceBillingSummary({
  workspaceId: WORKSPACE_ID,
  canManage: true,
  canTopUp: true,
  billingEnabled: true,
  storage: { usedBytes: ENTITLEMENTS.overlayStorageBytesUsed, limitBytes: ENTITLEMENTS.overlayStorageBytesLimit },
  account: { status: 'active', pricingVersion: 'markup_25_v1' },
  balance: { budgetTotalCents: 2000, budgetUsedCents: 640, budgetRemainingCents: 1360, allowancePercentUsed: 32, topUpBalanceCents: 0 },
  plan: { planKind: 'paid', planAmountCents: 2000, status: 'active', currentPeriodStart: NOW - 9 * DAY, currentPeriodEnd: NOW + 21 * DAY },
  usageTotals: { totals: [], truncated: false },
  now: NOW,
})

export function installFixtures() {
  route('GET', /^\/api\/auth\/session$/, () => ({ authenticated: true, user: MOCK_USER }))
  route('GET', /^\/api\/v1\/onboarding\/session$/, () => ({ completed: true, session: null }))
  defineQueries({
    'auth/accountBrowse:identity': { displayName: 'Mercedes Alvarez', photoUrl: null, displayNameOverride: null, hasCustomPhoto: false, email: MOCK_USER.email },
    'platform/uiSettings:mine': UI_SETTINGS,
    'collaboration/directory:workspaces': { workspaces: [PERSONAL_WORKSPACE, TEAM_WORKSPACE], activeWorkspaceId: WORKSPACE_ID, invitations: [] },
    'collaboration/directory:policy': ({ workspaceId }: { workspaceId?: string }) => ({
      policy: { workspaceId, workspaceContentEditors: 'members', workspaceExtensionsEditors: 'members', memberCanMoveScope: true, memberCanCreateChannels: true, memberCanCreateAgents: true, updatedAt: NOW - 30 * DAY },
      canManage: true,
    }),
    'collaboration/activity:notifications': [],
    'billing/browse:workspaceSummary': BILLING_SUMMARY,
    'billing/browse:entitlements': ENTITLEMENTS,
  })
  installWorkFixtures()
  installAgentFixtures()
  installRoomFixtures()
  installWorkspaceFixtures()
}
