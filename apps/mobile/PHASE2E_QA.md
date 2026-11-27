# Phase 2e Activity, Files, Automations and Search QA

## Boundaries

- Activity subscribes to `collaboration.activity.notifications`; filters are All, Unread, Mentions, Threads and Reactions. Displayed unread IDs auto-mark through `markRead`; mark-all is explicit. Actor avatars come from principal records, including `isDefault`, not names.
- Files use generated-type-checked `files.browse.list/get/children/rename/move/forConversation`. The primary list, folder children and document metadata are subscribed. Compatibility services use native snapshots. Folder children use the generated `{ files, complete }` shape rather than an invented array.
- Storage-backed text always loads its full authenticated HTTP body before editing, even when metadata contains a truncated inline preview. Download URLs are never treated as document text. Notes submit `expectedUpdatedAt`, adopt the saved revision, retain failed/conflicting drafts and preserve edits made while a save is in flight. Legacy Notes remounts on workspace changes.
- Upload validation/presigning, byte uploads, ingestion, content writes, sharing and deletion retain web HTTP ownership. Image previews authenticate only same-origin file-proxy URLs; unsupported formats retain download/open-on-web fallbacks.
- Automations subscribe to `automations.browse.list/get/runs` and `automations.workflowEvents.watchWorkflowStepEvents`. Mobile status polling and SSE helpers were removed. Configuration, workflow scheduling, run-now, test, cancellation, retry and approval remain web HTTP actions. Only terminal runs appear in history; active runs have a separate live card.
- Search subscribes to `search.browse.mentions`; Work uses the native list with bounded local filtering. People and agents use real native directory/management records. This is metadata/title search, not full-text message or semantic memory search. The existing semantic knowledge-search service and Settings → Memories remain, outside this screen.
- HTTP actions snapshot their workspace before transport awaits authentication; screens discard stale results after workspace changes. Backend authorization remains authoritative.

## Hosted bug reporting

`Submit a bug` matches the web entry and warns that reports/attachments are public on GitHub. It opens hosted web and directs the user to Help → Submit a bug. No native bug-report POST is claimed: the web route requires a same-origin browser session and idempotency assumptions not provided by native bearer auth. A browser sign-in may be required.

## Workflow-step integration risk — follow-up on web

The requested native subscription is wired, but live signed-in step delivery is **not verified**. In the checked-out web source:

1. `convex/automations/workflowEvents.ts:watchWorkflowStepEvents` calls `requireAccessToken` and returns `[]` on verification failure.
2. `convex/lib/auth.ts:requireAccessToken` → `getVerifiedAccessTokenClaims` verifies WorkOS JWTs through `verifyTokenAgainstClientId` and `fetchJwks`.
3. A cold JWKS cache requires `fetch`, which that same module explicitly catches as forbidden in Convex queries/mutations. The query then silently returns no steps. A warm cache can avoid that path; deployed behavior and cache state were not observed.

This is a source-level integration risk, not a reproduced deployment failure. Run-row status/history use native viewer auth and are separate from this legacy token path. Before claiming real WorkOS step delivery, test an isolated backend with a fresh native sign-in; preferably update the web query to Convex-verified identity plus workspace/resource ACLs. No backend source, deployment configuration or production data was changed here, and no HTTP fallback was silently reintroduced.

## Checks and reproduction

```sh
npm run check
node --test scripts/phase*.test.cjs
npx eslint <changed source and test files>
npx expo export --platform android --source-maps --no-bytecode --output-dir /home/ubuntu/mobile-drift-audit/phase2e-android-export
npx expo export --platform ios --source-maps --no-bytecode --output-dir /home/ubuntu/mobile-drift-audit/phase2e-ios-export
```

Regression tests cover native adapters, normal/empty/error states, workflow event mapping, subscription cleanup/stale-workspace protection, exact Activity filters, folder actions, unsupported/image previews, note full-body reads/CAS/conflicts and draft retention. Fixtures are imported only by preview entries, never app routes.

Logs and artifacts: `/home/ubuntu/mobile-drift-audit/phase2e-resources/`. `check.log`, `tests.log`, `phase2e-tests.log`, `lint.log`, `final-changed-lint.log`, platform export logs and `bundle-inspection.log` contain the recorded results. Three existing targeted-lint warnings remain in the legacy automation detail sheet (`runTone`), collaboration service (`_preferences`) and Phase 1 test (`emit`). The Phase 1 CommonJS loader also received its conventional require-import exemption and a local-variable rename when adding the pure Activity dependency.

## Native comparison evidence

Recorded checks:

```text
CHECK_EXIT=0
# tests 82
# pass 82
# fail 0
TEST_EXIT=0
# final Phase 2e after image accessibility assertion
# tests 9
# pass 9
# fail 0
PHASE2E_TEST_EXIT=0
LINT_EXIT=0
FINAL_CHANGED_LINT_EXIT=0
ANDROID_EXPORT_EXIT=0
IOS_EXPORT_EXIT=0
ANDROID: 4220 modules; 0 application Convex backend modules; 0 alias modules; 0 runtime @/ imports; 0 QA fixture modules
IOS: 4205 modules; 0 application Convex backend modules; 0 alias modules; 0 runtime @/ imports; 0 QA fixture modules
Captured 14 native surfaces and comparisons in both themes
PASS native light: edit body, save acknowledgment, preview checked-list text
PASS native dark: edit body, save acknowledgment, preview checked-list text
```

All seven requested surfaces were captured on Android in both themes and compared side-by-side with approved PNGs. Comparison exposed background/card differences and black checked-list text in dark mode; surfaces and task-list semantic colors were corrected.

- `native-{activity-feed,files-list,note,file-preview,automations-list,automation-detail,search-mentions}-{light,dark}.png`
- `comparison-<same-screen>-{light,dark}.png`, `comparison-contact-{light,dark}.png`
- `native-note-keyboard-{light,dark}.png`, `native-note-saved-checklist-{light,dark}.png`
- Corresponding XML, `native-captures.log`, `native-interactions.log`, `capture-native.py`, `interact-native.py`.

Reproduce with the existing Android dev client/Metro on 8081, `node scripts/serve-native-shell-preview.cjs` on 8032, and the artifact capture scripts. Fixtures render the same view components, not a separate visual recreation. Dates, schedules, run counts and missing agent assignments reflect fixture/available contract data rather than invented progress or identity. Extra Reactions/Automations tabs and the hosted bug entry follow current scope rather than the older static mockup.

## Live acceptance still required

No signed-in backend persistence, real upload/download/share, native policy toggle, cross-client notification delivery, live workflow execution, workspace switch during an in-flight write, or iOS device run was exercised. Mocked adapters, fixture interactions and successful exports do not establish those behaviors.

On an isolated native-enabled backend: open Activity in two clients; verify filtered read marking; browse folders and rename/move; open and save a storage-backed note, including a conflicting edit; upload and download; open an automation and run it, check both run status and actual step events; search and open Work/chats/files/automations, then copy/resolve real mentions. Switch workspaces during each asynchronous action and verify no stale result navigates or updates the new workspace. Disable native access and verify a calm unavailable state, not a red screen.
