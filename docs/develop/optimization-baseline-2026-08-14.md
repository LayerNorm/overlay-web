# Optimization Baseline Measurements — 2026-08-14

Captured immediately after deploying the measurement foundation
(commit `114858a77` on `staging`). These are the initial numbers we
compare against after each optimization phase.

## 1. Product activity (30-day baseline from PostHog)

| Metric | 30-day total | Daily avg | Peak day |
| --- | --- | --- | --- |
| Pageviews | 2,576 | 86 | 328 (Aug 1) |
| Daily active users | — | 24 avg | 53 (Jul 22) |
| Chat messages sent | 215 | 7 | 26 (Jul 31) |
| New chats created | 105 | 3.5 | 14 (Jul 31) |
| Automations succeeded | 4 | 0.13 | 4 (Aug 5) |
| Automations failed | 24 | 0.8 | 1/day (steady) |

**Key observations:**
- Low automation success rate: 4 succeeded vs 24 failed (14% success).
- Chat activity is bursty — peaks of 25-26 messages/day vs median of ~5.
- DAU ranges from 5 to 53, median ~24.

## 2. BFF request metrics (from Vercel runtime logs)

`[BFF_METRIC]` console logs confirmed in Vercel logs. Data below is from
24 BFF requests generated against staging.

| Route | Count | Avg ms | Min ms | Max ms |
| --- | --- | --- | --- | --- |
| `/api/v1/conversations` | 9 | 190 | 106 | 420 |
| `/api/v1/model-catalog` | 3 | 245 | 197 | 274 |
| `/api/v1/workspaces` | 3 | 247 | 186 | 347 |
| `/api/v1/settings` | 3 | 97 | 95 | 99 |
| `/api/v1/chat-suggestions` | 2 | 133 | 108 | 159 |
| `/api/v1/knowledge-bases` | 2 | 415 | 326 | 505 |
| `/api/v1/subscription` | 2 | 178 | 144 | 213 |

**Auth type:** 100% session auth.
**Status codes:** 100% 200 OK (no 429s or errors).
**Workspaces:** `personal-1s8jk8y` (most), `a5166906-...` (1).

**Key observations:**
- `/api/v1/conversations` is the highest-frequency BFF route (38% of traffic).
- `/api/v1/knowledge-bases` is the slowest route at 415-505ms.
- `/api/v1/settings` is the fastest at 95-99ms (likely cached/simple).
- `/api/v1/conversations` has high variance (106-420ms) — cold start vs warm?
- No rate-limit hits (429s) observed.
- `/api/v1/integrations` was 1,602ms in the earlier PostHog sample but did
  not appear in this Vercel log batch (may not have been called).

## 3. Convex function metrics (from Convex logs)

`[CVX_METRIC]` logs confirmed in Convex dev deployment logs.

```
platform.rateLimits.takeManyByServer: 7 calls, all 0ms, 0 errors
```

The rate limit function is called on every authenticated BFF request
and completes in <1ms. This is the only Convex function instrumented
with `withMetrics` so far.

## 4. Client-side metrics

The client-side event bus (`overlay:metrics` CustomEvent) is confirmed
working in the browser. `ObservabilityClient` is wired to forward events
to PostHog. However, the Playwright browser session does not fully
hydrate the React app (pre-existing issue), so client-side metric events
(cache hit/miss, chat-open latency, AgentRun recovery, session refresh)
have not yet been observed in PostHog from automated testing.

Client metrics will flow from real user sessions once the staging
deployment is accessed by actual browsers.

## 5. Postgres query metrics

The Postgres pool wrapper is deployed and wraps `client.query` to emit
`overlay.metrics.postgres_query` events. These events are emitted
server-side via the same PostHog client + flush mechanism as BFF
metrics. No Postgres query events observed yet in PostHog — likely
because the BFF routes hit in testing (conversations list) may use
Convex rather than Postgres for this workspace.

## 6. Model token breakdown

`ActContextService.emitTokenBreakdown` is implemented but not yet
called from any code path. This is dead code until wired into the
actual model invocation flow. Token breakdown data is not yet being
collected.

## 7. Business rollups

`src/server/observability/business-rollup.ts` is implemented but not
yet connected to lifecycle events or scheduled processing. Business
rollup data is not yet being collected.

## What we have now

- **BFF request metrics:** Flowing to PostHog with route, duration,
  auth type, workspace, and status code.
- **Product activity baseline:** 30-day trends for pageviews, DAU,
  chat messages, new chats, and automation outcomes.
- **Convex function metrics:** Being written to Convex storage but
  not yet exportable.

## What we need to collect before optimizing

The measurement layer needs to run for a period (ideally 24-48 hours
of real user traffic) to establish baselines for:

- BFF request patterns per route, per user, per time of day.
- Rate-limit hit frequency (429s).
- Duplicate request frequency.
- Cache hit/miss/stale rates.
- Chat-open latency distribution.
- AgentRun recovery frequency.
- Session refresh frequency and triggers.
- Postgres query timing distribution.
- Convex function call frequency and duration.
- Model token breakdown by category.

Once we have 24-48 hours of data, we can identify the highest-impact
optimization targets and begin Phase A implementation.

## PostHog queries for ongoing measurement

```sql
-- BFF request volume by route (last 24h)
SELECT properties.route, count() as cnt,
       avg(toFloat(properties.durationMs)) as avg_ms,
       quantile(0.95)(toFloat(properties.durationMs)) as p95_ms
FROM events
WHERE event = 'overlay.metrics.bff_request'
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY route ORDER BY cnt DESC;

-- BFF error rate (last 24h)
SELECT properties.statusCode, count() as cnt
FROM events
WHERE event = 'overlay.metrics.bff_request'
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY properties.statusCode;

-- BFF requests per active user (last 24h)
SELECT person_id, count() as bff_requests
FROM events
WHERE event = 'overlay.metrics.bff_request'
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY person_id ORDER BY bff_requests DESC;
```
