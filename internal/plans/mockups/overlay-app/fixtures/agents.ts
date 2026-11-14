import { AVAILABLE_MODELS } from '@/shared/ai/gateway/model-data'
import { defineQueries } from './convex'
import { route } from './fetch'

const NOW = Date.now()
const DAY = 86_400_000

export const VIEWER_PRINCIPAL = 'p_mercedes'

type AgentFixture = Record<string, unknown> & { id: string; principalId: string; name: string; avatarColor?: string; avatarShape?: string; isDefault?: boolean }
type PersonFixture = { principalId: string; type: string; userId: string | null; displayName: string; role: string; email?: string; agentId?: string; avatarColor?: string; avatarShape?: string; isDefault?: boolean }

function agent(partial: Record<string, unknown> & { id: string; principalId: string; name: string }): AgentFixture {
  return {
    workspaceId: 'ws_northwind',
    instructions: '',
    harness: 'overlay',
    modelId: 'anthropic/claude-sonnet-5.5',
    reasoning: 'medium',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: VIEWER_PRINCIPAL,
    createdByDisplayName: 'Mercedes Alvarez',
    createdAt: NOW - 40 * DAY,
    updatedAt: NOW - 2 * DAY,
    teamIds: [],
    roomCount: 2,
    agentRole: 'agent',
    canEdit: true,
    ...partial,
  }
}

export const AGENTS = [
  agent({ id: 'agent_overlay', principalId: 'p_overlay', name: 'Overlay', description: 'Your chief of staff. Plans the work, delegates to your team and keeps everything moving.', agentRole: 'workspace_chief', chiefScope: 'workspace', isDefault: true, modelId: 'anthropic/claude-opus-5.5', roomCount: 6 }),
  agent({ id: 'agent_chief', principalId: 'p_chief', name: 'Overlay', description: 'Your personal chief of staff for email, calendar and private work.', agentRole: 'personal_chief', chiefScope: 'personal', visibility: 'private', isDefault: true, modelId: 'anthropic/claude-opus-5.5', roomCount: 1, instructions: 'Keep my week organized. Draft replies in my voice and ask before sending anything external.' }),
  agent({ id: 'agent_scout', principalId: 'p_scout', name: 'Scout', description: 'Market and customer research with cited sources.', instructions: 'Research markets, competitors and customers. Cite every source and say how confident you are.', avatarShape: 'blob', avatarColor: '#7c8db5', modelId: 'openai/gpt-6.1-sol' }),
  agent({ id: 'agent_atlas', principalId: 'p_atlas', name: 'Atlas', description: 'Ships code changes, reviews pull requests and runs tests.', avatarShape: 'hexagon', avatarColor: '#5b8c6e', harness: 'claude-code', modelId: 'anthropic/claude-opus-5.5' }),
  agent({ id: 'agent_quill', principalId: 'p_quill', name: 'Quill', createdByPrincipalId: 'p_sam', createdByDisplayName: 'Sam Okafor', canEdit: false, description: 'Writes launch posts, release notes and customer emails in the Northwind voice.', avatarShape: 'droplet', avatarColor: '#c48a5a' }),
  agent({ id: 'agent_ledger', principalId: 'p_ledger', name: 'Ledger', createdByPrincipalId: 'p_priya', createdByDisplayName: 'Priya Nair', canEdit: false, description: 'Reconciles invoices, tracks spend and prepares the monthly finance pack.', avatarShape: 'squircle', avatarColor: '#8a6fb0', modelId: 'google/gemini-4-argon' }),
]

export const PEOPLE: PersonFixture[] = [
  { principalId: VIEWER_PRINCIPAL, type: 'human', userId: 'user_mercedes', displayName: 'Mercedes Alvarez', email: 'mercedes@northwind.example', role: 'owner' },
  { principalId: 'p_sam', type: 'human', userId: 'user_sam', displayName: 'Sam Okafor', email: 'sam@northwind.example', role: 'admin' },
  { principalId: 'p_priya', type: 'human', userId: 'user_priya', displayName: 'Priya Nair', email: 'priya@northwind.example', role: 'member' },
  { principalId: 'p_jonah', type: 'human', userId: 'user_jonah', displayName: 'Jonah Kim', email: 'jonah@northwind.example', role: 'member' },
  ...AGENTS.map((entry) => ({ principalId: entry.principalId, type: 'agent', userId: null, displayName: entry.name, agentId: entry.id, avatarColor: entry.avatarColor, avatarShape: entry.avatarShape, isDefault: entry.isDefault, role: 'member' })),
]

const CATALOG = AVAILABLE_MODELS.map((model) => ({
  id: model.id,
  gatewayId: model.id,
  name: model.name,
  type: 'language',
  provider: model.provider,
  tags: [...(model.supportsVision ? ['vision'] : []), ...(model.supportsReasoning ? ['reasoning'] : [])],
  pricing: {},
  inputPricePerMillion: model.cost === 3 ? 15 : model.cost === 2 ? 3 : 0.5,
  outputPricePerMillion: model.cost === 3 ? 75 : model.cost === 2 ? 15 : 2,
}))

export function installAgentFixtures() {
  route('GET', /^\/api\/v1\/model-catalog$/, () => ({ models: CATALOG }))
  route('GET', /^\/api\/v1\/providers\/connections$/, () => ({ connections: [] }))
  defineQueries({
    'auth/viewer:current': { userId: 'user_mercedes' },
    'auth/viewer:workspace': ({ workspaceId }: { workspaceId: string }) => ({ userId: 'user_mercedes', workspaceId, principalId: VIEWER_PRINCIPAL, role: 'owner' }),
    'agents/directory:list': { agents: AGENTS, canCreate: true, viewerPrincipalId: VIEWER_PRINCIPAL },
    'agents/directory:get': ({ agentId }: { agentId: string }) => AGENTS.find((entry) => entry.id === agentId) ?? null,
    'providers/browse:connections': [],
    'agents/environmentsBrowse:launchEnabled': true,
    'agents/environmentsBrowse:list': [],
    'computers/browse:list': [],
    'surfaces/browse:forAgent': { connections: [], bindings: [], canBind: true },
    'agents/environmentsBrowse:bindings': [],
  })
}
