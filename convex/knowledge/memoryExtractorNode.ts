"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateObject, type FlexibleSchema } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { calculateGatewayLanguageModelCostOrNull } from '../lib/gatewayCatalogPricing'
import { isGatewayCreditLow } from '../lib/gatewayCredits'
import { applyMarkupToDollars } from "../../src/shared/billing/billing-pricing";
import {
  resolveWorkspaceBillingRollout,
  workspaceBillingRolloutConfigFromEnv,
} from "../../src/shared/billing/workspace-billing-rollout";
import { normalizeOpenAiCompatibleBaseUrl } from "../../src/shared/ai/gateway/openai-compatible-base-url";
import {
  AGENT_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  buildMemoryDedupDecisionPrompt,
  buildMemoryExtractionPrompt,
  DEDUP_AUTO_NOOP_VEC_SCORE,
  DEDUP_MIN_VEC_SCORE,
  filterExtractionCandidates,
  HUMAN_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  isExtractableTargetText,
  MAX_CANDIDATES_PER_MESSAGE,
  MEMORY_DEDUP_DECISION_SYSTEM_PROMPT,
  MemoryDedupDecisionSchema,
  MemoryExtractionSchema,
  parseMemoryDate,
  type MemoryDedupDecision,
  type MemoryExtractionResult,
} from "../../src/shared/knowledge/memory-extraction-shared";

const GATEWAY_BASE_URL = normalizeOpenAiCompatibleBaseUrl(process.env.AI_GATEWAY_URL);
const API_KEY = process.env.AI_GATEWAY_API_KEY;

function getExtractorModel(modelId: string) {
  const openai = createOpenAICompatible({
    name: "gateway",
    apiKey: API_KEY || "",
    baseURL: GATEWAY_BASE_URL,
  });

  return openai(modelId);
}

export const extractFromTurn = internalAction({
  args: {
    billingAccountId: v.optional(v.string()),
    billingActorUserId: v.optional(v.string()),
    billingSpendSubjectId: v.optional(v.string()),
    billingSpendSubjectKind: v.optional(v.union(v.literal("member"), v.literal("programmatic"))),
    conversationId: v.id("conversations"),
    memoryOwnerId: v.optional(v.string()),
    messageId: v.optional(v.id("conversationMessages")),
    targetActor: v.optional(v.union(v.literal("human"), v.literal("agent"))),
    turnId: v.string(),
    userId: v.string(),
    isPaid: v.optional(v.boolean()),
    workspaceId: v.optional(v.string()),
  },
  handler: async (ctx, {
    billingAccountId,
    billingActorUserId,
    billingSpendSubjectId,
    billingSpendSubjectKind,
    conversationId,
    memoryOwnerId,
    messageId,
    targetActor: rawTargetActor,
    turnId,
    userId,
    isPaid,
    workspaceId,
  }) => {
    try {
      // 1. Fetch message + context
      const messages = (await ctx.runQuery(
        internal.knowledge.memoryExtractor.getRecentMessages,
        { conversationId, userId, targetMessageId: messageId }
      )) as Array<{
        id: Id<"conversationMessages">;
        authorKind?: string;
        role: string;
        turnId: string;
        text: string;
        createdAt: number;
      }>;

      const targetActor = rawTargetActor ?? "human";
      const targetMsg = messages.find((m) => (
        (messageId ? m.id === messageId : m.turnId === turnId)
        && m.turnId === turnId
        && (targetActor === "agent"
          ? m.role === "assistant" && m.authorKind === "agent"
          : m.role === "user" && (m.authorKind === "human" || !m.authorKind))
      ));
      if (!targetMsg) {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "no_target_message",
        };
      }

      const targetText = targetMsg.text.trim();

      const extractable = isExtractableTargetText(targetText);
      if (extractable !== "ok") {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: extractable,
        };
      }

      // 2. Build prompt
      const contextMessages = messages.filter(
        (m: { turnId: string }) => m.turnId !== turnId
      );
      const prompt = buildMemoryExtractionPrompt(targetText, contextMessages, targetActor);

      // 3. Call AI Gateway with generateObject + Zod
      if (!API_KEY) {
        console.warn("[memoryExtractorNode] AI_GATEWAY_API_KEY not configured");
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "no_api_key",
        };
      }

      const configuredModelId = process.env.OVERLAY_MEMORY_EXTRACTION_MODEL_ID?.trim();
      const lowCredit =
        !configuredModelId &&
        (isPaid ?? false) &&
        (await isGatewayCreditLow(API_KEY, GATEWAY_BASE_URL));
      const modelId =
        configuredModelId ||
        ((isPaid ?? false) && !lowCredit ? "google/gemini-2.5-flash-lite" : "openrouter/free");
      const model = getExtractorModel(modelId);
      const serverSecret = process.env.INTERNAL_API_SECRET;
      const systemPrompt = targetActor === "agent" ? AGENT_MEMORY_EXTRACTION_SYSTEM_PROMPT : HUMAN_MEMORY_EXTRACTION_SYSTEM_PROMPT;

      const billingUserId = billingActorUserId?.trim() || userId;
      let resolvedBillingAccountId = billingAccountId?.trim() || undefined;
      if (!resolvedBillingAccountId && workspaceId && resolveWorkspaceBillingRollout(
        workspaceBillingRolloutConfigFromEnv(process.env),
        workspaceId,
      ).eligible) {
        const payer = await ctx.runQuery(internal.knowledge.knowledge.resolveKnowledgeBillingPayer, {
          userId: billingUserId,
          workspaceId,
        });
        if (payer.scope === "workspace") resolvedBillingAccountId = payer.billingAccountId;
      }
      if (resolvedBillingAccountId && !workspaceId) {
        throw new Error("workspace_billing_payer_incomplete");
      }
      const resolvedSpendSubjectId = billingSpendSubjectId?.trim() || billingUserId;
      const resolvedSpendSubjectKind = billingSpendSubjectKind ?? "member";

      /**
       * reserve → markStarted → generateObject → finalize/reconcile. Used for
       * the extraction call and each dedup-decision call; the fingerprint is
       * per-operation so a retried candidate loop cannot double-charge.
       */
      const runBilledGeneration = async <T>(opts: {
        operationId: string;
        fingerprintSeed: string;
        systemPrompt: string;
        prompt: string;
        maxOutputTokens: number;
        schema: FlexibleSchema<T>;
      }): Promise<
        | { status: "ok"; object: T }
        | { status: "already_processed" }
        | { status: "unavailable"; reason: string }
        | { status: "error" }
      > => {
        const estimatedInputTokens = Math.ceil((opts.systemPrompt.length + opts.prompt.length) / 4);
        const estimatedCostUsd = await calculateGatewayLanguageModelCostOrNull(ctx, modelId, estimatedInputTokens, 0, opts.maxOutputTokens);
        if (estimatedCostUsd === null) return { status: "unavailable", reason: "pricing_missing" };
        if ((isPaid ?? false) && !serverSecret) return { status: "unavailable", reason: "background_budget_exhausted" };

        const requestFingerprint = createHash("sha256")
          .update(`${conversationId}:${turnId}:${opts.fingerprintSeed}`)
          .digest("hex");
        const reservationId = estimatedCostUsd > 0
          ? `memory_${createHash("sha256")
              .update(`${billingUserId}:${resolvedBillingAccountId ?? "personal"}:${opts.operationId}:${requestFingerprint}`)
              .digest("hex")
              .slice(0, 40)}`
          : null;
        if (reservationId && serverSecret) {
          try {
            const reservation = resolvedBillingAccountId
              ? await ctx.runMutation(api.platform.usage.reserveWorkspaceBudgetByServer, {
                  billingAccountId: resolvedBillingAccountId,
                  serverSecret,
                  userId: billingUserId,
                  workspaceId: workspaceId!,
                  spendSubjectId: resolvedSpendSubjectId,
                  spendSubjectKind: resolvedSpendSubjectKind,
                  reservationId,
                  kind: "generation",
                  modelId,
                  operationId: opts.operationId,
                  requestFingerprint,
                  reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
                })
              : await ctx.runMutation(api.platform.usage.reserveBudgetByServer, {
                  serverSecret,
                  userId: billingUserId,
                  reservationId,
                  kind: "generation",
                  modelId,
                  operationId: opts.operationId,
                  requestFingerprint,
                  reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
                });
            if (reservation.idempotent || reservation.status !== "reserved") {
              return { status: "already_processed" };
            }
          } catch (err) {
            console.warn("[memoryExtractorNode] budget reservation skipped generation", opts.operationId, err);
            return { status: "unavailable", reason: "background_budget_exhausted" };
          }
        }

        let result: { object: T; usage?: { inputTokens?: number; outputTokens?: number } };
        try {
          if (reservationId && serverSecret) {
            await ctx.runMutation(api.platform.usage.markBudgetReservationStartedByServer, {
              serverSecret,
              userId: billingUserId,
              reservationId,
            });
          }
          result = (await generateObject({
            model,
            // erased to FlexibleSchema — a generic zod param breaks InferSchema
            schema: opts.schema as FlexibleSchema<unknown>,
            instructions: opts.systemPrompt,
            messages: [{ role: "user", content: opts.prompt }],
            maxOutputTokens: opts.maxOutputTokens,
          })) as { object: T; usage?: { inputTokens?: number; outputTokens?: number } };
        } catch (err) {
          if (reservationId && serverSecret) {
            await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
              serverSecret,
              userId: billingUserId,
              reservationId,
              errorMessage: err instanceof Error ? err.message : "memory_extraction_failed",
            }).catch(() => {});
          }
          console.error("[memoryExtractorNode] generation failed", opts.operationId, err);
          return { status: "error" };
        }

        if (reservationId && serverSecret) {
          const usage = result.usage;
          const inputTokens = usage?.inputTokens ?? estimatedInputTokens;
          const outputTokens = usage?.outputTokens ?? opts.maxOutputTokens;
          const actualCostUsd = await calculateGatewayLanguageModelCostOrNull(ctx, modelId, inputTokens, 0, outputTokens);
          if (actualCostUsd === null) {
            await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
              serverSecret,
              userId: billingUserId,
              reservationId,
              errorMessage: `pricing_missing:${modelId}`,
            }).catch(() => {});
          } else {
            const costCents = applyMarkupToDollars({ providerCostUsd: actualCostUsd });
            await ctx.runMutation(api.platform.usage.finalizeBudgetReservationByServer, {
              serverSecret,
              userId: billingUserId,
              reservationId,
              actualCents: costCents,
              events: [{
                type: "generation",
                modelId,
                inputTokens,
                outputTokens,
                cachedTokens: 0,
                providerCostUsd: actualCostUsd,
                cost: costCents,
                timestamp: Date.now(),
              }],
            }).catch(async (err) => {
              await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
                serverSecret,
                userId: billingUserId,
                reservationId,
                errorMessage: err instanceof Error ? err.message : "finalize_failed",
              }).catch(() => {});
            });
          }
        }
        return { status: "ok", object: result.object };
      };

      const extractionCall = await runBilledGeneration<MemoryExtractionResult>({
        operationId: "memory.extract-turn",
        fingerprintSeed: prompt,
        systemPrompt,
        prompt,
        maxOutputTokens: 1200,
        schema: MemoryExtractionSchema as FlexibleSchema<MemoryExtractionResult>,
      });
      if (extractionCall.status !== "ok") {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: extractionCall.status === "already_processed"
            ? "already_processed"
            : extractionCall.status === "error"
              ? "error"
              : extractionCall.reason,
        };
      }

      const { object } = extractionCall;

      const candidates = filterExtractionCandidates(object.candidates);

      if (candidates.length === 0) {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "no_candidates",
        };
      }

      // 4. Dedup (exact, then semantic) and write
      let inserted = 0;
      let duplicates = 0;
      let updated = 0;
      let superseded = 0;

      const ownerId = memoryOwnerId?.trim() || userId;
      const actor = targetActor === "agent" ? "agent" : "user";

      const writeAdd = (content: string, type: string | undefined, expiresAt?: number, eventAt?: number) =>
        ctx.runMutation(api.knowledge.memories.add, {
          userId: ownerId,
          workspaceId,
          serverSecret: serverSecret || "",
          content,
          source: "chat",
          type: type as
            | "preference"
            | "fact"
            | "project"
            | "decision"
            | "agent"
            | undefined,
          actor,
          expiresAt,
          eventAt,
          turnId,
          conversationId,
        });

      for (const candidate of candidates.slice(
        0,
        MAX_CANDIDATES_PER_MESSAGE
      )) {
        const normalized = candidate.content
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
        const expiresAt = parseMemoryDate(candidate.expiresOn);
        const eventAt = parseMemoryDate(candidate.eventAt);

        const existingId = await ctx.runQuery(
          internal.knowledge.memoryExtractor.findExactDuplicate,
          { userId: ownerId, workspaceId, normalizedContent: normalized }
        );

        if (existingId) {
          duplicates++;
          continue;
        }

        // Semantic dedup over the owner's memory chunks. hybridSearch handles
        // embedding + budget internally; omitting workspaceId keeps the search
        // owner-scoped — workspace expansion would compare against other
        // members' memories, which are a different owner's rows.
        let neighbors: Array<{ memoryId: Id<"memories">; content: string; score: number; vecScore?: number }> = [];
        if (serverSecret) {
          try {
            const dedupeSearch = (await ctx.runAction(api.knowledge.knowledge.hybridSearch, {
              userId: ownerId,
              billingUserId,
              billingAccountId: resolvedBillingAccountId,
              spendSubjectId: resolvedSpendSubjectId,
              spendSubjectKind: resolvedSpendSubjectKind,
              serverSecret,
              idempotencyKey: `dedupe_${createHash("sha256").update(`${ownerId}:${turnId}:${normalized}`).digest("hex").slice(0, 40)}`,
              operationId: "memory.dedupe-search",
              requestFingerprint: createHash("sha256")
                .update(`dedupe:${conversationId}:${turnId}:${normalized}`)
                .digest("hex"),
              query: candidate.content,
              sourceKind: "memory",
              kVec: 3,
              kLex: 1,
              m: 3,
              minVecScore: DEDUP_MIN_VEC_SCORE,
            })) as { chunks: Array<{ sourceId: string; text: string; score: number; vecScore?: number }> };
            const sourceIds = [...new Set(dedupeSearch.chunks.map((c) => c.sourceId))];
            if (sourceIds.length > 0) {
              const docs = (await ctx.runQuery(api.knowledge.memories.getByIds, {
                userId: ownerId,
                memoryIds: sourceIds as Id<"memories">[],
                serverSecret,
              })) as Array<{ _id: Id<"memories">; content: string; workspaceId?: string }>;
              // Match findExactDuplicate's scope: same owner AND same workspace.
              const byId = new Map(
                docs
                  .filter((d) => d.workspaceId === workspaceId)
                  .map((d) => [d._id as string, d.content]),
              );
              const seen = new Set<string>();
              neighbors = dedupeSearch.chunks
                .filter((c) => byId.has(c.sourceId) && !seen.has(c.sourceId) && seen.add(c.sourceId))
                .map((c) => ({ memoryId: c.sourceId as Id<"memories">, content: byId.get(c.sourceId)!, score: c.score, vecScore: c.vecScore }));
            }
          } catch (err) {
            console.warn("[memoryExtractorNode] dedupe search failed, falling back to add", err);
          }
        }

        if (neighbors.length === 0) {
          await writeAdd(candidate.content.trim(), candidate.type, expiresAt, eventAt);
          inserted++;
          continue;
        }

        // chunk.score is RRF-fused; auto-noop needs the raw vector score.
        const autoNoop = neighbors.find((n) => (n.vecScore ?? 0) >= DEDUP_AUTO_NOOP_VEC_SCORE);
        if (autoNoop) {
          await ctx.runMutation(api.knowledge.memories.touch, {
            userId: ownerId,
            workspaceId,
            serverSecret: serverSecret || "",
            memoryId: autoNoop.memoryId,
          });
          duplicates++;
          continue;
        }

        // Ambiguous band — let the model pick add/noop/update/supersede.
        const decisionPrompt = buildMemoryDedupDecisionPrompt(
          candidate.content.trim(),
          neighbors.map((n) => ({ content: n.content })),
        );
        const decisionCall = await runBilledGeneration<MemoryDedupDecision>({
          operationId: "memory.dedupe-decision",
          fingerprintSeed: `dedupe:${normalized}:${neighbors.map((n) => n.memoryId as string).join(",")}`,
          systemPrompt: MEMORY_DEDUP_DECISION_SYSTEM_PROMPT,
          prompt: decisionPrompt,
          maxOutputTokens: 400,
          schema: MemoryDedupDecisionSchema as FlexibleSchema<MemoryDedupDecision>,
        });

        const decision: MemoryDedupDecision =
          decisionCall.status === "ok"
            ? decisionCall.object
            : decisionCall.status === "already_processed"
              ? { decision: "noop" }
              : { decision: "add" };
        const target = neighbors[Math.min(decision.targetIndex ?? 0, neighbors.length - 1)]!;

        switch (decision.decision) {
          case "noop":
            await ctx.runMutation(api.knowledge.memories.touch, {
              userId: ownerId,
              workspaceId,
              serverSecret: serverSecret || "",
              memoryId: target.memoryId,
            });
            duplicates++;
            break;
          case "update":
            await ctx.runMutation(api.knowledge.memories.update, {
              userId: ownerId,
              workspaceId,
              serverSecret: serverSecret || "",
              memoryId: target.memoryId,
              content: (decision.mergedContent ?? candidate.content).trim(),
              type: candidate.type as
                | "preference"
                | "fact"
                | "project"
                | "decision"
                | "agent"
                | undefined,
              expiresAt,
              eventAt,
            });
            updated++;
            break;
          case "supersede":
            await ctx.runMutation(api.knowledge.memories.supersede, {
              userId: ownerId,
              workspaceId,
              serverSecret: serverSecret || "",
              memoryId: target.memoryId,
              content: (decision.mergedContent ?? candidate.content).trim(),
              source: "chat",
              type: candidate.type as
                | "preference"
                | "fact"
                | "project"
                | "decision"
                | "agent"
                | undefined,
              actor,
              expiresAt,
              eventAt,
              turnId,
              conversationId,
            });
            superseded++;
            break;
          default:
            await writeAdd(candidate.content.trim(), candidate.type, expiresAt, eventAt);
            inserted++;
        }
      }

      // M2: memory churn invalidates the owner's compiled profile. The compile
      // action self-throttles (fresh profiles skip), so scheduling per turn is
      // cheap — only the first call in a burst actually regenerates.
      if (inserted + updated + superseded > 0) {
        await ctx.scheduler.runAfter(0, internal.knowledge.memoryProfiles.compileInternal, {
          ownerId,
          workspaceId,
          billingActorUserId: billingUserId,
          isPaid,
        });
      }

      console.log("[memoryExtractorNode] result", {
        extracted: candidates.length,
        inserted,
        duplicates,
        updated,
        superseded,
        turnId,
      });
      return { extracted: candidates.length, inserted, duplicates, updated, superseded };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[memoryExtractorNode] unexpected error:", msg);
      return { extracted: 0, inserted: 0, duplicates: 0, reason: "error" };
    }
  },
});
