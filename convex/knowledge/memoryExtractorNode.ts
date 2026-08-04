"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { generateObject } from "ai";
import { z } from "zod";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { calculateGatewayLanguageModelCostOrNull } from '../lib/gatewayCatalogPricing'
import { applyMarkupToDollars } from "../../src/shared/billing/billing-pricing";

const GATEWAY_CHAT_URL =
  process.env.AI_GATEWAY_URL?.trim() ||
  "https://ai-gateway.vercel.sh/v1/chat/completions";
const API_KEY = process.env.AI_GATEWAY_API_KEY;

const MIN_CONFIDENCE = 0.4;
const MAX_CANDIDATES_PER_MESSAGE = 8;

const SYSTEM_PROMPT = `You are an aggressive memory extraction assistant. Read the user's message and extract EVERY personal fact, preference, goal, identity detail, constraint, habit, or standing instruction that would be useful to remember in future conversations.

Return a JSON object with this exact shape:
{
  "candidates": [
    {
      "content": "One short factual sentence about the user.",
      "type": "preference|fact|project|decision|agent",
      "confidence": 0.0 to 1.0,
      "rationale": "One sentence explaining why this is memorable."
    }
  ]
}

Rules:
- Default to extracting. Only skip if the message is pure small talk ("how are you", "thanks") with zero personal content, a one-off task request with no personal detail, or ONLY code / API data with nothing about the user.
- Extract: food/style preferences, job/role, timezone/locale, "always do X", "never do Y", durable constraints, goals, ambitions, frustrations, relationships, learning preferences.
- type "preference" = tastes, style choices, UI preferences.
- type "fact" = identity, demographics, location, job title, company.
- type "project" = current work context, tech stack for a specific project, business stage.
- type "decision" = explicit rules, commitments, past choices that govern future behavior.
- type "agent" = instructions on how the assistant should behave toward this user.
- Keep each content to one concise sentence. Start with "User prefers...", "User is...", "User wants...", "User decided...", "Always...", "Never...".
- If nothing is memorable, return {"candidates": []}.`;

const ExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.string().describe("One short factual sentence about the user."),
      type: z
        .enum(["preference", "fact", "project", "decision", "agent"])
        .describe("Classify the memory type."),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("How confident you are that this is worth remembering (0-1)."),
      rationale: z
        .string()
        .describe("One sentence explaining why this is memorable."),
    })
  ),
});

function buildExtractionPrompt(
  targetText: string,
  contextMessages: Array<{ role: string; text: string }>
): string {
  const context = contextMessages
    .map((m) => `${m.role}: ${m.text.slice(0, 400)}`)
    .join("\n");

  return [
    context ? "Recent conversation context:" : "",
    context,
    context
      ? "\n---\nTarget message to extract memories from:"
      : "Message to extract memories from:",
    targetText,
    "",
    "Extract any memorable personal facts, preferences, or standing instructions about the user from this message.",
  ]
    .filter(Boolean)
    .join("\n");
}

function getExtractorModel(modelId: string) {
  const openai = createOpenAICompatible({
    name: "gateway",
    apiKey: API_KEY || "",
    baseURL: GATEWAY_CHAT_URL,
  });

  return openai(modelId);
}

export const extractFromTurn = internalAction({
  args: {
    conversationId: v.id("conversations"),
    turnId: v.string(),
    userId: v.string(),
    isPaid: v.optional(v.boolean()),
  },
  handler: async (ctx, { conversationId, turnId, userId, isPaid }) => {
    try {
      // 1. Fetch message + context
      const messages = (await ctx.runQuery(
        internal.knowledge.memoryExtractor.getRecentMessages,
        { conversationId, userId }
      )) as Array<{
        role: string;
        turnId: string;
        text: string;
        createdAt: number;
      }>;

      const targetMsg = messages.find(
        (m) => m.turnId === turnId && m.role === "user"
      );
      if (!targetMsg) {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "no_user_message",
        };
      }

      const targetText = targetMsg.text.trim();

      // Skip if too short or only code
      if (targetText.length < 20) {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "too_short",
        };
      }
      if (
        /^[`\s]*```/.test(targetText) &&
        targetText.split("\n").length < 3
      ) {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "likely_code",
        };
      }

      // 2. Build prompt
      const contextMessages = messages.filter(
        (m: { turnId: string }) => m.turnId !== turnId
      );
      const prompt = buildExtractionPrompt(targetText, contextMessages);

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

      const modelId = (isPaid ?? false) ? "google/gemini-2.5-flash-lite" : "openrouter/free";
      const model = getExtractorModel(modelId);
      const serverSecret = process.env.INTERNAL_API_SECRET;
      const maxOutputTokens = 1200;
      const estimatedInputTokens = Math.ceil((SYSTEM_PROMPT.length + prompt.length) / 4);
      const estimatedCostUsd = await calculateGatewayLanguageModelCostOrNull(ctx, modelId, estimatedInputTokens, 0, maxOutputTokens);
      if (estimatedCostUsd === null) {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "pricing_missing",
        };
      }
      if ((isPaid ?? false) && !serverSecret) {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "background_budget_exhausted",
        };
      }

      const requestFingerprint = createHash("sha256")
        .update(`${conversationId}:${turnId}:${prompt}`)
        .digest("hex");
      const reservationId = estimatedCostUsd > 0
        ? `memory_${createHash("sha256")
            .update(`${userId}:memory.extract-turn:${requestFingerprint}`)
            .digest("hex")
            .slice(0, 40)}`
        : null;
      if (reservationId && serverSecret) {
        try {
          const reservation = await ctx.runMutation(api.platform.usage.reserveBudgetByServer, {
            serverSecret,
            userId,
            reservationId,
            kind: "generation",
            modelId,
            operationId: "memory.extract-turn",
            requestFingerprint,
            reservedCents: applyMarkupToDollars({ providerCostUsd: estimatedCostUsd }),
          });
          if (reservation.idempotent || reservation.status !== "reserved") {
            return {
              extracted: 0,
              inserted: 0,
              duplicates: 0,
              reason: "already_processed",
            };
          }
        } catch (err) {
          console.warn("[memoryExtractorNode] budget reservation skipped extraction", err);
          return {
            extracted: 0,
            inserted: 0,
            duplicates: 0,
            reason: "background_budget_exhausted",
          };
        }
      }

      let result: {
        object: z.infer<typeof ExtractionSchema>;
        usage?: { inputTokens?: number; outputTokens?: number };
      };
      try {
        if (reservationId && serverSecret) {
          await ctx.runMutation(api.platform.usage.markBudgetReservationStartedByServer, {
            serverSecret,
            userId,
            reservationId,
          });
        }
        result = await generateObject({
          model,
          schema: ExtractionSchema,
          instructions: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
          maxOutputTokens,
        });
      } catch (err) {
        if (reservationId && serverSecret) {
          await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
            serverSecret,
            userId,
            reservationId,
            errorMessage: err instanceof Error ? err.message : "memory_extraction_failed",
          }).catch(() => {});
        }
        throw err;
      }

      if (reservationId && serverSecret) {
        const usage = (result as unknown as { usage?: { inputTokens?: number; outputTokens?: number } }).usage;
        const inputTokens = usage?.inputTokens ?? estimatedInputTokens;
        const outputTokens = usage?.outputTokens ?? maxOutputTokens;
        const actualCostUsd = await calculateGatewayLanguageModelCostOrNull(ctx, modelId, inputTokens, 0, outputTokens);
        if (actualCostUsd === null) {
          await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
            serverSecret,
            userId,
            reservationId,
            errorMessage: `pricing_missing:${modelId}`,
          }).catch(() => {});
        } else {
          const costCents = applyMarkupToDollars({ providerCostUsd: actualCostUsd });
          await ctx.runMutation(api.platform.usage.finalizeBudgetReservationByServer, {
            serverSecret,
            userId,
            reservationId,
            actualCents: costCents,
            events: [{
              type: "generation",
              modelId,
              inputTokens,
              outputTokens,
              cachedTokens: 0,
              cost: costCents,
              timestamp: Date.now(),
            }],
          }).catch(async (err) => {
            await ctx.runMutation(api.platform.usage.markBudgetReservationReconcileByServer, {
              serverSecret,
              userId,
              reservationId,
              errorMessage: err instanceof Error ? err.message : "finalize_failed",
            }).catch(() => {});
          });
        }
      }

      const { object } = result;

      const candidates = (object.candidates ?? []).filter(
        (c: { content: string; confidence?: number }) =>
          typeof c.content === "string" &&
          c.content.trim().length > 5 &&
          (c.confidence ?? 1) >= MIN_CONFIDENCE
      );

      if (candidates.length === 0) {
        return {
          extracted: 0,
          inserted: 0,
          duplicates: 0,
          reason: "no_candidates",
        };
      }

      // 4. Deduplicate and insert
      let inserted = 0;
      let duplicates = 0;

      for (const candidate of candidates.slice(
        0,
        MAX_CANDIDATES_PER_MESSAGE
      )) {
        const normalized = candidate.content
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

        const existingId = await ctx.runQuery(
          internal.knowledge.memoryExtractor.findExactDuplicate,
          { userId, normalizedContent: normalized }
        );

        if (existingId) {
          duplicates++;
          continue;
        }

        // Insert memory (no status field — all memories are treated equally now)
        await ctx.runMutation(api.knowledge.memories.add, {
          userId,
          serverSecret: serverSecret || "",
          content: candidate.content.trim(),
          source: "chat",
          type: candidate.type as
            | "preference"
            | "fact"
            | "project"
            | "decision"
            | "agent"
            | undefined,
          actor: "user",
        });

        inserted++;
      }

      console.log("[memoryExtractorNode] result", {
        extracted: candidates.length,
        inserted,
        duplicates,
        turnId,
      });
      return { extracted: candidates.length, inserted, duplicates };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[memoryExtractorNode] unexpected error:", msg);
      return { extracted: 0, inserted: 0, duplicates: 0, reason: "error" };
    }
  },
});
