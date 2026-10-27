# Account, profiles, workspace icons, and demo removal

Approved for implementation on 2026-10-26. Production implementation follows the approved standalone mockup in `mockups/account-profile-mockup.html`. Verification results belong in the implementation PR.

## Approved experience

### 1. Account belongs to the person

- Add **Account** immediately above **Settings** in the workspace dropdown. Remove **Demo**.
- Make `/account` the canonical authenticated, workspace-independent page. It has no workspace sidebar or workspace authorization/loading boundary.
- Show the person's photo, account name, email, workspace memberships and roles, and links to open those workspaces. Retain sign out and the existing guarded account deletion flow.
- Allow editing the account display name and default photo. Email remains the authenticated identity, not a workspace-editable field.
- Keep billing inside each workspace. Account access must work even with no active workspace, no memberships, or a workspace load failure.
- Redirect legacy `/app/account` and `?section=account` settings links to `/account`. Preserve supported auth handoff and billing callback parameters. Avoid redirect loops through the current proxy rules.

### 2. Profile belongs to the current workspace

- Add **Profile** to the Workspace group in Settings. Remove Account from the settings navigation and search registry.
- Show the workspace name and icon under the Profile heading so the scope is explicit.
- Edit a workspace-specific display name and photo, with **Use account defaults** to clear overrides.
- Account defaults apply unless the person has deliberately overridden them for that workspace. Changing one workspace profile must not change other workspaces or the account.
- Replace initials-only human avatars with the resolved photo everywhere an avatar already exists: membership lists, invitations where identity is known, people/mention/assignee pickers, chat/DM attribution, account UI, and sidebar identity surfaces. Do not add avatars to deliberately avatar-free layouts.
- Keep initials for missing or failed images. Keep agent creature avatars for agents, not human photos or generic robot icons.

### 3. Workspace icons

- Clicking the workspace icon in Workspace settings opens a compact picker: curated geometric presets, Upload image, and Use initials.
- Owners/admins can change the icon; ordinary members can only change their own workspace profile. Enforce this on the server, not just in the UI.
- Generate a stable preset for a new workspace, saved as an explicit preset identifier. Existing workspaces can remain on initials until changed; no surprise bulk visual migration.
- Use the same icon in the workspace switcher, account membership list, settings header, and directory.
- Recommend a small bundled gallery from **DiceBear Shapes**, rather than AI image generation or a live third-party avatar endpoint. Shapes is CC0. Curating a few good presets keeps the picker simpler and avoids another runtime service.
- Use existing `@overlay/ui` shadcn Avatar/Dialog/Button/Input primitives. shadcn handles image display and fallback; it does not generate images. The image editor uses browser canvas for square crop, zoom, and positioning without another runtime dependency.

## What the code shows today

- `src/components/layout/sidebar/SidebarAccountMenu.tsx` renders Demo and Settings but no separate Account link. `AppSidebar.tsx` supplies the showcase destination.
- `src/app/app/settings/page.tsx` embeds the account page. `src/proxy.ts` currently redirects both `/account` and `/app/account` back into Settings.
- `src/app/app/account/account-content.tsx` handles identity, sign-out/deletion, and workspace billing navigation. Its adjacent `account-handoffs.ts` also carries desktop/mobile/extension handoffs, so moving the page is not just changing a link.
- Provider photos already flow through WorkOS, Better Auth and OIDC adapters. `convex/auth/users.ts` syncs `profilePictureUrl` into the account row in `subscriptions`. This sync overwrites provider fields on login; user-uploaded overrides need separate fields so they survive the next login.
- `workspacePrincipals` has a workspace-local `displayName`, but no avatar field or explicit account-default override semantics. `workspaces` has no icon field. `WorkspaceAvatar.tsx` currently renders only initials.
- The existing `WorkspaceDirectory` provides membership, invitation, creation, and switching flows that can be reused without mounting the active workspace's application shell.

## Data and security design

- Resolve human names as: workspace display-name override, then account display-name override, then provider name, then the existing safe fallback.
- Resolve human photos as: workspace uploaded photo, then account uploaded photo, then provider photo, then initials. The shared avatar component also handles an image-load error.
- Store custom profile fields independently from provider-synced fields. Use nullable/clearable override semantics so reset means inheritance, not a copy of today's account values.
- Extend workspace/principal contracts, serializers, API clients, and server queries together. Return only the relevant workspace identity in workspace-scoped responses. Use batch hydration instead of one account lookup per rendered member.
- Reuse the existing object-storage abstraction for uploads, with dedicated avatar ownership metadata and authenticated read authorization appropriate to account/workspace visibility. Do not put profile images in a user's private file collection and then expose that collection to teammates.
- Validate MIME type, decoded dimensions and a 5 MB size cap server-side. Re-encode to a bounded square raster and strip metadata. Allow PNG/JPEG/WebP uploads, not arbitrary SVG or remote-URL imports. Crop/zoom in the client is presentation, not a substitute for validation.
- Authenticate the caller; derive their identity on the server. Profile updates require active membership in the target workspace and may only edit the caller. Workspace icon updates require workspace-management authority. Check attachment ownership when assigning an upload.
- Preserve current account deletion protections, clean up owned images appropriately, and invalidate resolved identity caches after changes. Never mutate production data as part of this implementation.
- Add optional fields first. Preserve older clients and existing names; do not infer that every legacy display name was a deliberate override. Backfill only where provenance is reliable. Flag ambiguous migration cases rather than erasing names.

## Remove the demo completely

This is a product-path removal, not a search-and-delete of every use of the word "demo".

1. Remove Demo entry points, `ROOT_SHOWCASE_DESTINATION`, public showcase pages/data/client, fake agents and fake sidebar histories.
2. Remove `showcase=1` behavior and prop plumbing from the real chat, agent, files, tools, automations and settings routes; sidebar navigation; workspace boundaries/context; onboarding; and model-catalog logic. The ordinary auth and workspace authorization checks remain intact.
3. Replace `WorkspaceAppBoundaryWithShowcase` with the ordinary workspace boundary. Remove showcase-specific agent runtime/editor and chat snapshot branches, not their real equivalents.
4. Retire `/explore/[surface]`. Old demo URLs should land on `/home` with no seeded resource IDs, not attempt real backend queries for fake IDs. Define compatibility handling for known showcase query links and test both signed-in and signed-out visitors.
5. Move reusable non-demo code out of `features/showcase` before deleting it. In particular, `RootEntryResolver` still implements real signed-in/signed-out root navigation. Preserve the marketing frame where still used by real pages.
6. Remove demo-only generated assets, generation scripts, obsolete checks, and active docs/links. Preserve static marketing illustrations that are not an interactive demo; remove runtime dependencies on showcase fixtures.
7. Remove the obsolete sample-data seeder `convex/platform/seedDemoAccount.ts` as part of demo functionality retirement. Do not delete stored accounts, sample records, App Store reviewer credentials, or QA secrets. Those are distinct operational resources and deletion would need separate authorization.
8. Preserve generic component test fixtures, Storybook examples, marketing pages, and authenticated QA accounts. Rewrite tests whose purpose was the removed demo to assert retired-link behavior and real-route isolation instead.

### Screenshot 4

The screenshot shows `chat/conversations:watchAgentRun` failing. The code confirms that public showcase paths coexist with live chat and agent subscriptions. The screenshot alone does not prove which subscription or authorization condition caused that specific failure. Removing the demo eliminates those demo flows; this proposal does not claim to diagnose all real-chat failures or to fix an unrelated production error.

## Implementation order after approval

1. Remove demo behavior and add retired-link regressions. Keep reusable root navigation and normal authentication intact.
2. Add account/workspace profile and icon contracts, storage ownership, mutations, and resolution tests.
3. Move Account outside the workspace shell; wire the menu and backward-compatible redirects/handoffs.
4. Implement the approved Profile and icon UI, then apply shared resolved human/workspace avatars across existing surfaces.
5. Open a main-targeted draft PR, run focused tests, targeted ESLint and TypeScript, and request an isolated PR preview for browser QA. No shared-dev or production Convex CLI operations from the feature worktree.

## Acceptance checks

- Account opens without a selected workspace and without triggering workspace activation. It lists only the caller's memberships. Legacy account links and supported mobile/desktop/extension handoffs still work.
- Profile changes persist after refresh, sign-in, and workspace switching. Custom account photos survive provider sync. Reset inherits future account changes. A workspace override never appears in another workspace.
- Provider photo, custom photo, absent photo, and broken-image cases all render correctly. Names and photos stay consistent in membership lists, DM attribution, and assignee/mention pickers.
- Non-members cannot read or update a workspace profile. Members cannot change another person's profile or the workspace icon. Invalid or foreign-owned uploads are rejected.
- Workspace icons stay consistent across directory, account, switcher, and settings. The picker supports keyboard operation, cancel, upload/crop, reset, light/dark themes, and narrow screens.
- Demo links/queries never instantiate fake workspace clients or start subscriptions using showcase IDs. Ordinary authenticated routes, marketing, root navigation, and guest auth gates still work.
- After implementation: use the repo's focused Node test recipe (`TSX_TSCONFIG_PATH=tsconfig.json NODE_OPTIONS="--require=./scripts/ci/register-style-noop.cjs" node --import tsx --test <changed tests>`), appropriate backend tests, targeted ESLint, and `npx tsc --noEmit`. Update any removed showcase-specific CI wiring rather than leaving a dangling command.

## Mockup and references

- Interactive mockup: `internal/plans/mockups/account-profile-mockup.html`. Four views: Account, Profile, Workspace, Menu. Includes light/dark themes, preset selection, local upload preview, name editing, and reset behavior. Photos are sample portraits. Saves are in-memory only; production crop, authorization, persistence, invitation, and deletion flows are not implemented in the mockup.
- [shadcn Avatar](https://ui.shadcn.com/docs/components/avatar)
- [DiceBear Shapes and its CC0 license](https://www.dicebear.com/styles/shapes/)
- [react-easy-crop](https://github.com/ValentinH/react-easy-crop)
