# Overlay Mobile: parity and rollout plan

Copied from `/home/ubuntu/plans/MOBILE_PARITY_PLAN.md` and updated with the owner's approved launch decisions.

Audited 2026-11-10 against overlay-web `main` (f8ea73e) and overlay-mobile `main` (5043c34, last commit 2026-09-15). Audit results below describe that baseline, not the rebuilt app.

## 1. Where things stand

1. **Mobile did not build at audit time.** `tsc` reported 49 errors and the Android JS bundle failed (`@overlay/api-client` pulled web's `src/shared/schemas/misc.ts`, which imported the web-only `@/shared/onboarding/session` alias). Step 1 removes that alias and guards all exported entry points of the four mobile shared packages, including transitive type imports.
2. **Mobile was built for the September web app.** Its Phases 1 to 8 reached parity with web as of 2026-09-15. Since then web merged about 600 PRs: Projects and Knowledge Bases were removed, Work was added, agent threads were added, the browser went Convex-native, billing became paid-first, Computers and connected agents were reworked, and harness streaming was unified.
3. **About 30 endpoints and client methods mobile calls no longer exist** (the Convex-native migration removed them once the browser stopped using them):
   - Collaboration: message edit/delete, reactions, pins, presence, saved messages, thread follow, notifications and their read state, notification preferences, channel list.
   - Search: `/api/v1/search`, `/api/v1/mention-search`.
   - All of `projects/*` and `knowledge-bases/*`; `agentEnvironments.createManaged`.
   - Still present at audit: auth (`/api/auth/native/*`), bootstrap, conversations list/act/stop/run/approval, agents, agent environments and bindings, computers, files, notes, outputs, memory, settings, model catalog, workspaces, members, invitations, teams, sharing, automations, integrations, MCPs, providers, webhooks, onboarding.
4. **Web surfaces mobile has never had:** Work (tasks, tabbed composer, assignment, dependencies), agent threads with live sidebar status, subscription connections (CLIProxyAPI), the onboarding chat with the Overlay agent, paid-first payment gating, Activity filters, Help bug reports, workspace handle URLs (`/w/<handle>/...`), durable harness resume/continuation.
5. **Mobile surfaces to retire or reconcile:** delete Projects, Knowledge Bases and the browser tool variant; reconcile the local adapter union with supported web adapters rather than treating its Hermes type errors as proof that web removed Hermes. Remove stale `rollout` and `createManaged` usage. Keep memories and knowledge search.
6. **Native platform gaps (from mobile `todos.md`):** no push token upload or server fan-out, AASA only covers the auth callback and `assetlinks.json` is empty, no EAS production build has been made with the notification/associated-domain entitlements, rooms have no offline cache, `react-native-reanimated` pin breaks Android builds on RN 0.83.

## 2. Approved approach

7. **Convex-native mobile is confirmed.** Use `ConvexReactClient` from `convex/react` and authenticate it with the WorkOS access token mobile already holds from `/api/auth/native/*`. Mobile subscribes to the same Convex queries as web (room list, transcript, activity, Work, agents, billing, members), which:
   - restores everything the deleted HTTP endpoints did without bringing them back,
   - makes mobile realtime instead of 2 to 15 second polling,
   - keeps one source of truth, so future web features cost mobile only UI work.
   HTTP stays for server orchestration as on web: sending/act, stop, approvals, computer provisioning, invitations and uploads. Billing checkout stays on web at launch.
   WorkOS token compatibility requires web's selected WorkOS client ID to match Convex's deployed `WORKOS_CLIENT_ID`, and Convex must select the WorkOS provider. Validate an actual authenticated subscription on the isolated preview/device in Phase 1; source compatibility alone is not a deployment check.
8. **Mobile stays in its own repository for now.** Keep `overlay-mobile` separate. For local builds, clone it inside `overlay-web/overlay-mobile` so `file:../packages/*` dependencies resolve. Do not move it to `apps/mobile` in this phase. Shared-package portability checks in web reduce drift without coupling repository ownership.
9. **Share logic, not DOM.** Reuse `@overlay/api-client`, `@overlay/app-core`, `@overlay/chat-core`, `@overlay/workspace-contracts` and Convex function references; keep React Native rendering native. Shared dependencies must not require web's `@/` aliases, including imports reachable through schemas and types.

## 3. Phases

### Phase 0: Unbreak (about 1 session)

10. Fix the `@/` alias leak in shared packages so non-web consumers bundle.
11. Delete Projects, Knowledge Bases, browser tool variant, `rollout` and `createManaged` code paths from mobile. Align adapter types with current web support. Keep memories and knowledge search.
12. Align navigation with the approved mockups: Work, Agents, Chats, Files, Automations, with Extensions hidden at launch and memories under Settings. Use the DoubleSidebar drawer, not bottom tabs.
13. Fix the reanimated/worklets pin; get `tsc`, `npm run check` and `expo export` green on iOS and Android.
14. Keep the separate mobile repo and document the nested local checkout. Do not commit the nested clone or its dependencies in web.

### Phase 1: Convex foundation (about 1 session)

15. Add `ConvexProvider` with WorkOS-token auth and refresh; verify `auth/viewer:current` from a device.
16. Workspace scope: live workspace list, active workspace, handles, personal vs workspace scope matching web's URL rules.
17. Replace polling in `RoomScreen`/`ChatScreen` with subscriptions; drop `bootstrapService` reads web retired.

### Phase 2: Core surfaces at parity (about 3 to 5 sessions, parallelizable)

18. **Chats:** native personal transcript, unified durable streaming, stop, resume after cut-off, approvals, attachments, model selector ordering per web.
19. **Channels and DMs:** live room list, reactions, pins, edits/deletes, saved messages, thread follow, presence, all on the native Convex functions web now uses.
20. **Agents:** roster with creature avatars and default Overlay mark, agent threads with live status, agent settings, machine/environment status (read and approve; enrollment stays copy-a-command).
21. **Work:** task list and board, task detail, tabbed composer, assign-to-agent (starts immediately or waits on blockers), dependencies.
22. **Activity:** live notifications with web's filters and unread counts.
23. **Files, notes, memories, outputs:** native reads, uploads via existing presign route.
24. **Search and @-mentions:** the native indexed Convex search web uses.
25. **Automations:** list, run, run stream, approvals (exists; re-point to native reads).
26. **Settings and account:** live settings/profile, members, invitations, teams, subscription connections (view and connect where the flow allows on mobile).

### Phase 3: Existing-workspace launch gate and help (about 1 to 2 sessions)

27. Launch supports sign-in to existing workspaces only, with no mobile sign-up or purchase flow. Workspace creation, paid setup and first-time onboarding stay on web. Signed-in users without an eligible workspace see the approved minimal setup gate. Review storefront rules before shipping external setup links.
28. Billing is read-only: plan and balance, with web management where allowed. No checkout, top-up purchase, StoreKit or Play Billing at launch. IAP is deferred to a later phase.
29. Help bug reports from mobile.

### Phase 4: Ship (about 1 to 2 sessions plus store review time)

30. Push: a device registration endpoint plus fan-out for mentions, DMs, task assignment and approvals; APNs/FCM credentials in EAS.
31. Universal links: expand AASA, populate `assetlinks.json`, point invite emails at app-openable paths.
32. EAS production builds, TestFlight and Play internal testing, store listings (drafts exist in `app-store-metadata.md`), and in-app account deletion.
33. Cross-surface QA matrix: same account create-on-web/verify-on-mobile for every surface, light and dark, iPhone, iPad, Android, on an isolated PR Preview.

## 4. Confirmed launch decisions

34. **Billing and entry:** existing-workspace sign-in only. No sign-up or purchases in the app. IAP later.
35. **Web-only at launch:** Computers desktop viewer, Extensions host, admin/governance/audit export, Slack import, webhooks, MCP OAuth setup, and agent machine enrollment beyond copy-a-command. All other Phase 2 surfaces remain in scope, subject to these setup/viewer exclusions.
36. **Convex-native mobile:** confirmed. Do not restore removed HTTP endpoints just for polling clients.
37. **Repository:** mobile stays in its own repo for now. No monorepo move in this phase.
38. **Design:** the owner approved all 36 mobile mockups. `internal/plans/mockups/mobile-app.html` is the approved reference, with source in `mobile-app.tsx` and `mobile-app.css` and builder `build-mobile-app.cjs`. It renders all phones inline so attachment viewers do not need the original file path. Implement the approved screen inventory and light/dark production visual language rather than redesigning it.

## 5. Fastest path to a store build

Phase 0 and Phase 1 first (about 2 sessions), then Phase 2 surfaces in parallel sessions, then the launch gate/help and shipping phases. Design approval is complete. Roughly 7 to 10 Devin sessions of work, plus Apple/Google review (typically days) and any Play closed-testing requirement for the developer account type. Estimates remain planning guidance, not acceptance criteria.
