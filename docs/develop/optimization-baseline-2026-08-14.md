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

## 2. BFF request metrics (first hour after deployment)

`overlay.metrics.bff_request` events confirmed flowing to PostHog.

| Route | Count | Avg duration (ms) | P95 duration (ms) |
| --- | --- | --- | --- |
| `/api/v1/conversations` | 11 | 228 | 461 |
| `/api/v1/integrations` | 1 | 1,602 | — |
| `/api/v1/knowledge-bases` | 1 | 684 | — |
| `/api/v1/workspaces` | 1 | 346 | — |
| `/api/v1/workspaces/{id}/management` | 1 | 303 | — |
| `/api/v1/model-catalog` | 1 | 229 | — |
| `/api/v1/subscription` | 1 | 168 | — |
| `/api/v1/workspaces/{id}/management` | 1 | 303 | — |
| `/api/v1/settings` | 1 | 135 | — |
| `/api/v1/chat-suggestions` | 1 | 134 | — |

**Overall:** 19 requests, avg 322ms, P95 776ms.

**Auth type:** 100% session auth.
**Status codes:** 100% 200 OK (no 429s or errors in sample).
**Workspaces:** `personal-1s8jk8y` (17 requests), `a5166906-...` (2 requests).

**Key observations:**
- `/api/v1/conversations` is the highest-frequency BFF route (58% of traffic).
- `/api/v1/integrations` is the slowest route at 1.6s — likely a candidate for optimization.
- `/api/v1/knowledge-bases` at 684ms is also slow.
- No rate-limit hits (429s) observed in the first hour.

## 3. Convex function metrics

The `withMetrics` wrapper is deployed on `rateLimits.takeManyByServer`,
which is called on every authenticated BFF request. Metrics are written
to the Convex `functionMetrics` table (7-day TTL, cleanup cron every 6h).

Data is being collected in Convex storage. A public query endpoint or
scheduled export to PostHog is needed to surface this data — not yet
implemented.

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
