# Cache Components Migration — Design Decisions

**Last updated:** 2026-08-04

This document records the design decisions behind the Cache Components migration,
including which routes were converted, which were intentionally left with
`instant = false`, and why.

## Migration approach

The migration uses Next.js's incremental `instant = false` opt-out path. All
routes started with `export const instant = false` to opt out of instant-
navigation validation while `cacheComponents: true` and `partialPrefetching: true`
were enabled. Routes are then converted in batches by removing the opt-out and
resolving any blocking I/O (moving `cookies()`/`headers()` reads inside
`<Suspense>` boundaries).

## Converted routes (Batches 1-4; 20 remain independently validated)

### Batch 1 — Static pages (5 routes)

1. `/privacy` — moved under the public showcase shell; see the route-group opt-out below.
2. `/terms` — moved under the public showcase shell; see the route-group opt-out below.
3. `/manifesto` — `src/app/manifesto/page.tsx` — Pure static, no I/O. Removed opt-out.
4. `/about` — `src/app/about/page.tsx` — Pure static, no I/O. Removed opt-out.
5. `/pricing` — `src/app/pricing/page.tsx` — Pure static, no I/O. Removed opt-out.

### Batch 2 — Root layout + home page (2 routes)

6. Root layout — `src/app/layout.tsx` — Wrapped `getOverlaySession()` in
   `<Suspense>` with `RootEntryResolver` client component for the redirect logic.
7. `/` — `src/app/page.tsx` — Session check moved inside `<Suspense>`. Static
   shell ("Opening Overlay…") renders immediately.

### Batch 3 — Dynamic but already Suspense-wrapped (6 routes)

8. `/app` layout — `src/app/app/layout.tsx` — `AppLayoutContent` already wrapped
   in `<Suspense>`. Removed opt-out. All `/app/*` child routes benefit.
9. `/app/chat` — `src/app/app/chat/page.tsx` — Moved `getOverlaySession()` and
   `searchParams` inside existing `<Suspense>`.
10. `/app/home` — `src/app/app/home/page.tsx` — No I/O. Removed opt-out.
11. `/app/pricing` — `src/app/app/pricing/page.tsx` — `getOverlayCapabilitiesSync()`
    reads `process.env` only. Removed opt-out.
12. `/app/manifesto` — `src/app/app/manifesto/page.tsx` — No I/O. Removed opt-out.
13. `/download` — moved under the public showcase shell; see the route-group opt-out below.

### Batch 4 — Low-risk /app/* child routes (10 routes)

14. `/app` (index) — `src/app/app/page.tsx` — Pure `redirect('/app/chat')`. Removed opt-out.
15. `/app/memories` — `src/app/app/memories/page.tsx` — Pure redirect. Removed opt-out.
16. `/app/outputs` — `src/app/app/outputs/page.tsx` — Pure redirect. Removed opt-out.
17. `/app/agents` — `src/app/app/agents/page.tsx` — Reads `searchParams` only, no
    session. Removed opt-out.
18. `/app/notes` — `src/app/app/notes/page.tsx` — Moved `getOverlaySession()` +
    `redirect()` inside new `<Suspense>` with `ChatRouteSkeleton` fallback.
19. `/app/activity` — `src/app/app/activity/page.tsx` — Moved `getOverlaySession()`
    inside existing `<Suspense>`.
20. `/app/automations` — `src/app/app/automations/page.tsx` — Moved session +
    `searchParams` inside Suspense. `getOverlayCapabilitiesSync()` (env-only)
    stays outside.
21. `/app/integrations` — `src/app/app/integrations/page.tsx` — Moved session
    inside existing `<Suspense>`.
22. `/app/tools` — `src/app/app/tools/page.tsx` — Added `<Suspense>`. Moved
    session + `searchParams` + `redirect()` inside.
23. `/app/projects` — `src/app/app/projects/page.tsx` — Moved session +
    `searchParams` inside Suspense. `getOverlayCapabilities()` (async, env-only)
    + `notFound()` stay outside.

## Routes intentionally NOT converted (22 routes across 19 segment opt-outs)

These routes keep `export const instant = false` permanently. The opt-out is a
supported Next.js feature, not a debt marker. Each route is documented below
with the specific reason.

### Shared shell route groups (2 layouts)

- `/(showcase-shell)` — `src/app/(showcase-shell)/layout.tsx` plus its three
  page segments — wraps `/privacy`,
  `/terms`, and `/download` in the canonical product shell. The shell resolves a
  private session before selecting authenticated or public showcase data, so
  entry into the group may block at this layout while navigation within it can
  still be validated independently.
- `/auth/(shell)` — `src/app/auth/(shell)/layout.tsx` — provides the same shell
  for sign-in, sign-up, password recovery, and mobile auth completion while
  suppressing recursive guest prompts. It has the same private-session boundary.

### Medium-risk — Complex I/O patterns (6 routes)

24. `/app/files` — `src/app/app/files/page.tsx` — Has `getOverlaySession()` +
    `searchParams` + `redirect()` + `getInitialKnowledgeFiles()` outside
    `<Suspense>`. The `searchParams` are used to resolve the layout *before*
    the Suspense fallback renders, which is architecturally hard to move inside
    without losing the layout-aware skeleton. The route works correctly under
    PPR via the `/app` layout's Suspense boundary; the opt-out just skips
    per-route validation.

25. `/app/knowledge` — `src/app/app/knowledge/page.tsx` — Has
    `getOverlayCapabilities()` (async) + `notFound()` + `getOverlaySession()` +
    `searchParams` + `redirect()` + `getOverlayServerContext()` all outside
    `<Suspense>`. The `notFound()` and capability check need to run before the
    Suspense fallback to avoid rendering a skeleton for a route that should
    404. Moving the session inside Suspense while keeping `notFound()` outside
    creates a split where the route partially renders then redirects —
    visually jarring.

26. `/app/knowledge/[knowledgeBaseId]` — `src/app/app/knowledge/[knowledgeBaseId]/page.tsx`
    — Same pattern as `/app/knowledge` but with dynamic params and multiple
    parallel async calls (`getKnowledgeBase`, `listSources`,
    `checkResourceAccess` x2). The `notFound()` guard depends on the result of
    `loadKnowledgeBaseWorkspace`, which means it must be inside Suspense, but
    `notFound()` inside Suspense doesn't produce a 404 status code (it streams
    after the shell). This is a known Next.js limitation.

27. `/app/invitations/[invitationId]` — `src/app/app/invitations/[invitationId]/page.tsx`
    — Renders `AcceptWorkspaceInvitation` directly with no Suspense and no
    session check. The component is a client component that handles its own
    auth. Converting this would require adding a Suspense boundary around a
    client component that doesn't need one, adding complexity for no PPR
    benefit (the route is rarely visited and has no static shell to prerender).

28. `/app/x/[...slug]` — `src/app/app/x/[...slug]/page.tsx` — Extension page
    resolver with `getOverlaySession()` + `redirect()` + `notFound()` +
    `getOverlayCapabilitiesSync()` + `resolveFeatureModuleForPath()` +
    `renderExtensionComponent()`. The entire route is dynamic — the rendered
    component depends on the extension registry at runtime. There's no
    meaningful static shell to prerender; the Suspense fallback would just be
    a generic skeleton that tells the user nothing.

29. `/explore/[surface]` — `src/app/explore/[surface]/page.tsx` — Pure redirect
    based on dynamic params. Could technically be converted (no session I/O),
    but the route reads `params` which is a dynamic API. The redirect target
    varies by surface, so there's no static shell to prerender — every request
    needs the params to determine the destination.

### Higher-risk — Architectural concerns (5 routes)

30. `/share/c/[token]` — `src/app/share/c/[token]/page.tsx` — `generateMetadata()`
    calls `loadSharedConversation()` (uncached DB query). Converting requires
    caching the shared conversation with `use cache` or accepting that metadata
    won't be prerendered. The share page is public-facing and SEO-sensitive —
    getting this wrong means broken Open Graph tags. Not worth the risk.

31. `/share/f/[token]` — `src/app/share/f/[token]/page.tsx` — Same pattern as
    `/share/c/[token]` but for shared files. Same `generateMetadata` concern.

32. `/(app)/layout` — `src/app/(app)/layout.tsx` — Parallel route group layout
    that calls `getOverlaySession()` and wraps children in
    `AppClientProviders`. This is a *different* layout from `src/app/app/layout.tsx`
    (the `(app)` route group). Converting both could cause conflicts where two
    layouts in the same path compete for Suspense boundaries. The `(app)` group
    is a legacy structure that duplicates the main `/app` layout — converting
    it adds risk without clear benefit since the main `/app` layout already
    provides PPR for all child routes.

33. `/(app)/chat` — `src/app/(app)/chat/page.tsx` — Pure `redirect('/app/chat')`.
    Could be converted (no I/O), but it's in the `(app)` route group which we're
    not converting (see above). Converting a child of an unconverted layout
    creates inconsistent validation behavior.

34. `/(app)/notes` — `src/app/(app)/notes/page.tsx` — Pure `redirect('/app/notes')`.
    Same reasoning as `/(app)/chat`.

### Simple but low-value (1 route)

35. `/home` — `src/app/home/page.tsx` — Pure `redirect('/app/home?showcase=1')`.
    Could be converted (no I/O), but this is a legacy redirect route. The actual
    home page lives at `/app/home` (already converted in Batch 3). Converting
    the redirect adds no user-visible benefit — the route just bounces to
    `/app/home` which is already PPR-enabled.

### Test fixtures (2 routes)

36. `/__fixtures/chat-parity` — `src/app/%5F_fixtures/chat-parity/page.tsx` —
    Test-only route for chat parity testing. Not user-facing. No benefit from
    PPR conversion.

37. `/__fixtures/file-parity` — `src/app/%5F_fixtures/file-parity/page.tsx` —
    Test-only route for file parity testing. Not user-facing. No benefit from
    PPR conversion.

## Summary

| Category | Count | Status |
| --- | --- | --- |
| Converted (Batches 1-4) | 20 | `instant = false` removed, PPR active |
| Shared shell opt-outs | 8 routes across 2 layouts and 3 public pages | Private session boundary may block group entry |
| Medium-risk, kept as opt-out | 6 | `instant = false` retained permanently |
| Higher-risk, kept as opt-out | 5 | `instant = false` retained permanently |
| Low-value, kept as opt-out | 1 | `instant = false` retained permanently |
| Test fixtures, kept as opt-out | 2 | `instant = false` retained permanently |
| **Total inventoried routes** | **42** | |

The `instant = false` opt-out is a supported Next.js feature for routes that
cannot or should not be validated for instant navigation. It does not disable
prerendering — the route still prerenders if it can. It only skips the
validation error. See [the Next.js docs](https://nextjs.org/docs/messages/instant-unrendered-segment)
for details.
