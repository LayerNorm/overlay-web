import { AccountClient } from './auth/account-client'
import { BillingClient } from './auth/billing-client'
import { SubscriptionClient } from './auth/subscription-client'
import { TopUpsClient } from './auth/topups-client'
import { AutomationRunsClient } from './automation-runs/client'
import { AutomationsClient } from './automations/client'
import { BootstrapClient } from './bootstrap/client'
import { ChatAuxClient } from './chat/chat-aux-client'
import { ConversationsClient } from './chat/conversations-client'
import { DiscoveryClient } from './discovery/client'
import { FilesClient } from './files/client'
import { IntegrationsClient } from './integrations/client'
import { McpServersClient } from './mcp-servers/client'
import { MemoryClient } from './memory/client'
import { NotesClient } from './notes/client'
import { OnboardingClient } from './onboarding/client'
import { OutputsClient } from './outputs/client'
import { ProjectsClient } from './projects/client'
import { SettingsClient } from './settings/client'
import { SkillsClient } from './skills/client'
import { WebhooksClient } from './webhooks/client'
import { createHttpContext } from './shared/http'
import type { CreateOverlayAppClientOptions } from './shared/types'

export function createOverlayAppClient(options: CreateOverlayAppClientOptions = {}) {
  const http = createHttpContext(options)

  return {
    request: http.request,
    json: http.json,
    bootstrap: new BootstrapClient(http),
    discovery: new DiscoveryClient(http),
    conversations: new ConversationsClient(http),
    files: new FilesClient(http),
    memory: new MemoryClient(http),
    outputs: new OutputsClient(http),
    notes: new NotesClient(http),
    projects: new ProjectsClient(http),
    integrations: new IntegrationsClient(http),
    skills: new SkillsClient(http),
    mcpServers: new McpServersClient(http),
    automations: new AutomationsClient(http),
    settings: new SettingsClient(http),
    subscription: new SubscriptionClient(http),
    account: new AccountClient(http),
    billing: new BillingClient(http),
    topUps: new TopUpsClient(http),
    onboarding: new OnboardingClient(http),
    chat: new ChatAuxClient(http),
    automationRuns: new AutomationRunsClient(http),
    webhooks: new WebhooksClient(http),
  }
}

export type OverlayAppClient = ReturnType<typeof createOverlayAppClient>
