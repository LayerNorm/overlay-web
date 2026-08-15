/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_administration from "../admin/administration.js";
import type * as admin_authorization from "../admin/authorization.js";
import type * as admin_governance from "../admin/governance.js";
import type * as ai_sandbox_daytona from "../ai/sandbox/daytona.js";
import type * as ai_sandbox_daytonaReconcile from "../ai/sandbox/daytonaReconcile.js";
import type * as auth_apiKeys from "../auth/apiKeys.js";
import type * as auth_authDebug from "../auth/authDebug.js";
import type * as auth_serviceAuth from "../auth/serviceAuth.js";
import type * as auth_sessionTransfer from "../auth/sessionTransfer.js";
import type * as auth_users from "../auth/users.js";
import type * as automations_automationRunner from "../automations/automationRunner.js";
import type * as automations_automations from "../automations/automations.js";
import type * as automations_workflowEventProjector from "../automations/workflowEventProjector.js";
import type * as automations_workflowEventProjectorRunner from "../automations/workflowEventProjectorRunner.js";
import type * as automations_workflowEvents from "../automations/workflowEvents.js";
import type * as billing_accountMigration from "../billing/accountMigration.js";
import type * as billing_accountModel from "../billing/accountModel.js";
import type * as billing_accountSubscriptions from "../billing/accountSubscriptions.js";
import type * as billing_accounts from "../billing/accounts.js";
import type * as billing_lib_stripeOverlaySubscription from "../billing/lib/stripeOverlaySubscription.js";
import type * as billing_spendLimits from "../billing/spendLimits.js";
import type * as billing_stripe from "../billing/stripe.js";
import type * as billing_stripeSync from "../billing/stripeSync.js";
import type * as billing_subscriptions from "../billing/subscriptions.js";
import type * as chat_conversations from "../chat/conversations.js";
import type * as collaboration_agents from "../collaboration/agents.js";
import type * as collaboration_channels from "../collaboration/channels.js";
import type * as collaboration_conversationMigration from "../collaboration/conversationMigration.js";
import type * as collaboration_directMessages from "../collaboration/directMessages.js";
import type * as collaboration_events from "../collaboration/events.js";
import type * as collaboration_sharing from "../collaboration/sharing.js";
import type * as collaboration_workspaces from "../collaboration/workspaces.js";
import type * as crons from "../crons.js";
import type * as email_deliveryRunner from "../email/deliveryRunner.js";
import type * as email_outbox from "../email/outbox.js";
import type * as files_files from "../files/files.js";
import type * as files_ingestion_jobs from "../files/ingestion/jobs.js";
import type * as files_ingestion_runner from "../files/ingestion/runner.js";
import type * as files_lib_storageQuota from "../files/lib/storageQuota.js";
import type * as files_notes from "../files/notes.js";
import type * as files_storageAdmin from "../files/storageAdmin.js";
import type * as http from "../http.js";
import type * as imports_slackImporter from "../imports/slackImporter.js";
import type * as imports_slackJobs from "../imports/slackJobs.js";
import type * as imports_slackMappings from "../imports/slackMappings.js";
import type * as imports_slackRunner from "../imports/slackRunner.js";
import type * as integrations_mcpServers from "../integrations/mcpServers.js";
import type * as integrations_skills from "../integrations/skills.js";
import type * as integrations_workspaceConnectors from "../integrations/workspaceConnectors.js";
import type * as knowledge_bases from "../knowledge/bases.js";
import type * as knowledge_knowledge from "../knowledge/knowledge.js";
import type * as knowledge_memories from "../knowledge/memories.js";
import type * as knowledge_memoryExtractor from "../knowledge/memoryExtractor.js";
import type * as knowledge_memoryExtractorNode from "../knowledge/memoryExtractorNode.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_authDebug from "../lib/authDebug.js";
import type * as lib_browserConvexToken from "../lib/browserConvexToken.js";
import type * as lib_gatewayCatalogPricing from "../lib/gatewayCatalogPricing.js";
import type * as lib_logging from "../lib/logging.js";
import type * as lib_metrics from "../lib/metrics.js";
import type * as lib_workspaceMembership from "../lib/workspaceMembership.js";
import type * as migrations_backfillWorkspaceIds from "../migrations/backfillWorkspaceIds.js";
import type * as outputs_outputs from "../outputs/outputs.js";
import type * as platform_gatewayCatalog from "../platform/gatewayCatalog.js";
import type * as platform_http from "../platform/http.js";
import type * as platform_idempotency from "../platform/idempotency.js";
import type * as platform_metrics from "../platform/metrics.js";
import type * as platform_migrations from "../platform/migrations.js";
import type * as platform_rateLimits from "../platform/rateLimits.js";
import type * as platform_seedDemoAccount from "../platform/seedDemoAccount.js";
import type * as platform_uiSettings from "../platform/uiSettings.js";
import type * as platform_usage from "../platform/usage.js";
import type * as projects_projects from "../projects/projects.js";
import type * as search_mentions from "../search/mentions.js";
import type * as webhooks_deliveries from "../webhooks/deliveries.js";
import type * as webhooks_deliveryRunner from "../webhooks/deliveryRunner.js";
import type * as webhooks_subscriptions from "../webhooks/subscriptions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/administration": typeof admin_administration;
  "admin/authorization": typeof admin_authorization;
  "admin/governance": typeof admin_governance;
  "ai/sandbox/daytona": typeof ai_sandbox_daytona;
  "ai/sandbox/daytonaReconcile": typeof ai_sandbox_daytonaReconcile;
  "auth/apiKeys": typeof auth_apiKeys;
  "auth/authDebug": typeof auth_authDebug;
  "auth/serviceAuth": typeof auth_serviceAuth;
  "auth/sessionTransfer": typeof auth_sessionTransfer;
  "auth/users": typeof auth_users;
  "automations/automationRunner": typeof automations_automationRunner;
  "automations/automations": typeof automations_automations;
  "automations/workflowEventProjector": typeof automations_workflowEventProjector;
  "automations/workflowEventProjectorRunner": typeof automations_workflowEventProjectorRunner;
  "automations/workflowEvents": typeof automations_workflowEvents;
  "billing/accountMigration": typeof billing_accountMigration;
  "billing/accountModel": typeof billing_accountModel;
  "billing/accountSubscriptions": typeof billing_accountSubscriptions;
  "billing/accounts": typeof billing_accounts;
  "billing/lib/stripeOverlaySubscription": typeof billing_lib_stripeOverlaySubscription;
  "billing/spendLimits": typeof billing_spendLimits;
  "billing/stripe": typeof billing_stripe;
  "billing/stripeSync": typeof billing_stripeSync;
  "billing/subscriptions": typeof billing_subscriptions;
  "chat/conversations": typeof chat_conversations;
  "collaboration/agents": typeof collaboration_agents;
  "collaboration/channels": typeof collaboration_channels;
  "collaboration/conversationMigration": typeof collaboration_conversationMigration;
  "collaboration/directMessages": typeof collaboration_directMessages;
  "collaboration/events": typeof collaboration_events;
  "collaboration/sharing": typeof collaboration_sharing;
  "collaboration/workspaces": typeof collaboration_workspaces;
  crons: typeof crons;
  "email/deliveryRunner": typeof email_deliveryRunner;
  "email/outbox": typeof email_outbox;
  "files/files": typeof files_files;
  "files/ingestion/jobs": typeof files_ingestion_jobs;
  "files/ingestion/runner": typeof files_ingestion_runner;
  "files/lib/storageQuota": typeof files_lib_storageQuota;
  "files/notes": typeof files_notes;
  "files/storageAdmin": typeof files_storageAdmin;
  http: typeof http;
  "imports/slackImporter": typeof imports_slackImporter;
  "imports/slackJobs": typeof imports_slackJobs;
  "imports/slackMappings": typeof imports_slackMappings;
  "imports/slackRunner": typeof imports_slackRunner;
  "integrations/mcpServers": typeof integrations_mcpServers;
  "integrations/skills": typeof integrations_skills;
  "integrations/workspaceConnectors": typeof integrations_workspaceConnectors;
  "knowledge/bases": typeof knowledge_bases;
  "knowledge/knowledge": typeof knowledge_knowledge;
  "knowledge/memories": typeof knowledge_memories;
  "knowledge/memoryExtractor": typeof knowledge_memoryExtractor;
  "knowledge/memoryExtractorNode": typeof knowledge_memoryExtractorNode;
  "lib/auth": typeof lib_auth;
  "lib/authDebug": typeof lib_authDebug;
  "lib/browserConvexToken": typeof lib_browserConvexToken;
  "lib/gatewayCatalogPricing": typeof lib_gatewayCatalogPricing;
  "lib/logging": typeof lib_logging;
  "lib/metrics": typeof lib_metrics;
  "lib/workspaceMembership": typeof lib_workspaceMembership;
  "migrations/backfillWorkspaceIds": typeof migrations_backfillWorkspaceIds;
  "outputs/outputs": typeof outputs_outputs;
  "platform/gatewayCatalog": typeof platform_gatewayCatalog;
  "platform/http": typeof platform_http;
  "platform/idempotency": typeof platform_idempotency;
  "platform/metrics": typeof platform_metrics;
  "platform/migrations": typeof platform_migrations;
  "platform/rateLimits": typeof platform_rateLimits;
  "platform/seedDemoAccount": typeof platform_seedDemoAccount;
  "platform/uiSettings": typeof platform_uiSettings;
  "platform/usage": typeof platform_usage;
  "projects/projects": typeof projects_projects;
  "search/mentions": typeof search_mentions;
  "webhooks/deliveries": typeof webhooks_deliveries;
  "webhooks/deliveryRunner": typeof webhooks_deliveryRunner;
  "webhooks/subscriptions": typeof webhooks_subscriptions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
};
