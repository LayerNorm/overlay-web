"use node";

/**
 * Global `AI_GATEWAY_API_KEY` credit check for Convex background jobs.
 * Mirrors src/server/ai/gateway/gateway-credits.ts — when the shared key's
 * balance drops below the threshold, paid-tier model choices fall back to the
 * free `openrouter/free` model so the remaining credit is preserved.
 * Fails open: an unreadable credits endpoint never blocks generation.
 */

const DEFAULT_LOW_CREDIT_THRESHOLD_USD = 5;
const CREDITS_CACHE_TTL_MS = 60_000;

let cached: { apiKey: string; balanceUsd: number; expiresAt: number } | null = null;

function lowCreditThresholdUsd(): number {
  const parsed = Number.parseFloat(process.env.AI_GATEWAY_LOW_CREDIT_THRESHOLD_USD ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LOW_CREDIT_THRESHOLD_USD;
}

export async function isGatewayCreditLow(
  apiKey: string | undefined,
  gatewayBaseUrl: string,
): Promise<boolean> {
  if (!apiKey) return false;
  const now = Date.now();
  if (cached && cached.apiKey === apiKey && cached.expiresAt > now) {
    return cached.balanceUsd < lowCreditThresholdUsd();
  }
  try {
    const res = await fetch(`${gatewayBaseUrl.replace(/\/+$/, "")}/credits`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { balance?: string };
    const balanceUsd = Number.parseFloat(data.balance ?? "");
    if (!Number.isFinite(balanceUsd)) return false;
    cached = { apiKey, balanceUsd, expiresAt: now + CREDITS_CACHE_TTL_MS };
    return balanceUsd < lowCreditThresholdUsd();
  } catch {
    return false;
  }
}
