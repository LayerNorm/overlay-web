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
import type * as billing_lib_stripeOverlaySubscription from "../billing/lib/stripeOverlaySubscription.js";
import type * as billing_stripe from "../billing/stripe.js";
import type * as billing_stripeSync from "../billing/stripeSync.js";
import type * as billing_subscriptions from "../billing/subscriptions.js";
import type * as chat_conversations from "../chat/conversations.js";
import type * as collaboration_channels from "../collaboration/channels.js";
import type * as collaboration_conversationMigration from "../collaboration/conversationMigration.js";
import type * as collaboration_directMessages from "../collaboration/directMessages.js";
import type * as collaboration_workspaces from "../collaboration/workspaces.js";
import type * as crons from "../crons.js";
import type * as files_files from "../files/files.js";
import type * as files_lib_storageQuota from "../files/lib/storageQuota.js";
import type * as files_notes from "../files/notes.js";
import type * as files_storageAdmin from "../files/storageAdmin.js";
import type * as http from "../http.js";
import type * as integrations_mcpServers from "../integrations/mcpServers.js";
import type * as integrations_skills from "../integrations/skills.js";
import type * as knowledge_bases from "../knowledge/bases.js";
import type * as knowledge_knowledge from "../knowledge/knowledge.js";
import type * as knowledge_memories from "../knowledge/memories.js";
import type * as knowledge_memoryExtractor from "../knowledge/memoryExtractor.js";
import type * as knowledge_memoryExtractorNode from "../knowledge/memoryExtractorNode.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_authDebug from "../lib/authDebug.js";
import type * as lib_gatewayCatalogPricing from "../lib/gatewayCatalogPricing.js";
import type * as lib_logging from "../lib/logging.js";
import type * as outputs_outputs from "../outputs/outputs.js";
import type * as platform_gatewayCatalog from "../platform/gatewayCatalog.js";
import type * as platform_http from "../platform/http.js";
import type * as platform_idempotency from "../platform/idempotency.js";
import type * as platform_rateLimits from "../platform/rateLimits.js";
import type * as platform_seedDemoAccount from "../platform/seedDemoAccount.js";
import type * as platform_uiSettings from "../platform/uiSettings.js";
import type * as platform_usage from "../platform/usage.js";
import type * as projects_projects from "../projects/projects.js";
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
  "billing/lib/stripeOverlaySubscription": typeof billing_lib_stripeOverlaySubscription;
  "billing/stripe": typeof billing_stripe;
  "billing/stripeSync": typeof billing_stripeSync;
  "billing/subscriptions": typeof billing_subscriptions;
  "chat/conversations": typeof chat_conversations;
  "collaboration/channels": typeof collaboration_channels;
  "collaboration/conversationMigration": typeof collaboration_conversationMigration;
  "collaboration/directMessages": typeof collaboration_directMessages;
  "collaboration/workspaces": typeof collaboration_workspaces;
  crons: typeof crons;
  "files/files": typeof files_files;
  "files/lib/storageQuota": typeof files_lib_storageQuota;
  "files/notes": typeof files_notes;
  "files/storageAdmin": typeof files_storageAdmin;
  http: typeof http;
  "integrations/mcpServers": typeof integrations_mcpServers;
  "integrations/skills": typeof integrations_skills;
  "knowledge/bases": typeof knowledge_bases;
  "knowledge/knowledge": typeof knowledge_knowledge;
  "knowledge/memories": typeof knowledge_memories;
  "knowledge/memoryExtractor": typeof knowledge_memoryExtractor;
  "knowledge/memoryExtractorNode": typeof knowledge_memoryExtractorNode;
  "lib/auth": typeof lib_auth;
  "lib/authDebug": typeof lib_authDebug;
  "lib/gatewayCatalogPricing": typeof lib_gatewayCatalogPricing;
  "lib/logging": typeof lib_logging;
  "outputs/outputs": typeof outputs_outputs;
  "platform/gatewayCatalog": typeof platform_gatewayCatalog;
  "platform/http": typeof platform_http;
  "platform/idempotency": typeof platform_idempotency;
  "platform/rateLimits": typeof platform_rateLimits;
  "platform/seedDemoAccount": typeof platform_seedDemoAccount;
  "platform/uiSettings": typeof platform_uiSettings;
  "platform/usage": typeof platform_usage;
  "projects/projects": typeof projects_projects;
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
