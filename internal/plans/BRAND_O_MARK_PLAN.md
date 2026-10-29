# Overlay brand: O mark rollout plan

Replace the metallic orb and lowercase "overlay" wordmark with the uppercase Libre Baskerville Regular **O with two eyes** and the **Overlay** wordmark (only the O capitalized). The mark becomes the Overlay agent's avatar, and every orb pulse becomes eye motion.

- Mockup: `internal/plans/mockups/overlay-brand-rollout-mockup.html`
- Source assets (SVG, PNG, generator): `internal/plans/mockups/overlay-brand/`
- Full line-by-line inventory: Appendix below (about 680 rows)

## Decisions to confirm

1. **One component, `OverlayMark`**, rewritten in `@overlay/ui` to render the O. Props: `size`, `motion: 'none' | 'blink' | 'look'`. Below 24px it switches to the larger small-size eyes. `Orb` is deleted, not kept as an alias.
2. **Motion mapping.** Idle brand marks: static. Overlay agent avatar: blink (same as creatures). Thinking, loading, streaming, running tool rows: `look` (eyes glance left and right). Reduced motion: static.
3. **Wordmark** is real "Overlay" text in Libre Baskerville with the O swapped for the mark (`BrandLockup` renders mark + "verlay"), so it stays selectable and sized by `font-size`. Outlined SVG is used only where fonts can't load (OG images, email PNG, desktop tray, docs).
4. **Overlay agent identity.** `AgentCreature` gains an `isDefault` input (from `agent.isDefault`, already stored) and renders `OverlayMark` for it. Gray color alone is not used, so user agents that happen to be gray stay creatures.
5. **Other agents stay creatures.** AGENTS.md rule is rewritten: "Agents are creatures, except the default Overlay agent, which is the O mark."
6. **Raster files** in `public/` are regenerated from the new SVGs at the same filenames, so existing references (email, white-label sentinel, metadata) keep working.

## Phases

| # | Scope | Main files |
|---|---|---|
| 1 | New `OverlayMark` + eye motion in `@overlay/ui`; delete `Orb`, `OVERLAY_ORB_DEFAULT_COLOR`, glow variant, metal palette | `packages/overlay-ui/src/components/orb/Orb.tsx`, `src/components/orb/Orb.tsx`, package exports |
| 2 | Wordmark: `BrandLockup` to "Overlay", plus sidebar, admin, auth, landing, footer, docs headers | `src/components/brand/BrandLockup.tsx`, `AppSidebar` `BrandMark`, `apps/admin` |
| 3 | Loaders and thinking: chat response loading, streaming rows, boot loader, page loaders; replace opacity pulse CSS with `motion="look"` | chat-react loading rows, boot loader, `ovorb-*` / pulse CSS |
| 4 | Tool, trace, approval, notebook markers; `TraceOrb` becomes `OverlayMark` with `look` while running | tool rail, trace, approval, notebook components |
| 5 | Overlay agent avatar: pass `isDefault` through every `AgentCreature` caller (sidebar, agent list, chat header, mentions, tasks, automations) | `src/components/orb/Creature.tsx` and 98 consumer rows |
| 6 | Static assets: favicon, apple-touch, `overlay-logo.png`, OG images and OG routes (lowercase o square), JSON-LD logo, email PNG | `public/`, `src/app/**/opengraph-image*`, `src/shared/email/lifecycle-email.ts` |
| 7 | Desktop (`overlay-desktop` submodule): app icon, tray, onboarding, raster stream markers, `ToolLineLogo`, vendored package copies; separate PR in that repo | `overlay-desktop/resources/**`, desktop renderer |
| 8 | Mobile (`overlay-mobile`): icon, adaptive icon, splash. Not in this checkout; inventory when it is cloned | `overlay-mobile/assets/**`, `app.json` |
| 9 | Docs, rules, tests: AGENTS.md brand and avatar rules, design docs, snapshots, stories | `AGENTS.md`, `internal/**`, tests listed in Appendix |

Each phase is one PR to main with a preview; phases 1 and 2 land first since the rest depend on the component.

## Verification

- Targeted ESLint and `tsc` per phase, updated snapshots.
- `rg -n "Orb\b|OverlayMark|ovorb|metal" src packages apps` returns only the new component after phase 4.
- `rg -n "'overlay'|>overlay<" src packages apps` returns no brand wordmark after phase 2.
- Preview QA in light and dark: landing header, sidebar, Overlay agent in agent list and chat, chat loading, tool rows, boot loader, favicon, an OG link preview, a lifecycle email.

## Known gaps

- `overlay-mobile/` is not in this checkout.
- Binary images and screenshots were inventoried by filename and reference; artwork inside them is not visually checked.
- Desktop vendored package copies differ from web and need their own pass.

---

# Appendix: full inventory


Research-only filesystem inventory of `/home/ubuntu/repos/overlay-web`. Paths below are relative to that root, including the checked-out `overlay-desktop/` submodule. No source files were changed. Pre-existing and concurrently created `internal/plans/mockups/` work was left untouched and excluded.

### Scope and counting

Recursive source/asset scan includes hidden policy files, root source, packages, admin, Convex, docs, internal plans (except mockups), tests/scripts, and desktop including its vendored package copies. Excludes node_modules, .next, dist, .git, build output and coverage. Counts are **table rows (references)**, not unique renderers: imports, exports, declarations and JSX usages are separate rows; a source location can appear in multiple purpose groups. Binary assets use `:-` because they have no source line. Related ranges are explicitly marked.

`overlay-mobile/` **does not exist in this checkout**; mobile icon/splash/config inventory cannot be supplied without that repository. `apps/admin/public/` is absent; admin has no separate icon assets found. No web manifest, apple-touch icon, or dedicated favicon file was found in web/admin; Next's `src/app/icon.png` and root metadata provide the web icon. Docs have a separate favicon. Do not confuse Apple/provider logos or browser-page favicons with Overlay branding.

### Findings and implementation boundaries

- New target: uppercase Libre Baskerville **O with two eyes**, capitalized **Overlay** wordmark. Current canonical mark is inline metallic SVG `Orb` → `OverlayMark`; the glow variant remains part of the exported API and is its default variant; the AI Elements story uses implicit glow Orbs. No explicit `variant="glow"` JSX usage was found.
- `BrandLockup` centralizes most web logo text. Sidebar, admin, email, docs outlined SVGs, OG routes and desktop contain separate wordmarks. Changing only BrandLockup will miss these. Libre Baskerville font definitions/preload already exist in web.
- Default agent creation is **server-side `WorkspaceAgentService.ensureDefaultAgent`**, not a hardcoded Convex seed. It seeds gray `#64748b`, no shape, and `isDefault: true`. Convex stores optional color/shape/default. Existing defaults are returned unchanged (except model upgrade), so a new seed alone cannot migrate existing avatars.
- `AgentCreature` has only name/color/shape, no stable default-agent identity. It maps legacy `#18181b` to gray for **any** matching agent. To brand only Overlay's default agent, identity must reach the renderer; gray/color/name alone risks changing unrelated agents. Member/mention/work projections must be reviewed if threading isDefault/id through consumers.
- Web pulse markers generally wrap a **static** Orb in CSS opacity animation. `TraceOrb` sets `animated={running}` but leaves Orb state at its default idle: its sheen drifts, despite the comment saying it breathes. Moving eyes will require coordinated marker/animation changes, not only replacing SVG geometry.
- Desktop uses **older vendored package copies**, raster-backed CSS stream markers and a configurable ToolLineLogo, not the web Orb implementation. Both copies are inventoried independently. Desktop's resource icons/tray/onboarding must be updated separately.
- The white-label `/assets/overlay-logo.png` default is a sentinel: web sidebar resolves it to OverlayMark; custom configured logos must remain custom. Email intentionally uses the raster.
- Share OG routes have a separate lowercase **o** in a white rounded square, not the metallic mark. Root social previews are static PNGs, plus marketing JSON-LD references the logo.
- Some native assets and screenshot/social PNGs may contain historical artwork rather than the metallic orb; filenames and references establish scope, not visual identity. No browser/UI/native runtime or binary visual verification was performed.

### Counts

| Group | Rows |
| --- | ---: |
| Mark implementation and exports | 32 |
| Brand lockup and navigation mark usage | 43 |
| Loaders, thinking and streaming markers | 45 |
| Tool, trace, approval and notebook markers | 47 |
| Agent identity, default seeding and avatar consumers | 98 |
| Miscellaneous mark references and stories | 12 |
| Logo and potentially branded image assets | 21 |
| Asset references, metadata and desktop resource wiring | 79 |
| Wordmark text and wordmark callers | 67 |
| Related styling and motion | 131 |
| Tests and snapshots | 59 |
| Documentation, rules and historical references | 45 |

### Mark implementation and exports

| file:line | what it renders | notes |
| --- | --- | --- |
| `packages/overlay-ui/src/components/orb/Orb.tsx:6` | Canonical mark implementation / compatibility exports | Source: `* Styles live in '../../styles.css' ('ovorb-*' classes).` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:12` | Canonical mark implementation / compatibility exports | Source: `export type OrbState = 'idle' \| 'working' \| 'waiting' \| 'offline'` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:13` | Canonical mark implementation / compatibility exports | Source: `export type OrbVariant = 'metal' \| 'glow'` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:15` | Canonical mark implementation / compatibility exports | Source: `export type OrbProps = {` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:16` | Canonical mark implementation / compatibility exports | Source: `variant?: OrbVariant` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:21` | Canonical mark implementation / compatibility exports | Source: `state?: OrbState` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:89` | Canonical mark implementation / compatibility exports | Source: `const STATE_CLASS: Record<OrbState, string> = {` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:90` | Canonical mark implementation / compatibility exports | Source: `idle: 'ovorb-drift',` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:91` | Canonical mark implementation / compatibility exports | Source: `working: 'ovorb-spin',` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:92` | Canonical mark implementation / compatibility exports | Source: `waiting: 'ovorb-breathe',` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:96` | Canonical mark implementation / compatibility exports | Source: `export function Orb({` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:105` | Canonical mark implementation / compatibility exports | Source: `}: OrbProps) {` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:107` | Canonical mark implementation / compatibility exports | Source: `const p = variant === 'metal' ? METAL : glowPalette(color)` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:108` | Canonical mark implementation / compatibility exports | Source: `const motion = !animated \|\| state === 'offline' ? '' : STATE_CLASS[state]` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:109` | Canonical mark implementation / compatibility exports | Source: `const dimmed = state === 'offline' ? 'ovorb-dim' : ''` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:113` | Canonical mark implementation / compatibility exports | Source: `<span` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:115` | Canonical mark implementation / compatibility exports | Source: `aria-label={decorative ? undefined : (label ?? (variant === 'metal' ? 'Overlay' : 'Agent orb'))}` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:117` | Canonical mark implementation / compatibility exports | Source: `className={cn('ovorb-root', motion, dimmed, className)}` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:121` | Canonical mark implementation / compatibility exports | Source: `filter: glow && variant === 'glow' && state !== 'offline'` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:126` | Canonical mark implementation / compatibility exports | Source: `<svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:163` | Canonical mark implementation / compatibility exports | Source: `<span className="ovorb-sheen" aria-hidden="true" />` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:169` | Canonical mark implementation / compatibility exports | Source: `export function OverlayMark({` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:178` | Canonical mark implementation / compatibility exports | Source: `return <Orb variant="metal" size={size} state="idle" animated={false} label={label} className={className} />` |
| `packages/overlay-ui/src/index.ts:2` | Mark import/export dependency | Source: `export * from './components/orb/Orb'` |
| `src/components/orb/Orb.tsx:6` | Canonical mark implementation / compatibility exports | Source: `* established '@/components/orb/Orb' import path working. Agent avatars live` |
| `src/components/orb/Orb.tsx:11` | Canonical mark implementation / compatibility exports | Source: `Orb,` |
| `src/components/orb/Orb.tsx:12` | Canonical mark implementation / compatibility exports | Source: `OverlayMark,` |
| `src/components/orb/Orb.tsx:15` | Canonical mark implementation / compatibility exports | Source: `export type { OrbProps, OrbState, OrbVariant } from '@overlay/ui'` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:37` | Orb public palette constant/dependency | Source: `export const OVERLAY_ORB_DEFAULT_COLOR = '#71717a'` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:70` | Orb public palette constant/dependency | Source: `const mid = hexToRgb(base) ?? hexToRgb(OVERLAY_ORB_DEFAULT_COLOR)!` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:98` | Orb public palette constant/dependency | Source: `color = OVERLAY_ORB_DEFAULT_COLOR,` |
| `src/components/orb/Orb.tsx:13` | Orb public palette constant/dependency | Source: `OVERLAY_ORB_DEFAULT_COLOR,` |

### Brand lockup and navigation mark usage

| file:line | what it renders | notes |
| --- | --- | --- |
| `apps/admin/src/app/denied/page.tsx:3` | Shared brand lockup / navigation mark caller | Source: `import { OperatorLockup } from '@/features/admin/OperatorLockup'` |
| `apps/admin/src/app/denied/page.tsx:9` | Shared brand lockup / navigation mark caller | Source: `<OperatorLockup />` |
| `apps/admin/src/app/sign-in/page.tsx:3` | Shared brand lockup / navigation mark caller | Source: `import { OperatorLockup } from '@/features/admin/OperatorLockup'` |
| `apps/admin/src/app/sign-in/page.tsx:25` | Shared brand lockup / navigation mark caller | Source: `<OperatorLockup />` |
| `apps/admin/src/features/admin/OperatorLockup.tsx:3` | Mark import/export dependency | Source: `import { OverlayMark } from '@overlay/ui'` |
| `apps/admin/src/features/admin/OperatorLockup.tsx:6` | Shared brand lockup / navigation mark caller | Source: `export function OperatorLockup() {` |
| `apps/admin/src/features/admin/OperatorLockup.tsx:9` | Inline metallic mark / Orb reference | Source: `<OverlayMark size={10} />` |
| `src/app/_components/onboarding/OnboardingIntro.tsx:4` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/app/_components/onboarding/OnboardingIntro.tsx:18` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup className={styles.introLockup} />` |
| `src/app/_components/RouteLoadingFallbacks.tsx:1` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/app/_components/RouteLoadingFallbacks.tsx:48` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup style={{ fontSize: 20 }} />` |
| `src/app/_components/RouteLoadingFallbacks.tsx:63` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup style={{ fontSize: 20 }} />` |
| `src/app/app/account/account-content.tsx:9` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/app/app/account/account-content.tsx:30` | Shared brand lockup / navigation mark caller | Source: `<header className="flex items-center justify-between px-6 py-6 sm:px-10"><BrandLockup className="text-2xl" /><Button asChild variant="ghost" size="sm"><Link href="/app/work"><ArrowLeft className="size-4" />Back to app</Link></Button></header>` |
| `src/app/auth/_components/AuthPageChrome.tsx:7` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/app/auth/_components/AuthPageChrome.tsx:13` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup style={{ fontSize: 20 }} />` |
| `src/components/brand/BrandLockup.tsx:2` | Mark import/export dependency | Source: `import { OverlayMark } from '@/components/orb/Orb'` |
| `src/components/brand/BrandLockup.tsx:14` | Inline metallic mark / Orb reference | Source: `* Always renders the inline SVG 'OverlayMark', never a raster logo.` |
| `src/components/brand/BrandLockup.tsx:16` | Shared brand lockup / navigation mark caller | Source: `export function BrandLockup({ className = '', ...rest }: HTMLAttributes<HTMLSpanElement>) {` |
| `src/components/brand/BrandLockup.tsx:20` | Inline metallic mark / Orb reference | Source: `<OverlayMark size={64} label="" />` |
| `src/components/layout/AppBootLoader.tsx:5` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/components/layout/AppBootLoader.tsx:41` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup className="app-brand-loader-lockup" />` |
| `src/components/layout/AppSidebar.tsx:50-65` | Sidebar brand configuration passed to brand link | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `src/components/layout/AppSidebar.tsx:56` | Shared brand lockup / navigation mark caller | Source: `<SidebarBrandLink` |
| `src/components/layout/AppSidebar.tsx:145-158` | Desktop/sidebar brand link configuration | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `src/components/layout/AppSidebar.tsx:149` | Shared brand lockup / navigation mark caller | Source: `<SidebarBrandLink` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:32` | Mark import/export dependency | Source: `import { OverlayMark } from '@/components/orb/Orb'` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:63` | Inline metallic mark / Orb reference | Source: `<OverlayMark size={size} label={logoAlt \|\| 'Overlay'} />` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:87` | Shared brand lockup / navigation mark caller | Source: `<BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0" />` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:123` | Shared brand lockup / navigation mark caller | Source: `<BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0 group-hover:hidden" />` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:136` | Shared brand lockup / navigation mark caller | Source: `<BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0" />` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:138-143` | Expanded sidebar dynamic serif wordmark from label | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `src/features/auth/components/SignInCornerPopover.tsx:7` | Mark import/export dependency | Source: `import { OverlayMark } from '@/components/orb/Orb'` |
| `src/features/auth/components/SignInCornerPopover.tsx:39` | Inline metallic mark / Orb reference | Source: `<OverlayMark size={16} label="" />` |
| `src/features/marketing/components/MarketingFooter.tsx:5` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from "@/components/brand/BrandLockup";` |
| `src/features/marketing/components/MarketingFooter.tsx:74` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup style={{ fontSize: 18 }} />` |
| `src/features/marketing/landing/LandingNav.tsx:9` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/features/marketing/landing/LandingNav.tsx:27` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup />` |
| `src/features/marketing/landing/LandingProductShot.tsx:2` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/features/marketing/landing/LandingProductShot.tsx:44` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup />` |
| `src/features/workspaces/components/WorkspaceDirectory.tsx:8` | Shared brand lockup / navigation mark caller | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/features/workspaces/components/WorkspaceDirectory.tsx:83` | Shared brand lockup / navigation mark caller | Source: `<BrandLockup className="text-2xl" />` |
| `src/components/layout/AppSidebar.tsx:206` | Classic rail brand renderer | Source: `<SidebarRailBrand` |

### Loaders, thinking and streaming markers

| file:line | what it renders | notes |
| --- | --- | --- |
| `overlay-desktop/packages/overlay-chat-react/src/components/BrandMark.tsx:1` | Stream marker, boot loader, or animated mark dependency | Source: `export function BrandMark({ pulse = false }: { pulse?: boolean }) {` |
| `overlay-desktop/packages/overlay-chat-react/src/components/BrandMark.tsx:7` | Stream marker, boot loader, or animated mark dependency | Source: `className="overlay-stream-marker overlay-stream-marker--standalone"` |
| `overlay-desktop/packages/overlay-chat-react/src/components/markdown/normalization.ts:7` | Stream marker, boot loader, or animated mark dependency | Source: `const STREAM_MARKER_HTML = '<span class="overlay-stream-marker" aria-hidden="true"></span>'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/markdown/plugins.ts:18` | Stream marker, boot loader, or animated mark dependency | Source: `['className', 'overlay-stream-marker', 'md-char'],` |
| `overlay-desktop/packages/overlay-chat-react/src/components/markdown/plugins.ts:37` | Stream marker, boot loader, or animated mark dependency | Source: `* subtrees (and the overlay-stream-marker) to avoid breaking their rendering.` |
| `overlay-desktop/packages/overlay-chat-react/src/components/markdown/plugins.ts:78` | Stream marker, boot loader, or animated mark dependency | Source: `return arr.includes('overlay-stream-marker')` |
| `overlay-desktop/packages/overlay-chat-react/src/components/MarkdownMessage.tsx:228` | Stream marker, boot loader, or animated mark dependency | Source: `// '.overlay-stream-marker' at the tail carries the "still generating" cue. When` |
| `overlay-desktop/packages/overlay-chat-react/src/components/MarkdownMessage.tsx:273` | Stream marker, boot loader, or animated mark dependency | Source: `<span className="overlay-stream-marker" aria-hidden />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.tsx:65` | Stream marker, boot loader, or animated mark dependency | Source: `className="overlay-stream-marker overlay-stream-marker--standalone scale-75 opacity-80"` |
| `overlay-desktop/packages/overlay-modules-react/src/notes/agent-panel.tsx:52` | Stream marker, boot loader, or animated mark dependency | Source: `className="overlay-stream-marker overlay-stream-marker--standalone h-4 w-4"` |
| `overlay-desktop/packages/overlay-modules-react/src/notes/editor.tsx:1239` | Stream marker, boot loader, or animated mark dependency | Source: `const overlayLogo = logo ?? <span className="overlay-stream-marker h-3.5 w-3.5" aria-hidden />` |
| `packages/overlay-chat-react/src/components/BrandMark.tsx:3` | Stream marker, boot loader, or animated mark dependency | Source: `export function BrandMark({ pulse = false }: { pulse?: boolean }) {` |
| `packages/overlay-chat-react/src/components/BrandMark.tsx:9` | Stream marker, boot loader, or animated mark dependency | Source: `className="overlay-stream-marker overlay-stream-marker--standalone"` |
| `packages/overlay-chat-react/src/components/markdown/plugins.ts:17` | Stream marker, boot loader, or animated mark dependency | Source: `['className', 'overlay-stream-marker', 'md-char'],` |
| `packages/overlay-chat-react/src/components/markdown/renderers.tsx:13` | Mark import/export dependency | Source: `import { Orb } from '@overlay/ui'` |
| `packages/overlay-chat-react/src/components/markdown/renderers.tsx:286` | Stream marker, boot loader, or animated mark dependency | Source: `if (classes.includes('overlay-stream-marker')) {` |
| `packages/overlay-chat-react/src/components/markdown/renderers.tsx:287` | Stream marker, boot loader, or animated mark dependency | Source: `const standalone = classes.includes('overlay-stream-marker--standalone')` |
| `packages/overlay-chat-react/src/components/markdown/renderers.tsx:290` | Inline metallic mark / Orb reference | Source: `<Orb variant="metal" size={standalone ? 20 : 14} animated={false} label="" />` |
| `packages/overlay-chat-react/src/components/MarkdownMessage.tsx:2` | Mark import/export dependency | Source: `import { Orb } from '@overlay/ui'` |
| `packages/overlay-chat-react/src/components/MarkdownMessage.tsx:263` | Stream marker, boot loader, or animated mark dependency | Source: `<span className="overlay-stream-marker" aria-hidden>` |
| `packages/overlay-chat-react/src/components/MarkdownMessage.tsx:264` | Inline metallic mark / Orb reference | Source: `<Orb variant="metal" size={14} animated={false} label="" />` |
| `packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.tsx:2` | Mark import/export dependency | Source: `import { Orb } from '@overlay/ui'` |
| `packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.tsx:67` | Stream marker, boot loader, or animated mark dependency | Source: `className="overlay-stream-marker overlay-stream-marker--standalone scale-75 opacity-80"` |
| `packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.tsx:70` | Inline metallic mark / Orb reference | Source: `<Orb variant="metal" size={20} animated={false} label="" />` |
| `packages/overlay-modules-react/src/notes/agent-panel.tsx:62` | Stream marker, boot loader, or animated mark dependency | Source: `className="overlay-stream-marker overlay-stream-marker--standalone h-4 w-4"` |
| `packages/overlay-modules-react/src/notes/editor.tsx:700` | Stream marker, boot loader, or animated mark dependency | Source: `<span className="overlay-stream-marker h-3.5 w-3.5" aria-hidden>` |
| `src/app/app/_components/AppRouteSkeletons.tsx:49` | Stream marker, boot loader, or animated mark dependency | Source: `return <AppBootLoader />` |
| `src/app/page.tsx:9` | Stream marker, boot loader, or animated mark dependency | Source: `return <AppBootLoader />` |
| `src/components/layout/AppBootLoader.tsx:5` | Boot lockup entrance / synchronized pulse | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/components/layout/AppBootLoader.tsx:6` | Boot lockup entrance / synchronized pulse | Source: `import { createBootEntranceClaim, createBootLoaderPulseClock } from './boot-loader-pulse'` |
| `src/components/layout/AppBootLoader.tsx:8` | Boot lockup entrance / synchronized pulse | Source: `const synchronizePulse = createBootLoaderPulseClock()` |
| `src/components/layout/AppBootLoader.tsx:19` | Boot lockup entrance / synchronized pulse | Source: `* mark never re-fades and the lockup just keeps blinking. The pulse phase is` |
| `src/components/layout/AppBootLoader.tsx:23` | Boot lockup entrance / synchronized pulse | Source: `const pulseRef = useRef<HTMLDivElement>(null)` |
| `src/components/layout/AppBootLoader.tsx:28` | Boot lockup entrance / synchronized pulse | Source: `const pulse = pulseRef.current` |
| `src/components/layout/AppBootLoader.tsx:29` | Boot lockup entrance / synchronized pulse | Source: `const now = pulse?.ownerDocument.timeline.currentTime` |
| `src/components/layout/AppBootLoader.tsx:30` | Boot lockup entrance / synchronized pulse | Source: `const animation = pulse?.getAnimations()[0]` |
| `src/components/layout/AppBootLoader.tsx:31` | Boot lockup entrance / synchronized pulse | Source: `if (animation && typeof now === 'number') synchronizePulse(animation, now)` |
| `src/components/layout/AppBootLoader.tsx:37` | Boot lockup entrance / synchronized pulse | Source: `className={'flex flex-col items-center${settled \|\| !playsEntrance ? ' app-brand-loader--steady' : ''}'}` |
| `src/components/layout/AppBootLoader.tsx:39` | Boot lockup entrance / synchronized pulse | Source: `<div ref={pulseRef} className="app-brand-loader-pulse">` |
| `src/components/layout/AppBootLoader.tsx:40` | Boot lockup entrance / synchronized pulse | Source: `<div className="app-brand-loader" role="status" aria-label="Loading overlay">` |
| `src/components/layout/AppBootLoader.tsx:41` | Boot lockup entrance / synchronized pulse | Source: `<BrandLockup className="app-brand-loader-lockup" />` |
| `src/components/layout/AppBootLoader.tsx:44` | Boot lockup entrance / synchronized pulse | Source: `<div className="app-brand-loader-wsline mt-[30px] flex items-center text-sm text-muted">` |
| `src/components/layout/boot-loader-pulse.ts:2` | Stream marker, boot loader, or animated mark dependency | Source: `export function createBootLoaderPulseClock() {` |
| `src/features/auth/RootEntryResolver.tsx:54` | Stream marker, boot loader, or animated mark dependency | Source: `return <AppBootLoader settled />` |
| `src/features/workspaces/components/WorkspaceAppBoundary.tsx:53` | Stream marker, boot loader, or animated mark dependency | Source: `return <AppBootLoader settled />` |

### Tool, trace, approval and notebook markers

| file:line | what it renders | notes |
| --- | --- | --- |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/browser-tool-block.tsx:8` | Trace/tool identity marker or wrapper | Source: `import { ToolLogoColumn } from './tool-rail'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/browser-tool-block.tsx:53` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/browser-tool-block.tsx:75` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/memory-tool-block.tsx:10` | Trace/tool identity marker or wrapper | Source: `import { ToolLogoColumn } from './tool-rail'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/memory-tool-block.tsx:56` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/memory-tool-block.tsx:67` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/reasoning-block.tsx:8` | Trace/tool identity marker or wrapper | Source: `import { ToolLogoColumn } from './tool-rail'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/reasoning-block.tsx:36` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx:11` | Trace/tool identity marker or wrapper | Source: `import { ToolLogoColumn } from './tool-rail'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx:34` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx:62` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx:123` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:5` | Trace/tool identity marker or wrapper | Source: `export function ToolLineLogo() {` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:22` | Trace/tool identity marker or wrapper | Source: `export function ToolLogoColumn({` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:47` | Trace/tool identity marker or wrapper | Source: `<ToolLineLogo />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/web-search-tool-block.tsx:14` | Trace/tool identity marker or wrapper | Source: `import { ToolLogoColumn } from './tool-rail'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/web-search-tool-block.tsx:44` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/web-search-tool-block.tsx:55` | Trace/tool identity marker or wrapper | Source: `<ToolLogoColumn connectTop={connectTop} connectBottom={connectBottom} />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.tsx:3` | Trace/tool identity marker or wrapper | Source: `import { ToolLineLogo } from '../exchange/tool-rail'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.tsx:71` | Trace/tool identity marker or wrapper | Source: `<ToolLineLogo />` |
| `packages/overlay-chat-react/src/components/ai-elements/confirmation.tsx:5` | Trace/tool identity marker or wrapper | Source: `import { TraceOrb } from '../exchange/tool-rail'` |
| `packages/overlay-chat-react/src/components/ai-elements/confirmation.tsx:26` | Trace/tool identity marker or wrapper | Source: `<TraceOrb running={running} />` |
| `packages/overlay-chat-react/src/components/exchange/reasoning-block.tsx:13` | Trace/tool identity marker or wrapper | Source: `import { TraceOrb } from './tool-rail'` |
| `packages/overlay-chat-react/src/components/exchange/reasoning-block.tsx:38` | Trace/tool identity marker or wrapper | Source: `<TraceOrb running={streaming} />` |
| `packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx:18` | Trace/tool identity marker or wrapper | Source: `import { TraceOrb } from './tool-rail'` |
| `packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx:50` | Trace/tool identity marker or wrapper | Source: `<TraceOrb running={running} />` |
| `packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx:81` | Trace/tool identity marker or wrapper | Source: `<TraceOrb />` |
| `packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx:133` | Trace/tool identity marker or wrapper | Source: `<TraceOrb running={anyRunning && !anyErr} />` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:1` | Mark import/export dependency | Source: `import { Orb } from '@overlay/ui'` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:5` | Inline metallic mark / Orb reference | Source: `/** The Orb sits in every Trace step's icon slot; it breathes while the step runs. */` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:6` | Trace/tool identity marker or wrapper | Source: `export function TraceOrb({ running = false }: { running?: boolean }) {` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:9` | Inline metallic mark / Orb reference | Source: `<Orb variant="metal" size={6.5} animated={running} label="" className="size-[0.5em]! select-none [&_svg]:size-full!" />` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:14` | Trace/tool identity marker or wrapper | Source: `export const ToolLineLogo = TraceOrb` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:17` | Trace/tool identity marker or wrapper | Source: `export function ToolLogoColumn(props: { connectTop: boolean; connectBottom: boolean; running?: boolean }) {` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:18` | Trace/tool identity marker or wrapper | Source: `return <TraceOrb running={props.running} />` |
| `packages/overlay-chat-react/src/components/exchange/trace-step.tsx:11` | Trace/tool identity marker or wrapper | Source: `import { TraceOrb } from './tool-rail'` |
| `packages/overlay-chat-react/src/components/exchange/trace-step.tsx:33` | Trace/tool identity marker or wrapper | Source: `<TraceOrb running={running} />` |
| `packages/overlay-chat-react/src/components/exchange/worked-for-group.tsx:6` | Trace/tool identity marker or wrapper | Source: `import { TraceOrb } from './tool-rail'` |
| `packages/overlay-chat-react/src/components/exchange/worked-for-group.tsx:48` | Trace/tool identity marker or wrapper | Source: `<TraceOrb />` |
| `packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.tsx:4` | Trace/tool identity marker or wrapper | Source: `import { ToolLineLogo } from '../exchange/tool-rail'` |
| `packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.tsx:75` | Trace/tool identity marker or wrapper | Source: `<ToolLineLogo />` |
| `packages/overlay-modules-react/src/notes/agent-panel.tsx:5` | Mark import/export dependency | Source: `import { Orb } from '@overlay/ui'` |
| `packages/overlay-modules-react/src/notes/agent-panel.tsx:66` | Inline metallic mark / Orb reference | Source: `<Orb variant="metal" size={16} animated={false} label="" />` |
| `packages/overlay-modules-react/src/notes/editor.tsx:13` | Mark import/export dependency | Source: `import { Orb } from '@overlay/ui'` |
| `packages/overlay-modules-react/src/notes/editor.tsx:701` | Inline metallic mark / Orb reference | Source: `<Orb variant="metal" size={14} animated={false} label="" />` |
| `src/features/notebook/components/NotebookEditor.tsx:4` | Mark import/export dependency | Source: `import { OverlayMark } from '@/components/orb/Orb'` |
| `src/features/notebook/components/NotebookEditor.tsx:184` | Inline metallic mark / Orb reference | Source: `<OverlayMark size={14} label="" />` |

### Agent identity, default seeding and avatar consumers

| file:line | what it renders | notes |
| --- | --- | --- |
| `convex/collaboration/agents.ts:28` | Stored default/avatar identity contract or shape fallback | Source: `avatarColor: v.optional(v.string()),` |
| `convex/collaboration/agents.ts:29` | Stored default/avatar identity contract or shape fallback | Source: `avatarShape: v.optional(v.string()),` |
| `convex/collaboration/agents.ts:39` | Stored default/avatar identity contract or shape fallback | Source: `isDefault: v.optional(v.boolean()),` |
| `convex/collaboration/agents.ts:47` | Stored default/avatar identity contract or shape fallback | Source: `modelId: v.string(), avatarColor: v.optional(v.string()), avatarShape: v.optional(v.string()),` |
| `convex/collaboration/agents.ts:51` | Stored default/avatar identity contract or shape fallback | Source: `isDefault: v.optional(v.boolean()),` |
| `convex/collaboration/agents.ts:99` | Stored default/avatar identity contract or shape fallback | Source: `avatarColor: cleanOptional(args.avatarColor), avatarShape: cleanOptional(args.avatarShape),` |
| `convex/collaboration/agents.ts:105` | Stored default/avatar identity contract or shape fallback | Source: `isDefault: args.isDefault \|\| args.name.trim().toLowerCase() === 'overlay' ? true : undefined,` |
| `convex/collaboration/agents.ts:185` | Stored default/avatar identity contract or shape fallback | Source: `harness: v.optional(writableHarness), modelId: v.optional(v.string()), avatarColor: v.optional(v.string()),` |
| `convex/collaboration/agents.ts:186` | Stored default/avatar identity contract or shape fallback | Source: `avatarShape: v.optional(v.string()),` |
| `convex/collaboration/agents.ts:233` | Stored default/avatar identity contract or shape fallback | Source: `avatarColor?: string` |
| `convex/collaboration/agents.ts:234` | Stored default/avatar identity contract or shape fallback | Source: `avatarShape?: string` |
| `convex/collaboration/agents.ts:247` | Stored default/avatar identity contract or shape fallback | Source: `...(args.avatarColor === undefined ? {} : { avatarColor: cleanOptional(args.avatarColor) }),` |
| `convex/collaboration/agents.ts:248` | Stored default/avatar identity contract or shape fallback | Source: `...(args.avatarShape === undefined ? {} : { avatarShape: cleanOptional(args.avatarShape) }),` |
| `convex/collaboration/agents.ts:309` | Stored default/avatar identity contract or shape fallback | Source: `if (row.isDefault \|\| row.name.toLowerCase() === 'overlay') return false` |
| `convex/collaboration/agents.ts:424` | Stored default/avatar identity contract or shape fallback | Source: `if (row.isDefault \|\| row.name.toLowerCase() === 'overlay') return false` |
| `convex/schema.ts:2285` | Stored default/avatar identity contract or shape fallback | Source: `avatarColor: v.optional(v.string()),` |
| `convex/schema.ts:2286` | Stored default/avatar identity contract or shape fallback | Source: `avatarShape: v.optional(v.string()),` |
| `convex/schema.ts:2298` | Stored default/avatar identity contract or shape fallback | Source: `isDefault: v.optional(v.boolean()),` |
| `packages/overlay-ui/src/components/orb/Orb.tsx:17` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `/** Base hex color for the 'glow' variant. Not an agent identity: agents render as creatures ('AgentCreature'). */` |
| `packages/overlay-workspace-contracts/src/types.ts:329` | Stored default/avatar identity contract or shape fallback | Source: `avatarColor?: string` |
| `packages/overlay-workspace-contracts/src/types.ts:330` | Stored default/avatar identity contract or shape fallback | Source: `avatarShape?: string` |
| `packages/overlay-workspace-contracts/src/types.ts:579` | Stored default/avatar identity contract or shape fallback | Source: `export const WORKSPACE_AGENT_CREATURE_SHAPES = [` |
| `packages/overlay-workspace-contracts/src/types.ts:589` | Stored default/avatar identity contract or shape fallback | Source: `export type WorkspaceAgentCreatureShape = (typeof WORKSPACE_AGENT_CREATURE_SHAPES)[number]` |
| `packages/overlay-workspace-contracts/src/types.ts:593` | Stored default/avatar identity contract or shape fallback | Source: `&& (WORKSPACE_AGENT_CREATURE_SHAPES as readonly string[]).includes(value)` |
| `packages/overlay-workspace-contracts/src/types.ts:608` | Stored default/avatar identity contract or shape fallback | Source: `avatarColor?: string` |
| `packages/overlay-workspace-contracts/src/types.ts:610` | Stored default/avatar identity contract or shape fallback | Source: `avatarShape?: WorkspaceAgentCreatureShape` |
| `packages/overlay-workspace-contracts/src/types.ts:618` | Stored default/avatar identity contract or shape fallback | Source: `isDefault?: boolean` |
| `packages/overlay-workspace-contracts/src/types.ts:630` | Stored default/avatar identity contract or shape fallback | Source: `avatarColor?: string` |
| `packages/overlay-workspace-contracts/src/types.ts:631` | Stored default/avatar identity contract or shape fallback | Source: `avatarShape?: WorkspaceAgentCreatureShape` |
| `packages/overlay-workspace-contracts/src/types.ts:634` | Stored default/avatar identity contract or shape fallback | Source: `isDefault?: boolean` |
| `src/app/_components/onboarding/OnboardingEmployees.tsx:6` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/app/_components/onboarding/OnboardingEmployees.tsx:50` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<AgentCreature agent={{ name: employee.name, avatarColor: COLORS[index % COLORS.length] }} size={28} />` |
| `src/components/layout/AppSidebarAgentsPanel.tsx:16` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/components/layout/AppSidebarAgentsPanel.tsx:512` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `: <AgentCreature agent={agent} size={24} />}` |
| `src/components/mentions/MentionPopup.tsx:19` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/components/mentions/MentionPopup.tsx:290` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<AgentCreature agent={{ name: item.name, avatarColor: item.avatarColor, avatarShape: item.avatarShape }} size={20} />` |
| `src/components/orb/Creature.tsx:69` | Creature eye renderer / avatar fallback | Source: `function CreatureEyes({ color }: { color: string }) {` |
| `src/components/orb/Creature.tsx:71` | Creature eye renderer / avatar fallback | Source: `<g className={styles.eyes} fill={color}>` |
| `src/components/orb/Creature.tsx:90` | Creature eye renderer / avatar fallback | Source: `aria-label={label}` |
| `src/components/orb/Creature.tsx:91` | Creature eye renderer / avatar fallback | Source: `className={animated ? styles.blink : undefined}` |
| `src/components/orb/Creature.tsx:96` | Creature eye renderer / avatar fallback | Source: `className={styles.bodyWrap}` |
| `src/components/orb/Creature.tsx:101` | Creature eye renderer / avatar fallback | Source: `<CreatureEyes color={creatureEyeColor(color)} />` |
| `src/components/orb/Creature.tsx:112` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `const LEGACY_DEFAULT_AGENT_COLOR = '#18181b'` |
| `src/components/orb/Creature.tsx:113` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `const DEFAULT_AGENT_COLOR = '#64748b'` |
| `src/components/orb/Creature.tsx:115` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `function agentBodyColor(color: string \| undefined): string {` |
| `src/components/orb/Creature.tsx:117` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `return color.toLowerCase() === LEGACY_DEFAULT_AGENT_COLOR ? DEFAULT_AGENT_COLOR : color` |
| `src/components/orb/Creature.tsx:120` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `export function AgentCreature({` |
| `src/components/orb/Creature.tsx:130` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<Creature` |
| `src/components/orb/Creature.tsx:131` | Creature eye renderer / avatar fallback | Source: `shape={agent.avatarShape}` |
| `src/components/orb/Creature.tsx:132` | Creature eye renderer / avatar fallback | Source: `color={agentBodyColor(agent.avatarColor)}` |
| `src/components/orb/Creature.tsx:135` | Creature eye renderer / avatar fallback | Source: `label={'${agent.name} avatar'}` |
| `src/features/agents/components/AgentAvatarPicker.tsx:48` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<Creature shape={shape} color={color} size={size} label="Agent avatar" />` |
| `src/features/agents/components/AgentAvatarPicker.tsx:68` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<Creature shape={option} color={color} size={40} animated={false} label="" />` |
| `src/features/agents/components/AgentComputerTab.parts.tsx:7` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/features/agents/components/AgentComputerTab.parts.tsx:52` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<AgentCreature` |
| `src/features/agents/components/AgentComputerTab.parts.tsx:82` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<AgentCreature` |
| `src/features/agents/lib/agent-editor-state.ts:19` | Creature eye renderer / avatar fallback | Source: `avatarColor: agent?.avatarColor ?? AVATAR_FALLBACK_COLOR,` |
| `src/features/agents/lib/agent-editor-state.ts:20` | Creature eye renderer / avatar fallback | Source: `avatarShape: agent?.avatarShape ?? 'circle',` |
| `src/features/automations/components/AutomationsInlinePanel.tsx:22` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/features/automations/components/AutomationsInlinePanel.tsx:239` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `return agent ? <AgentCreature agent={agent} size={16} /> : null` |
| `src/features/chat/components/collaboration/RoomMessageItem.tsx:34` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/features/chat/components/collaboration/RoomMessageItem.tsx:161` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<AgentCreature` |
| `src/features/chat/components/collaboration/RoomMessageItem.tsx:448` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<AgentCreature` |
| `src/features/chat/components/DirectMessageExperience.parts.tsx:21` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/features/chat/components/DirectMessageExperience.parts.tsx:207` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `return <AgentCreature agent={headerAgent ?? { name: soloAgentParticipant.displayName }} size={32} />` |
| `src/features/chat/components/NewDirectMessageDialog.tsx:5` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/features/chat/components/NewDirectMessageDialog.tsx:173` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<AgentCreature agent={{ name: item.name, avatarColor: item.avatarColor, avatarShape: item.avatarShape }} size={32} />` |
| `src/features/marketing/landing/LandingAgent.tsx:1` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/features/marketing/landing/LandingAgent.tsx:16` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `return <AgentCreature agent={LANDING_AGENTS[id]} size={size} />` |
| `src/features/work/components/work-ui.tsx:3` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/features/work/components/work-ui.tsx:67` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `<AgentCreature` |
| `src/features/workspaces/components/WorkspaceSettingsPanel.tsx:60` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `import { AgentCreature } from '@/components/orb/Creature'` |
| `src/features/workspaces/components/WorkspaceSettingsPanel.tsx:222` | Shared creature/default-color avatar renderer or consumer | Current AgentCreature accepts name/color/shape, not isDefault/id; changing every gray creature would also change non-default agents. Source: `{item.principalType === 'agent' ? <AgentCreature agent={item} size={36} /> : item.principalType === 'human' ? <Avatar className="size-9"><AvatarImage src={item.photoUrl ?? undefined} alt="" /><AvatarFallback>{identityInitials(item.name)}</AvatarFallback></Avatar> : <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle) text-(--muted)">` |
| `src/server/agents/WorkspaceAgentService.ts:39` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `await this.ensureDefaultAgent({ workspaceId: access.workspace.id, creatorPrincipalId: access.principal.id })` |
| `src/server/agents/WorkspaceAgentService.ts:69` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `await this.ensureDefaultAgent({ workspaceId: access.workspace.id, creatorPrincipalId: access.principal.id })` |
| `src/server/agents/WorkspaceAgentService.ts:79` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `async ensureDefaultAgent(args: { workspaceId: string; creatorPrincipalId: string }) {` |
| `src/server/agents/WorkspaceAgentService.ts:81` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `const currentDefault = existing.find((a) => a.isDefault \|\| a.name.toLowerCase() === 'overlay')` |
| `src/server/agents/WorkspaceAgentService.ts:82` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `if (currentDefault) {` |
| `src/server/agents/WorkspaceAgentService.ts:89` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `if (currentDefault.modelId === FREE_TIER_AUTO_MODEL_ID) {` |
| `src/server/agents/WorkspaceAgentService.ts:91` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `agentId: currentDefault.id,` |
| `src/server/agents/WorkspaceAgentService.ts:99` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `const agentId = 'default-overlay-${args.workspaceId}'` |
| `src/server/agents/WorkspaceAgentService.ts:100` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `const principalId = 'default-overlay-principal-${args.workspaceId}'` |
| `src/server/agents/WorkspaceAgentService.ts:106` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `name: 'Overlay',` |
| `src/server/agents/WorkspaceAgentService.ts:111` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `avatarColor: '#64748b',` |
| `src/server/agents/WorkspaceAgentService.ts:114` | Default Overlay agent creation / existing-default gate | No avatarShape is seeded; existing defaults return without avatar migration. Source: `isDefault: true,` |
| `src/shared/agents/agent-creature.ts:2` | Stored default/avatar identity contract or shape fallback | Source: `WORKSPACE_AGENT_CREATURE_SHAPES,` |
| `src/shared/agents/agent-creature.ts:6` | Stored default/avatar identity contract or shape fallback | Source: `export const DEFAULT_CREATURE_SHAPE: WorkspaceAgentCreatureShape = 'circle'` |
| `src/shared/agents/agent-creature.ts:62` | Stored default/avatar identity contract or shape fallback | Source: `export function normalizeCreatureShape(shape: string \| undefined): WorkspaceAgentCreatureShape {` |
| `src/shared/agents/agent-creature.ts:63` | Stored default/avatar identity contract or shape fallback | Source: `return (WORKSPACE_AGENT_CREATURE_SHAPES as readonly string[]).includes(shape ?? '')` |
| `src/shared/agents/agent-creature.ts:65` | Stored default/avatar identity contract or shape fallback | Source: `: DEFAULT_CREATURE_SHAPE` |
| `src/components/orb/Creature.tsx:72` | Eye/default avatar renderer context | Source: `<rect x="36" y="45" width="9.5" height="17" rx="4.75" />` |
| `src/components/orb/Creature.tsx:73` | Eye/default avatar renderer context | Source: `<rect x="54.5" y="45" width="9.5" height="17" rx="4.75" />` |
| `src/components/orb/Creature.tsx:114` | Eye/default avatar renderer context | Source: `` |
| `src/components/orb/Creature.tsx:116` | Eye/default avatar renderer context | Source: `if (!color) return '#71717a'` |
| `src/components/orb/Creature.tsx:124` | Eye/default avatar renderer context | Source: `}: {` |
| `src/components/orb/Creature.tsx:126` | Eye/default avatar renderer context | Source: `size?: number` |
| `src/server/agents/WorkspaceAgentService.ts:95` | Existing-default early return / seed context | Source: `}).catch((_error) => null)` |
| `src/server/agents/WorkspaceAgentService.ts:116` | Existing-default early return / seed context | Source: `createdByPrincipalId: args.creatorPrincipalId,` |

### Miscellaneous mark references and stories

| file:line | what it renders | notes |
| --- | --- | --- |
| `packages/overlay-chat-react/src/components/ai-elements/confirmation.tsx:11` | Inline metallic mark / Orb reference | Source: `/** Tool approval card: flat fill, Orb, title, requests, Approve / Deny. */` |
| `packages/overlay-chat-react/src/components/BrandMark.tsx:1` | Mark import/export dependency | Source: `import { OverlayMark } from '@overlay/ui'` |
| `packages/overlay-chat-react/src/components/BrandMark.tsx:13` | Inline metallic mark / Orb reference | Source: `<OverlayMark size={20} label="" />` |
| `packages/overlay-chat-react/src/components/BrandMark.tsx:16` | Inline metallic mark / Orb reference | Source: `<OverlayMark size={32} label="" />` |
| `packages/overlay-chat-react/src/components/exchange/trace-step.tsx:13` | Inline metallic mark / Orb reference | Source: `/** One work step: the Orb and a title, plus details behind a collapsible trigger when there are any. */` |
| `packages/overlay-ui/src/stories/AiElements.stories.tsx:3` | Mark import/export dependency | Source: `import { Orb } from '../components/orb/Orb'` |
| `packages/overlay-ui/src/stories/AiElements.stories.tsx:24` | Inline metallic mark / Orb reference | Source: `<TraceCollapsibleTrigger><TraceLine><TraceIcon><Orb size={14} /></TraceIcon><TraceTitle>Worked for 14s</TraceTitle></TraceLine></TraceCollapsibleTrigger>` |
| `packages/overlay-ui/src/stories/AiElements.stories.tsx:27` | Inline metallic mark / Orb reference | Source: `<TraceLine><TraceIcon><Orb size={14} /></TraceIcon><TraceTitle>Read churn_q3.csv</TraceTitle></TraceLine>` |
| `packages/overlay-ui/src/stories/AiElements.stories.tsx:28` | Inline metallic mark / Orb reference | Source: `<TraceLine status="error"><TraceIcon><Orb size={14} /></TraceIcon><TraceTitle>Failed to fetch billing events</TraceTitle></TraceLine>` |
| `packages/overlay-ui/src/stories/AiElements.stories.tsx:29` | Inline metallic mark / Orb reference | Source: `<TraceLine status="running"><TraceIcon><Orb size={14} /></TraceIcon><TraceTitle>Searching the web</TraceTitle></TraceLine>` |
| `src/features/marketing/landing/LandingProductShot.tsx:3` | Mark import/export dependency | Source: `import { Orb } from '@/components/orb/Orb'` |
| `src/features/marketing/landing/LandingProductShot.tsx:82` | Inline metallic mark / Orb reference | Source: `<div className="steps"><Orb variant="metal" size={7} animated={false} label="" />Worked for 2m 14s, called 9 tools<ChevronRight className="i sm" /></div>` |

### Logo and potentially branded image assets

| file:line | what it renders | notes |
| --- | --- | --- |
| `docs/assets/favicon.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 16454 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `docs/assets/overlay-lockup-dark.svg:-` | Overlay logo, social image, docs lockup, favicon or native icon | 5775 bytes. Vector artwork; inspect embedded glyph paths as well as accessible label. |
| `docs/assets/overlay-lockup-light.svg:-` | Overlay logo, social image, docs lockup, favicon or native icon | 5775 bytes. Vector artwork; inspect embedded glyph paths as well as accessible label. |
| `docs/assets/overlay-mark.svg:-` | Overlay logo, social image, docs lockup, favicon or native icon | 1997 bytes. Vector artwork; inspect embedded glyph paths as well as accessible label. |
| `overlay-desktop/resources/icon-tray.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 1688 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `overlay-desktop/resources/icon.icns:-` | Overlay logo, social image, docs lockup, favicon or native icon | 2076123 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `overlay-desktop/resources/icon.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 846691 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `overlay-desktop/resources/logos/logo-big-no-bg-menu-tray-icon.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 475 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `overlay-desktop/resources/logos/logo-big-no-bg.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 432418 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `overlay-desktop/resources/logos/logo-big.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 248616 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `public/assets/images/overlay-connectors.png:-` | Marketing screenshot / illustration; may contain embedded old branding | 161467 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `public/assets/images/overlay-model-routing.png:-` | Marketing screenshot / illustration; may contain embedded old branding | 89579 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `public/assets/images/Screenshot 2026-04-24 at 4.39.17 PM.png:-` | Marketing screenshot / illustration; may contain embedded old branding | 89579 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `public/assets/images/Screenshot 2026-04-28 at 5.35.01 PM.png:-` | Marketing screenshot / illustration; may contain embedded old branding | 161467 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `public/assets/overlay-logo.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 88705 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `public/assets/overlay-share-linkedin-thumb.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 90234 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `public/assets/overlay-share-thumb.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 136019 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `public/assets/overlay-share-x-thumb.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 93349 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `src/app/icon.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 232186 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `src/assets/overlay-logo.png:-` | Overlay logo, social image, docs lockup, favicon or native icon | 232186 bytes. Binary asset: line number not applicable; artwork not visually verified. |
| `overlay-desktop/resources/logos/overlay-chat-mark.png:-` | Desktop bundled chat / notebook brand mark | 186372 bytes; imported by desktop transcript, sources, notebook editor and notebook panel. |

### Asset references, metadata and desktop resource wiring

| file:line | what it renders | notes |
| --- | --- | --- |
| `docs/docs.json:11` | Metadata, font preload or native icon configuration | Source: `"logo": {` |
| `docs/docs.json:12` | Logo image / metadata / asset reference | Source: `"light": "/assets/overlay-lockup-light.svg",` |
| `docs/docs.json:13` | Logo image / metadata / asset reference | Source: `"dark": "/assets/overlay-lockup-dark.svg",` |
| `docs/docs.json:16` | Metadata, font preload or native icon configuration | Source: `"favicon": "/assets/favicon.png",` |
| `overlay-desktop/electron-builder.yml:34` | Metadata, font preload or native icon configuration | Source: `- resources/**` |
| `overlay-desktop/electron-builder.yml:36` | Metadata, font preload or native icon configuration | Source: `extraResources:` |
| `overlay-desktop/electron-builder.yml:37` | Metadata, font preload or native icon configuration | Source: `- from: resources` |
| `overlay-desktop/electron-builder.yml:38` | Metadata, font preload or native icon configuration | Source: `to: resources` |
| `overlay-desktop/electron-builder.yml:52` | Metadata, font preload or native icon configuration | Source: `icon: resources/logos/logo-big.png` |
| `overlay-desktop/electron-builder.yml:60` | Metadata, font preload or native icon configuration | Source: `icon: resources/logos/logo-big.png` |
| `overlay-desktop/electron-builder.yml:76` | Metadata, font preload or native icon configuration | Source: `icon: resources/logos/logo-big.png` |
| `overlay-desktop/packages/overlay-app-core/src/app-shell.ts:33` | Logo image / metadata / asset reference | Source: `logoSrc: '/assets/overlay-logo.png',` |
| `overlay-desktop/packages/overlay-chat-core/src/constants.ts:5` | Logo image / metadata / asset reference | Source: `export const OVERLAY_LOGO_SRC = '/assets/overlay-logo.png'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/BrandMark.tsx:12` | Logo image / metadata / asset reference | Source: `<img src="/overlay-logo.png" alt="" className="h-full w-full object-cover" />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:6` | Desktop imported logo propagation / image rendering | Source: `const { toolLogoUrl } = useChatReactConfig()` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.tsx:11` | Desktop imported logo propagation / image rendering | Source: `src={toolLogoUrl ?? OVERLAY_LOGO_SRC}` |
| `overlay-desktop/packages/overlay-chat-react/src/context/chat-react-config.ts:9` | Logo image / metadata / asset reference | Source: `* the web-app defaults (e.g. '/overlay-logo.png').` |
| `overlay-desktop/packages/overlay-chat-react/src/context/chat-react-config.ts:14` | Logo image / metadata / asset reference | Source: `* Defaults to '/overlay-logo.png' (web app public asset).` |
| `overlay-desktop/packages/overlay-chat-react/src/context/chat-react-config.ts:16` | Desktop imported logo propagation / image rendering | Source: `toolLogoUrl?: string` |
| `overlay-desktop/packages/overlay-modules-react/src/notes/editor.tsx:1239` | Desktop imported logo propagation / image rendering | Source: `const overlayLogo = logo ?? <span className="overlay-stream-marker h-3.5 w-3.5" aria-hidden />` |
| `overlay-desktop/packages/overlay-modules-react/src/notes/editor.tsx:1287` | Desktop imported logo propagation / image rendering | Source: `logo={overlayLogo}` |
| `overlay-desktop/src/main/index.ts:872` | Logo image / metadata / asset reference | Source: `getResourcePath('logos/logo-big-no-bg-menu-tray-icon.png')` |
| `overlay-desktop/src/main/ipc/panel-ipc.ts:196` | Logo image / metadata / asset reference | Source: `icon: getResourcePath('icon.png'),` |
| `overlay-desktop/src/main/services/panel-manager.ts:716` | Logo image / metadata / asset reference | Source: `icon: getResourcePath('icon.png'),` |
| `overlay-desktop/src/main/services/window-manager.ts:55` | Logo image / metadata / asset reference | Source: `icon: getResourcePath('icon.png'),` |
| `overlay-desktop/src/main/services/window-manager.ts:197` | Logo image / metadata / asset reference | Source: `icon: getResourcePath('icon.png'),` |
| `overlay-desktop/src/main/services/window-manager.ts:319` | Logo image / metadata / asset reference | Source: `icon: getResourcePath('icon.png'),` |
| `overlay-desktop/src/renderer/src/components/chat/ChatInputArea.tsx:50` | Desktop imported logo propagation / image rendering | Source: `import overlayLogoUrl from '../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/chat/ChatInputArea.tsx:654` | Desktop imported logo propagation / image rendering | Source: `const scopeStyle = useMemo(() => panelThemeToSharedCssVars(theme, overlayLogoUrl), [theme])` |
| `overlay-desktop/src/renderer/src/components/chat/DesktopChatTranscript.tsx:25` | Desktop imported logo propagation / image rendering | Source: `import overlayLogoUrl from '../../../../../resources/logos/overlay-chat-mark.png'` |
| `overlay-desktop/src/renderer/src/components/chat/DesktopChatTranscript.tsx:56` | Desktop imported logo propagation / image rendering | Source: `const DESKTOP_CHAT_REACT_CONFIG = { toolLogoUrl: overlayLogoUrl }` |
| `overlay-desktop/src/renderer/src/components/chat/DesktopChatTranscript.tsx:109` | Desktop imported logo propagation / image rendering | Source: `const scopeStyle = useMemo(() => panelThemeToSharedCssVars(theme, overlayLogoUrl), [theme])` |
| `overlay-desktop/src/renderer/src/components/chat/DesktopSourcesPanel.tsx:7` | Desktop imported logo propagation / image rendering | Source: `import overlayLogoUrl from '../../../../../resources/logos/overlay-chat-mark.png'` |
| `overlay-desktop/src/renderer/src/components/chat/DesktopSourcesPanel.tsx:22` | Desktop imported logo propagation / image rendering | Source: `const scopeStyle = useMemo(() => panelThemeToSharedCssVars(theme, overlayLogoUrl), [theme])` |
| `overlay-desktop/src/renderer/src/components/chat/themeBridge.ts:46` | Logo image / metadata / asset reference | Source: `'--overlay-mark-logo-url': 'url(${logoUrl})',` |
| `overlay-desktop/src/renderer/src/components/notifications/NotificationPanel.tsx:4` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/notifications/NotificationPanel.tsx:123` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/AuthStep.tsx:10` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/AuthStep.tsx:103` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/GetStartedStep.tsx:4` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/GetStartedStep.tsx:29` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/IntegrationsSkillsStep.tsx:5` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/IntegrationsSkillsStep.tsx:162` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/NameStep.tsx:4` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/NameStep.tsx:50` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutAgentStep.tsx:11` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutAgentStep.tsx:44` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutBrowserStep.tsx:11` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutBrowserStep.tsx:44` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutChatStep.tsx:17` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutChatStep.tsx:74` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutNotebookStep.tsx:15` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutNotebookStep.tsx:50` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/TestTranscriptionStep.tsx:4` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/TestTranscriptionStep.tsx:82` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/WelcomeStep.tsx:4` | Desktop imported logo propagation / image rendering | Source: `import logoImage from '../../../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/WelcomeStep.tsx:30` | Desktop imported logo propagation / image rendering | Source: `src={logoImage}` |
| `overlay-desktop/src/renderer/src/features/notebook/DesktopNotebookEditor.tsx:24` | Desktop imported logo propagation / image rendering | Source: `import overlayLogoUrl from '../../../../../resources/logos/overlay-chat-mark.png'` |
| `overlay-desktop/src/renderer/src/features/notebook/DesktopNotebookEditor.tsx:169` | Desktop imported logo propagation / image rendering | Source: `style={panelThemeToSharedCssVars(theme, overlayLogoUrl)}` |
| `overlay-desktop/src/renderer/src/features/notebook/DesktopNotebookEditor.tsx:260` | Desktop imported logo propagation / image rendering | Source: `logo={<img src={overlayLogoUrl} alt="" className="mt-0.5 size-3.5 shrink-0 select-none" draggable={false} />}` |
| `overlay-desktop/src/renderer/src/pages/MainWindow.tsx:20` | Desktop imported logo propagation / image rendering | Source: `import overlayLogo from '../../../../resources/logos/logo-big-no-bg.png'` |
| `overlay-desktop/src/renderer/src/pages/MainWindow.tsx:770` | Desktop imported logo propagation / image rendering | Source: `src={overlayLogo}` |
| `overlay-desktop/src/renderer/src/pages/MainWindow.tsx:1149` | Desktop imported logo propagation / image rendering | Source: `src={overlayLogo}` |
| `overlay-desktop/src/renderer/src/pages/NotebookPanel.tsx:34` | Desktop imported logo propagation / image rendering | Source: `import overlayLogoUrl from '../../../../resources/logos/overlay-chat-mark.png'` |
| `overlay-desktop/src/renderer/src/pages/NotebookPanel.tsx:412` | Desktop imported logo propagation / image rendering | Source: `...panelThemeToSharedCssVars(theme, overlayLogoUrl),` |
| `packages/overlay-app-core/src/app-shell.ts:33` | Logo image / metadata / asset reference | Source: `logoSrc: '/assets/overlay-logo.png',` |
| `src/app/(marketing)/layout.tsx:25` | Logo image / metadata / asset reference | Source: `url: 'https://getoverlay.io/assets/overlay-logo.png',` |
| `src/app/layout.tsx:53` | Metadata, font preload or native icon configuration | Source: `icons: {` |
| `src/app/layout.tsx:54` | Metadata, font preload or native icon configuration | Source: `icon: [` |
| `src/app/layout.tsx:55` | Metadata, font preload or native icon configuration | Source: `{ url: "/icon.png", sizes: "64x64", type: "image/png" },` |
| `src/app/layout.tsx:68` | Logo image / metadata / asset reference | Source: `url: "https://getoverlay.io/assets/overlay-share-linkedin-thumb.png",` |
| `src/app/layout.tsx:80` | Logo image / metadata / asset reference | Source: `images: ["https://getoverlay.io/assets/overlay-share-linkedin-thumb.png"],` |
| `src/app/layout.tsx:96` | Metadata, font preload or native icon configuration | Source: `href="/assets/fonts/Libre_Baskerville/static/LibreBaskerville-Regular.ttf"` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:46` | Logo image / metadata / asset reference | Source: `const DEFAULT_BRAND_LOGO_SRC = '/assets/overlay-logo.png'` |
| `src/shared/email/lifecycle-email.ts:313` | Logo image / metadata / asset reference | Source: `const logoUrl = escapeHtml('${siteOrigin(originUrl)}/assets/overlay-logo.png')` |
| `src/app/share/c/[token]/twitter-image.tsx:1` | Twitter reuses branded OG renderer | Source: `import OpengraphImage from './opengraph-image'` |
| `src/app/share/c/[token]/twitter-image.tsx:7` | Twitter reuses branded OG renderer | Source: `export default OpengraphImage` |
| `src/app/share/f/[token]/twitter-image.tsx:1` | Twitter reuses branded OG renderer | Source: `import OpengraphImage from './opengraph-image'` |
| `src/app/share/f/[token]/twitter-image.tsx:7` | Twitter reuses branded OG renderer | Source: `export default OpengraphImage` |

### Wordmark text and wordmark callers

| file:line | what it renders | notes |
| --- | --- | --- |
| `apps/admin/src/app/denied/page.tsx:3` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { OperatorLockup } from '@/features/admin/OperatorLockup'` |
| `apps/admin/src/app/denied/page.tsx:9` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<OperatorLockup />` |
| `apps/admin/src/app/sign-in/page.tsx:3` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { OperatorLockup } from '@/features/admin/OperatorLockup'` |
| `apps/admin/src/app/sign-in/page.tsx:25` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<OperatorLockup />` |
| `apps/admin/src/features/admin/OperatorLockup.tsx:6` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `export function OperatorLockup() {` |
| `apps/admin/src/features/admin/OperatorLockup.tsx:14` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `docs/assets/overlay-lockup-dark.svg:1` | Mintlify SVG accessible brand label / vector wordmark | Lockups contain outlined glyph paths, not a reusable JSX wordmark; regenerate artwork. |
| `docs/assets/overlay-lockup-light.svg:1` | Mintlify SVG accessible brand label / vector wordmark | Lockups contain outlined glyph paths, not a reusable JSX wordmark; regenerate artwork. |
| `overlay-desktop/packages/overlay-app-core/src/app-shell.ts:31` | Rendered lowercase wordmark / brand label default | Source: `name: 'overlay',` |
| `overlay-desktop/packages/overlay-app-core/src/app-shell.ts:32` | Rendered lowercase wordmark / brand label default | Source: `shortName: 'overlay',` |
| `overlay-desktop/packages/overlay-chat-react/src/components/BrandMark.tsx:20` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `overlay-desktop/src/renderer/index.html:5` | Rendered lowercase wordmark / brand label default | Source: `<title>overlay</title>` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/AccessibilityStep.tsx:68` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/MicrophoneStep.tsx:88` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/PermissionsStep.tsx:224` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/ShortcutAgentStep.tsx:75` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/SystemEventsStep.tsx:72` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `overlay-desktop/src/renderer/src/components/onboarding/steps/WelcomeStep.tsx:57` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `overlay-desktop/src/renderer/src/components/settings/AccountSettings.tsx:1045` | Rendered lowercase wordmark / brand label default | Source: `<span style={{ fontFamily: "'Libre Baskerville', Georgia, serif" }}>overlay</span> v` |
| `overlay-desktop/src/renderer/src/pages/MainWindow.tsx:775` | Rendered lowercase wordmark / brand label default | Source: `<span style={labelStyle(theme.text)}>overlay</span>` |
| `overlay-desktop/src/renderer/src/pages/MainWindow.tsx:1168` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `packages/overlay-app-core/src/app-shell.ts:31` | Rendered lowercase wordmark / brand label default | Source: `name: 'overlay',` |
| `packages/overlay-app-core/src/app-shell.ts:32` | Rendered lowercase wordmark / brand label default | Source: `shortName: 'overlay',` |
| `packages/overlay-chat-react/src/components/BrandMark.tsx:24` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `src/app/_components/onboarding/OnboardingIntro.tsx:4` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/app/_components/onboarding/OnboardingIntro.tsx:18` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup className={styles.introLockup} />` |
| `src/app/_components/RouteLoadingFallbacks.tsx:1` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/app/_components/RouteLoadingFallbacks.tsx:48` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup style={{ fontSize: 20 }} />` |
| `src/app/_components/RouteLoadingFallbacks.tsx:63` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup style={{ fontSize: 20 }} />` |
| `src/app/app/account/account-content.tsx:9` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/app/app/account/account-content.tsx:30` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<header className="flex items-center justify-between px-6 py-6 sm:px-10"><BrandLockup className="text-2xl" /><Button asChild variant="ghost" size="sm"><Link href="/app/work"><ArrowLeft className="size-4" />Back to app</Link></Button></header>` |
| `src/app/auth/_components/AuthPageChrome.tsx:7` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/app/auth/_components/AuthPageChrome.tsx:13` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup style={{ fontSize: 20 }} />` |
| `src/app/share/c/[token]/opengraph-image.tsx:53-84` | OG route hand-built rounded-square lowercase o and lowercase overlay (not Orb) | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `src/app/share/c/[token]/opengraph-image.tsx:72` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `src/app/share/f/[token]/opengraph-image.tsx:66-97` | OG route hand-built rounded-square lowercase o and lowercase overlay (not Orb) | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `src/app/share/f/[token]/opengraph-image.tsx:84` | Rendered lowercase wordmark / brand label default | Source: `overlay` |
| `src/components/brand/BrandLockup.tsx:16` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `export function BrandLockup({ className = '', ...rest }: HTMLAttributes<HTMLSpanElement>) {` |
| `src/components/brand/BrandLockup.tsx:23` | Rendered lowercase wordmark / brand label default | Source: `<span className="brand-lockup-word">overlay</span>` |
| `src/components/layout/AppBootLoader.tsx:5` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/components/layout/AppBootLoader.tsx:41` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup className="app-brand-loader-lockup" />` |
| `src/components/layout/AppSidebar.tsx:56` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<SidebarBrandLink` |
| `src/components/layout/AppSidebar.tsx:149` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<SidebarBrandLink` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:87` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0" />` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:89` | Rendered lowercase wordmark / brand label default | Source: `{label}` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:123` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0 group-hover:hidden" />` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:136` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandMark logoSrc={logoSrc} logoAlt={logoAlt} size={10} className="shrink-0" />` |
| `src/components/layout/sidebar/AppSidebarChrome.tsx:141` | Rendered lowercase wordmark / brand label default | Source: `{label}` |
| `src/features/marketing/components/MarketingFooter.tsx:5` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from "@/components/brand/BrandLockup";` |
| `src/features/marketing/components/MarketingFooter.tsx:74` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup style={{ fontSize: 18 }} />` |
| `src/features/marketing/landing/LandingNav.tsx:9` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/features/marketing/landing/LandingNav.tsx:27` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup />` |
| `src/features/marketing/landing/LandingProductShot.tsx:2` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/features/marketing/landing/LandingProductShot.tsx:44` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup />` |
| `src/features/share/components/ShareDialog.tsx:140` | Rendered lowercase wordmark / brand label default | Source: `<div className="text-base font-medium tracking-tight">overlay</div>` |
| `src/features/workspaces/components/WorkspaceDirectory.tsx:8` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `import { BrandLockup } from '@/components/brand/BrandLockup'` |
| `src/features/workspaces/components/WorkspaceDirectory.tsx:83` | Canonical wordmark dependency (capitalization centralized in BrandLockup/OperatorLockup) | Source: `<BrandLockup className="text-2xl" />` |
| `src/shared/email/lifecycle-email.ts:337` | Rendered lowercase wordmark / brand label default | Source: `<span style="line-height:1;"><img src="${logoUrl}" width="12" height="12" alt="" style="display:inline-block;vertical-align:middle;border:0;"><span style="font-family:${SERIF};font-size:20px;font-weight:500;letter-spacing:-0.02em;color:#0a0a0a;padding-left:8px;vertical-align:middle;">overlay</span></span>` |
| `src/components/layout/AppSidebar.tsx:53` | Sidebar configured brand label / classic rail caller | Source: `const brandLabel = s.brandConfig.shortName ?? s.brandConfig.name` |
| `src/components/layout/AppSidebar.tsx:60` | Sidebar configured brand label / classic rail caller | Source: `label={brandLabel}` |
| `src/components/layout/AppSidebar.tsx:153` | Sidebar configured brand label / classic rail caller | Source: `label={brandLabel}` |
| `src/components/layout/AppSidebar.tsx:206` | Sidebar configured brand label / classic rail caller | Source: `<SidebarRailBrand` |
| `src/components/layout/AppSidebar.tsx:209` | Sidebar configured brand label / classic rail caller | Source: `logoSrc={s.brandConfig.logoSrc}` |
| `src/components/layout/AppSidebar.tsx:211` | Sidebar configured brand label / classic rail caller | Source: `label={brandLabel}` |
| `apps/admin/src/features/admin/OperatorLockup.tsx:11` | CSS lowercase forces wordmark casing | Source: `className="text-lg font-medium lowercase tracking-tight text-(--foreground)"` |
| `src/app/share/c/[token]/opengraph-image.tsx:69` | OG lowercase o emblem | Source: `o` |
| `src/app/share/f/[token]/opengraph-image.tsx:81` | OG lowercase o emblem | Source: `o` |

### Related styling and motion

| file:line | what it renders | notes |
| --- | --- | --- |
| `docs/style.css:50` | Mark geometry, pulse or animation styling | Source: `sets the wordmark at the landing nav's 22px. */` |
| `docs/style.css:51` | Mintlify logo height | Source: `#navbar .nav-logo {` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:387-415` | Desktop stream pulse keyframes; verify range before editing | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:388` | Mark geometry, pulse or animation styling | Source: `@keyframes overlayChatStreamMarkerPulse {` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:402` | Mark geometry, pulse or animation styling | Source: `@keyframes overlayChatStreamMarkerReducedPulse {` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:450` | Mark geometry, pulse or animation styling | Source: `animation: overlayChatStreamMarkerPulse 1.3s ease-in-out infinite;` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:453` | Mark geometry, pulse or animation styling | Source: `:where(.overlay-chat-surface) .overlay-stream-marker {` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:459` | Mark geometry, pulse or animation styling | Source: `background-image: var(--overlay-mark-logo-url, none);` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:463` | Mark geometry, pulse or animation styling | Source: `animation: overlayChatStreamMarkerPulse 1.3s ease-in-out infinite;` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:469` | Mark geometry, pulse or animation styling | Source: `:where(.overlay-chat-surface) .overlay-stream-marker--standalone,` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:473` | Mark geometry, pulse or animation styling | Source: `> .overlay-stream-marker:only-child,` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:476` | Mark geometry, pulse or animation styling | Source: `> .overlay-stream-marker:only-child {` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:541` | Mark geometry, pulse or animation styling | Source: `.overlay-stream-marker {` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:542` | Mark geometry, pulse or animation styling | Source: `animation: overlayChatStreamMarkerPulse 1.3s ease-in-out infinite;` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:729` | Mark geometry, pulse or animation styling | Source: `:where(.overlay-chat-surface) .overlay-stream-marker,` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:733` | Mark geometry, pulse or animation styling | Source: `.overlay-stream-marker {` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/chat-surface.css:734` | Mark geometry, pulse or animation styling | Source: `animation: overlayChatStreamMarkerReducedPulse 1.8s ease-in-out infinite;` |
| `overlay-desktop/packages/overlay-chat-react/src/styles/overlay-theme.css:39` | Mark geometry, pulse or animation styling | Source: `--overlay-mark-logo-url: url("/overlay-logo.png");` |
| `overlay-desktop/src/renderer/src/styles/shared-chat.css:123` | Mark geometry, pulse or animation styling | Source: `* --overlay-mark-logo-url. Point it to the desktop's bundled logo asset.` |
| `overlay-desktop/src/renderer/src/styles/shared-chat.css:127` | Mark geometry, pulse or animation styling | Source: `--overlay-mark-logo-url: var(--desktop-overlay-logo-url, url(''));` |
| `packages/overlay-chat-react/src/styles/chat-surface.css:270` | Mark geometry, pulse or animation styling | Source: `@keyframes overlayChatStreamMarkerPulse {` |
| `packages/overlay-chat-react/src/styles/chat-surface.css:270-294` | Stream pulse and reduced pulse keyframes | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `packages/overlay-chat-react/src/styles/chat-surface.css:282` | Mark geometry, pulse or animation styling | Source: `@keyframes overlayChatStreamMarkerReducedPulse {` |
| `packages/overlay-chat-react/src/styles/chat-surface.css:333` | Mark geometry, pulse or animation styling | Source: `animation: overlayChatStreamMarkerPulse 1.3s ease-in-out infinite;` |
| `packages/overlay-chat-react/src/styles/chat-surface.css:336` | Mark geometry, pulse or animation styling | Source: `:where(.overlay-chat-surface) .overlay-stream-marker {` |
| `packages/overlay-chat-react/src/styles/chat-surface.css:344` | Mark geometry, pulse or animation styling | Source: `animation: overlayChatStreamMarkerPulse 1.3s ease-in-out infinite;` |
| `packages/overlay-chat-react/src/styles/chat-surface.css:350` | Mark geometry, pulse or animation styling | Source: `:where(.overlay-chat-surface) .overlay-stream-marker--standalone {` |
| `packages/overlay-chat-react/src/styles/chat-surface.css:537` | Mark geometry, pulse or animation styling | Source: `:where(.overlay-chat-surface) .overlay-stream-marker,` |
| `packages/overlay-chat-react/src/styles/chat-surface.css:539` | Mark geometry, pulse or animation styling | Source: `animation: overlayChatStreamMarkerReducedPulse 1.8s ease-in-out infinite;` |
| `packages/overlay-ui/src/styles.css:244-325` | ovorb-root/sheen/spin/drift/breathe/dim and reduced motion | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `packages/overlay-ui/src/styles.css:246` | Mark geometry, pulse or animation styling | Source: `.ovorb-root {` |
| `packages/overlay-ui/src/styles.css:254` | Mark geometry, pulse or animation styling | Source: `.ovorb-root > svg {` |
| `packages/overlay-ui/src/styles.css:258` | Mark geometry, pulse or animation styling | Source: `.ovorb-sheen {` |
| `packages/overlay-ui/src/styles.css:275` | Mark geometry, pulse or animation styling | Source: `.ovorb-spin .ovorb-sheen {` |
| `packages/overlay-ui/src/styles.css:277` | Mark geometry, pulse or animation styling | Source: `animation: ovorb-rotate 7s linear infinite;` |
| `packages/overlay-ui/src/styles.css:280` | Mark geometry, pulse or animation styling | Source: `.ovorb-drift .ovorb-sheen {` |
| `packages/overlay-ui/src/styles.css:282` | Mark geometry, pulse or animation styling | Source: `animation: ovorb-rotate 26s linear infinite;` |
| `packages/overlay-ui/src/styles.css:285` | Mark geometry, pulse or animation styling | Source: `.ovorb-breathe {` |
| `packages/overlay-ui/src/styles.css:286` | Mark geometry, pulse or animation styling | Source: `animation: ovorb-breathe 3.4s ease-in-out infinite;` |
| `packages/overlay-ui/src/styles.css:289` | Mark geometry, pulse or animation styling | Source: `.ovorb-breathe .ovorb-sheen {` |
| `packages/overlay-ui/src/styles.css:291` | Mark geometry, pulse or animation styling | Source: `animation: ovorb-rotate 14s linear infinite;` |
| `packages/overlay-ui/src/styles.css:294` | Mark geometry, pulse or animation styling | Source: `.ovorb-dim {` |
| `packages/overlay-ui/src/styles.css:298` | Mark geometry, pulse or animation styling | Source: `@keyframes ovorb-rotate {` |
| `packages/overlay-ui/src/styles.css:304` | Mark geometry, pulse or animation styling | Source: `@keyframes ovorb-breathe {` |
| `packages/overlay-ui/src/styles.css:315` | Mark geometry, pulse or animation styling | Source: `.ovorb-spin .ovorb-sheen,` |
| `packages/overlay-ui/src/styles.css:316` | Mark geometry, pulse or animation styling | Source: `.ovorb-drift .ovorb-sheen,` |
| `packages/overlay-ui/src/styles.css:317` | Mark geometry, pulse or animation styling | Source: `.ovorb-breathe .ovorb-sheen {` |
| `packages/overlay-ui/src/styles.css:321` | Mark geometry, pulse or animation styling | Source: `.ovorb-breathe {` |
| `src/app/globals.css:164` | Mark geometry, pulse or animation styling | Source: `/* Canonical Overlay lockup: the orb resting on the wordmark's text baseline.` |
| `src/app/globals.css:164-303` | Canonical brand geometry, boot fade/reveal/pulse and reduced motion | Range entry includes surrounding styling/control context; exact matching lines are also listed where present. |
| `src/app/globals.css:166` | Mark geometry, pulse or animation styling | Source: `lockup's size is set by font-size on .brand-lockup or an ancestor. */` |
| `src/app/globals.css:167` | Mark geometry, pulse or animation styling | Source: `.brand-lockup {` |
| `src/app/globals.css:177` | Mark geometry, pulse or animation styling | Source: `.brand-lockup-orb {` |
| `src/app/globals.css:184` | Mark geometry, pulse or animation styling | Source: `/* !important beats OverlayMark's inline width/height (same as .lp .orb). */` |
| `src/app/globals.css:185` | Mark geometry, pulse or animation styling | Source: `.brand-lockup-orb > span,` |
| `src/app/globals.css:186` | Mark geometry, pulse or animation styling | Source: `.brand-lockup-orb svg {` |
| `src/app/globals.css:192` | Mark geometry, pulse or animation styling | Source: `.brand-lockup-mask {` |
| `src/app/globals.css:199` | Mark geometry, pulse or animation styling | Source: `.brand-lockup-word {` |
| `src/app/globals.css:203` | Mark geometry, pulse or animation styling | Source: `@keyframes appBrandLogoFade {` |
| `src/app/globals.css:214` | Mark geometry, pulse or animation styling | Source: `@keyframes appBrandWordReveal {` |
| `src/app/globals.css:229` | Mark geometry, pulse or animation styling | Source: `@keyframes appBrandLoaderPulse {` |
| `src/app/globals.css:239` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-pulse {` |
| `src/app/globals.css:240` | Mark geometry, pulse or animation styling | Source: `animation: appBrandLoaderPulse 1.4s ease-in-out 800ms infinite;` |
| `src/app/globals.css:244` | Mark geometry, pulse or animation styling | Source: `@keyframes appBrandWslineFade {` |
| `src/app/globals.css:255` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-wsline {` |
| `src/app/globals.css:257` | Mark geometry, pulse or animation styling | Source: `animation: appBrandWslineFade 420ms ease-out 560ms forwards;` |
| `src/app/globals.css:263` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-lockup {` |
| `src/app/globals.css:267` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-lockup .brand-lockup-orb {` |
| `src/app/globals.css:271` | Mark geometry, pulse or animation styling | Source: `animation: appBrandLogoFade 360ms ease-out both;` |
| `src/app/globals.css:274` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-lockup .brand-lockup-word {` |
| `src/app/globals.css:280` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader--steady .brand-lockup-orb,` |
| `src/app/globals.css:281` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader--steady .brand-lockup-word,` |
| `src/app/globals.css:282` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader--steady .app-brand-loader-wsline {` |
| `src/app/globals.css:286` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader--steady .app-brand-loader-wsline {` |
| `src/app/globals.css:291` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-pulse,` |
| `src/app/globals.css:292` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-wsline .animate-spin {` |
| `src/app/globals.css:296` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-lockup .brand-lockup-orb,` |
| `src/app/globals.css:297` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-lockup .brand-lockup-word,` |
| `src/app/globals.css:298` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-wsline {` |
| `src/app/globals.css:302` | Mark geometry, pulse or animation styling | Source: `.app-brand-loader-wsline {` |
| `src/app/globals.css:498` | Mark geometry, pulse or animation styling | Source: `/* Gradient orb animation */` |
| `src/app/globals.css:499` | Mark geometry, pulse or animation styling | Source: `@keyframes float {` |
| `src/app/globals.css:508` | Mark geometry, pulse or animation styling | Source: `@keyframes pulse-glow {` |
| `src/app/globals.css:517` | Mark geometry, pulse or animation styling | Source: `.animate-float {` |
| `src/app/globals.css:521` | Mark geometry, pulse or animation styling | Source: `.animate-pulse-glow {` |
| `src/app/globals.css:522` | Mark geometry, pulse or animation styling | Source: `animation: pulse-glow 4s ease-in-out infinite;` |
| `src/app/globals.css:526` | Mark geometry, pulse or animation styling | Source: `.animate-float,` |
| `src/app/globals.css:527` | Mark geometry, pulse or animation styling | Source: `.animate-pulse-glow {` |
| `src/components/orb/Creature.module.css:1` | Creature eye blink / motion behavior (potential reuse) | Source: `.eyes {` |
| `src/components/orb/Creature.module.css:2` | Creature eye blink / motion behavior (potential reuse) | Source: `transform-box: fill-box;` |
| `src/components/orb/Creature.module.css:3` | Creature eye blink / motion behavior (potential reuse) | Source: `transform-origin: center;` |
| `src/components/orb/Creature.module.css:4` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:6` | Creature eye blink / motion behavior (potential reuse) | Source: `.blink .eyes {` |
| `src/components/orb/Creature.module.css:7` | Creature eye blink / motion behavior (potential reuse) | Source: `animation: creature-blink 5.4s ease-in-out infinite;` |
| `src/components/orb/Creature.module.css:8` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:10` | Creature eye blink / motion behavior (potential reuse) | Source: `/* Theme-adaptive body: the wrapper sets --cwf/--cwf-dark from the agent` |
| `src/components/orb/Creature.module.css:11` | Creature eye blink / motion behavior (potential reuse) | Source: `color and the document theme picks which fill wins. */` |
| `src/components/orb/Creature.module.css:12` | Creature eye blink / motion behavior (potential reuse) | Source: `.bodyWrap {` |
| `src/components/orb/Creature.module.css:13` | Creature eye blink / motion behavior (potential reuse) | Source: `color: var(--cwf);` |
| `src/components/orb/Creature.module.css:14` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:15` | Creature eye blink / motion behavior (potential reuse) | Source: `:root[data-theme='dark'] .bodyWrap,` |
| `src/components/orb/Creature.module.css:16` | Creature eye blink / motion behavior (potential reuse) | Source: `[data-landing-theme='dark'] .bodyWrap {` |
| `src/components/orb/Creature.module.css:17` | Creature eye blink / motion behavior (potential reuse) | Source: `color: var(--cwf-dark);` |
| `src/components/orb/Creature.module.css:18` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:20` | Creature eye blink / motion behavior (potential reuse) | Source: `@keyframes creature-blink {` |
| `src/components/orb/Creature.module.css:21` | Creature eye blink / motion behavior (potential reuse) | Source: `0%,` |
| `src/components/orb/Creature.module.css:22` | Creature eye blink / motion behavior (potential reuse) | Source: `91% {` |
| `src/components/orb/Creature.module.css:23` | Creature eye blink / motion behavior (potential reuse) | Source: `transform: scaleY(1);` |
| `src/components/orb/Creature.module.css:24` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:25` | Creature eye blink / motion behavior (potential reuse) | Source: `93.5%,` |
| `src/components/orb/Creature.module.css:26` | Creature eye blink / motion behavior (potential reuse) | Source: `95.5% {` |
| `src/components/orb/Creature.module.css:27` | Creature eye blink / motion behavior (potential reuse) | Source: `transform: scaleY(0.1);` |
| `src/components/orb/Creature.module.css:28` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:29` | Creature eye blink / motion behavior (potential reuse) | Source: `98%,` |
| `src/components/orb/Creature.module.css:30` | Creature eye blink / motion behavior (potential reuse) | Source: `100% {` |
| `src/components/orb/Creature.module.css:31` | Creature eye blink / motion behavior (potential reuse) | Source: `transform: scaleY(1);` |
| `src/components/orb/Creature.module.css:32` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:33` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:35` | Creature eye blink / motion behavior (potential reuse) | Source: `@media (prefers-reduced-motion: reduce) {` |
| `src/components/orb/Creature.module.css:36` | Creature eye blink / motion behavior (potential reuse) | Source: `.blink .eyes {` |
| `src/components/orb/Creature.module.css:37` | Creature eye blink / motion behavior (potential reuse) | Source: `animation: none;` |
| `src/components/orb/Creature.module.css:38` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/components/orb/Creature.module.css:39` | Creature eye blink / motion behavior (potential reuse) | Source: `}` |
| `src/features/marketing/landing/landing.css:95` | Mark geometry, pulse or animation styling | Source: `.sl .sb-top > .brand-lockup { font-size: 17px; margin-right: auto; color: var(--sl-text); }` |
| `src/app/globals.css:63` | Libre Baskerville font / serif variable | Source: `}` |
| `src/app/globals.css:70` | Libre Baskerville font / serif variable | Source: `font-display: swap;` |
| `src/app/globals.css:77` | Libre Baskerville font / serif variable | Source: `font-style: italic;` |
| `src/app/globals.css:84` | Libre Baskerville font / serif variable | Source: `font-weight: 700;` |
| `src/app/globals.css:111` | Libre Baskerville font / serif variable | Source: `--accent: #0a0a0a;` |
| `src/app/globals.css:112` | Libre Baskerville font / serif variable | Source: `--skill: #751ed9;` |
| `packages/overlay-ui/src/styles.css:244` | Mark / avatar policy or styling dependency | Source: `/* Overlay orb mark (components/orb/Orb.tsx). The SVG artwork is inline; these` |

### Tests and snapshots

| file:line | what it renders | notes |
| --- | --- | --- |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.test.tsx:7` | Mark/lockup/motion assertion or test dependency | Source: `import { ToolLineLogo } from './tool-rail'` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.test.tsx:11` | Mark/lockup/motion assertion or test dependency | Source: `<ChatReactConfigContext.Provider value={{ toolLogoUrl: 'app://overlay-logo.png' }}>` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.test.tsx:12` | Mark/lockup/motion assertion or test dependency | Source: `<ToolLineLogo />` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.test.tsx:16` | Mark/lockup/motion assertion or test dependency | Source: `assert.match(markup, /src="app:\/\/overlay-logo\.png"/)` |
| `overlay-desktop/packages/overlay-chat-react/src/components/exchange/tool-rail.test.tsx:23` | Mark/lockup/motion assertion or test dependency | Source: `const markup = renderToStaticMarkup(<ToolLineLogo />)` |
| `overlay-desktop/packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.test.tsx:68` | Mark/lockup/motion assertion or test dependency | Source: `assert.match(markup, /overlay-stream-marker--standalone/)` |
| `packages/overlay-chat-react/src/components/ai-elements/confirmation.test.tsx:17` | Mark/lockup/motion assertion or test dependency | Source: `test('approval card is flat, uses the Orb, and lists Approve before Deny', () => {` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.test.tsx:5` | Mark/lockup/motion assertion or test dependency | Source: `import { ToolLineLogo } from './tool-rail'` |
| `packages/overlay-chat-react/src/components/exchange/tool-rail.test.tsx:8` | Mark/lockup/motion assertion or test dependency | Source: `const markup = renderToStaticMarkup(<ToolLineLogo />)` |
| `packages/overlay-chat-react/src/components/transcript/ExchangeLoadingState.test.tsx:68` | Mark/lockup/motion assertion or test dependency | Source: `assert.match(markup, /overlay-stream-marker--standalone/)` |
| `src/app/app/_components/AppRouteSkeletons.test.tsx:22` | Mark/lockup/motion assertion or test dependency | Source: `assert.equal(markup.includes('brand-lockup-word'), true)` |
| `src/components/layout/boot-loader-pulse.test.ts:3` | Mark/lockup/motion assertion or test dependency | Source: `import { createBootAppShownFlag, createBootEntranceClaim, createBootLoaderPulseClock } from './boot-loader-pulse'` |
| `src/components/layout/boot-loader-pulse.test.ts:6` | Mark/lockup/motion assertion or test dependency | Source: `const synchronize = createBootLoaderPulseClock()` |
| `src/components/layout/boot-loader-pulse.test.ts:16` | Mark/lockup/motion assertion or test dependency | Source: `const synchronize = createBootLoaderPulseClock()` |
| `src/features/chat/components/collaboration/RoomMessageItem.test.tsx:426` | Mark/lockup/motion assertion or test dependency | Source: `assert.ok(!html.includes('overlay-stream-marker'))` |
| `src/server/agents/WorkspaceAgentService.test.ts:38` | Default agent / creature identity coverage | Source: `avatarColor: '#2563eb',` |
| `src/server/agents/WorkspaceAgentService.test.ts:57` | Default agent / creature identity coverage | Source: `isDefault: true,` |
| `src/server/agents/WorkspaceAgentService.test.ts:131` | Default agent / creature identity coverage | Source: `avatarColor: input.avatarColor,` |
| `src/server/agents/WorkspaceAgentService.test.ts:132` | Default agent / creature identity coverage | Source: `avatarShape: input.avatarShape,` |
| `src/server/agents/WorkspaceAgentService.test.ts:460` | Default agent / creature identity coverage | Source: `input: { name: 'Shaped', instructions: 'Help everyone.', modelId: 'test-model', avatarShape: 'droplet' },` |
| `src/server/agents/WorkspaceAgentService.test.ts:462` | Default agent / creature identity coverage | Source: `assert.equal(shaped.avatarShape, 'droplet')` |
| `src/server/agents/WorkspaceAgentService.test.ts:463` | Default agent / creature identity coverage | Source: `assert.equal(created[0]?.avatarShape, 'droplet')` |
| `src/server/agents/WorkspaceAgentService.test.ts:467` | Default agent / creature identity coverage | Source: `input: { name: 'Bogus', instructions: 'Help everyone.', modelId: 'test-model', avatarShape: 'dragon' as never },` |
| `src/server/agents/WorkspaceAgentService.test.ts:479` | Default agent / creature identity coverage | Source: `input: { avatarShape: 'cloud' },` |
| `src/server/agents/WorkspaceAgentService.test.ts:481` | Default agent / creature identity coverage | Source: `assert.equal(agent.avatarShape, 'cloud')` |
| `src/server/agents/WorkspaceAgentService.test.ts:482` | Default agent / creature identity coverage | Source: `assert.equal(updated[0]?.avatarShape, 'cloud')` |
| `src/server/agents/WorkspaceAgentService.test.ts:498` | Default agent / creature identity coverage | Source: `test('the default master agent is workspace-visible', async () => {` |
| `src/server/agents/WorkspaceAgentService.test.ts:501` | Default agent / creature identity coverage | Source: `const master = created.find((input) => input.isDefault)` |
| `src/server/agents/WorkspaceAgentService.test.ts:502` | Default agent / creature identity coverage | Source: `assert.ok(master)` |
| `src/server/agents/WorkspaceAgentService.test.ts:503` | Default agent / creature identity coverage | Source: `assert.equal(master.visibility, 'workspace')` |
| `src/server/agents/WorkspaceAgentService.test.ts:592` | Default agent / creature identity coverage | Source: `test('deleteArchived refuses a live agent, the default agent and someone else\'s agent', async () => {` |
| `src/server/agents/WorkspaceAgentService.test.ts:604` | Default agent / creature identity coverage | Source: `const isDefault = await serviceError(admin.service.deleteArchived({ actorUserId: 'user-admin', workspaceId: WORKSPACE_ID, agentId: 'agent-default' }))` |
| `src/server/agents/WorkspaceAgentService.test.ts:605` | Default agent / creature identity coverage | Source: `assert.equal(isDefault.code, 'forbidden')` |
| `src/shared/agents/agent-creature.test.ts:1` | Default agent / creature identity coverage | Source: `import assert from 'node:assert/strict'` |
| `src/shared/agents/agent-creature.test.ts:10` | Default agent / creature identity coverage | Source: `test('parses six- and three-digit hex colors', () => {` |
| `src/shared/agents/agent-creature.test.ts:11` | Default agent / creature identity coverage | Source: `assert.deepEqual(hexToRgb('#2563eb'), { r: 37, g: 99, b: 235 })` |
| `src/shared/agents/agent-creature.test.ts:12` | Default agent / creature identity coverage | Source: `assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 })` |
| `src/shared/agents/agent-creature.test.ts:13` | Default agent / creature identity coverage | Source: `assert.equal(hexToRgb('not-a-color'), null)` |
| `src/shared/agents/agent-creature.test.ts:14` | Default agent / creature identity coverage | Source: `assert.equal(hexToRgb('#12345'), null)` |
| `src/shared/agents/agent-creature.test.ts:17` | Default agent / creature identity coverage | Source: `test('picks dark eyes for light bodies and light eyes for dark bodies', () => {` |
| `src/shared/agents/agent-creature.test.ts:18` | Default agent / creature identity coverage | Source: `assert.equal(creatureEyeColor('#ffffff'), '#1c1917')` |
| `src/shared/agents/agent-creature.test.ts:19` | Default agent / creature identity coverage | Source: `assert.equal(creatureEyeColor('#fbbf24'), '#1c1917')` |
| `src/shared/agents/agent-creature.test.ts:20` | Default agent / creature identity coverage | Source: `assert.equal(creatureEyeColor('#18181b'), '#fafaf9')` |
| `src/shared/agents/agent-creature.test.ts:21` | Default agent / creature identity coverage | Source: `assert.equal(creatureEyeColor('#2563eb'), '#fafaf9')` |
| `src/shared/agents/agent-creature.test.ts:22` | Default agent / creature identity coverage | Source: `assert.equal(creatureEyeColor('bogus'), '#1c1917')` |
| `src/shared/agents/agent-creature.test.ts:25` | Default agent / creature identity coverage | Source: `test('normalizes unknown shapes to the circle body', () => {` |
| `src/shared/agents/agent-creature.test.ts:26` | Default agent / creature identity coverage | Source: `assert.equal(normalizeCreatureShape('droplet'), 'droplet')` |
| `src/shared/agents/agent-creature.test.ts:27` | Default agent / creature identity coverage | Source: `assert.equal(normalizeCreatureShape('cloud'), 'cloud')` |
| `src/shared/agents/agent-creature.test.ts:28` | Default agent / creature identity coverage | Source: `assert.equal(normalizeCreatureShape('dragon'), 'circle')` |
| `src/shared/agents/agent-creature.test.ts:29` | Default agent / creature identity coverage | Source: `assert.equal(normalizeCreatureShape(undefined), 'circle')` |
| `src/shared/agents/agent-creature.test.ts:30` | Default agent / creature identity coverage | Source: `assert.equal(normalizeCreatureShape(''), 'circle')` |
| `src/shared/agents/agent-creature.test.ts:33` | Default agent / creature identity coverage | Source: `test('adapts extreme bodies per theme and leaves mid-tones alone', () => {` |
| `src/shared/agents/agent-creature.test.ts:34` | Default agent / creature identity coverage | Source: `assert.deepEqual(themeCreatureFills('#2563eb'), { light: '#2563eb', dark: '#2563eb' })` |
| `src/shared/agents/agent-creature.test.ts:36` | Default agent / creature identity coverage | Source: `assert.equal(dark.light, '#18181b')` |
| `src/shared/agents/agent-creature.test.ts:37` | Default agent / creature identity coverage | Source: `assert.notEqual(dark.dark, '#18181b')` |
| `src/shared/agents/agent-creature.test.ts:39` | Default agent / creature identity coverage | Source: `assert.equal(light.dark, '#e4e4e7')` |
| `src/shared/agents/agent-creature.test.ts:40` | Default agent / creature identity coverage | Source: `assert.notEqual(light.light, '#e4e4e7')` |
| `src/shared/agents/agent-creature.test.ts:41` | Default agent / creature identity coverage | Source: `assert.deepEqual(themeCreatureFills('bogus'), { light: 'bogus', dark: 'bogus' })` |
| `src/shared/email/lifecycle-email.test.ts:17` | Mark/lockup/motion assertion or test dependency | Source: `assert.match(email.html, /https:\/\/www\.getoverlay\.io\/assets\/overlay-logo\.png/)` |

### Documentation, rules and historical references

| file:line | what it renders | notes |
| --- | --- | --- |
| `AGENTS.md:21` | Brand/mark guidance or history | Source: `- The Overlay logo must always render as the inline SVG 'OverlayMark' (from '@/components/orb/Orb', re-exported from '@overlay/ui'): never '/assets/overlay-logo.png' or other raster files. The canonical lockup is 'BrandLockup' ('src/components/brand/BrandLockup.tsx'): 'OverlayMark' at '0.5em' resting on the text baseline with a '0.4em' gap beside the serif "overlay" wordmark, sized via 'font-size': matching the landing page header exactly; keep every surface consistent with it. The PNG remains only where SVG cannot render (email markup in 'src/shared/email/lifecycle-email.ts') and as the white-label sentinel value in 'DEFAULT_OVERLAY_BRAND_CONFIG'/'AppSidebar' 'BrandMark', which routes the default to 'OverlayMark' anyway. Custom white-label 'logoSrc' overrides still render their configured image.` |
| `AGENTS.md:24` | Brand/mark guidance or history | Source: `- Agent identity is always the creature avatar ('AgentCreature' / 'Creature' in 'src/components/orb/Creature.tsx': 'avatarShape' body + 'avatarColor' + eyes): in the app, marketing pages and mockups. Never represent an agent with an orb (metal or glow); the orb is reserved for the Overlay brand mark and system markers (tool rails, thinking/loading rows).` |
| `AGENTS.md:27` | Brand/mark guidance or history | Source: `- Whenever the metallic Overlay Orb appears alongside text, preserve the sidebar header lockup ratio: the mark is '0.5em' relative to the adjacent text, with a '0.4em' gap. This applies to tool-call summaries and individual tool rows too, not just the wordmark. Tool-call rows vertically center the mark beside the label, including wrapped labels; do not copy the serif wordmark's baseline alignment into tool rows. Standalone marks and creature avatars are separate from this text-lockup rule.` |
| `CHANGELOG.md:148` | Brand/mark guidance or history | Source: `- Make the docs logo and favicon match the web app: the lockup SVGs follow 'BrandLockup' (orb 0.5em on the baseline, 0.4em gap, Libre Baskerville Medium at -0.025em, drawn as outlines so no font fallback) at the landing nav's 22px, and the favicon is the app's own icon instead of a full-bleed orb.` |
| `CHANGELOG.md:174` | Brand/mark guidance or history | Source: `- Make the '/home' app still look like the real workspace: the live sidebar (Personal/Workspace, Work, Agents, Chats, Automations, More, Needs you / Assigned to me / Everything), no header rules, an Operations agent planning a team offsite with the orb "Worked for" tool row, and its computer streaming a browser that fills in a venue form. The FAQ now uses a new shadcn 'Accordion' in '@overlay/ui/primitives', and the marketing footer keeps two or four link columns on narrow screens instead of one long column.` |
| `CHANGELOG.md:228` | Brand/mark guidance or history | Source: `- Make both sidebar edges resizable, keep native agent text visible between tool calls while it streams, preserve its generation order after completion and reload, and match the approved agent hierarchy with regular-weight names, aligned icons and flush-left threads. Scale tool Orbs to the wordmark ratio and center them beside wrapped labels. Use the shared avatar popover for outside-click and Escape dismissal.` |
| `CHANGELOG.md:253` | Brand/mark guidance or history | Source: `- Standardize the orb + wordmark on 'BrandLockup' across the loader, landing, auth, and marketing surfaces, and play the loader's word reveal only once so it keeps blinking until the app appears. Once the app has rendered real content the loader can never reappear: boundary remounts and route fallbacks show plain skeletons instead.` |
| `CHANGELOG.md:299` | Brand/mark guidance or history | Source: `- The app boots on one loading screen: the orb and wordmark animate in once, breathe like the chat stream marker, and the "Opening workspace…" line sits beneath them, instead of logo screen to workspace text back to logo. The landing hero gains Get Started and GitHub buttons under the subtitle, and landing logo marks rest on the wordmark's baseline. Reduced motion disables the pulse and workspace spinner; shared pulse timing prevents flashes across loading-boundary handoffs.` |
| `CHANGELOG.md:504` | Brand/mark guidance or history | Source: `- **User-facing lifecycle emails redesigned to the Overlay brand**: all eight transactional templates ('src/shared/email/lifecycle-email.ts') now render the standardized metal orb + serif wordmark lockup, a white card on the paper background, serif headings, sentence-case copy, per-event feature cues (quick-start rows on welcome, a status pill on billing changes, a run card naming the automation on failures, workspace/chat cards on invites, mentions, and DMs), and black pill CTAs that deep-link into the app. Notification-type emails (mention, DM, automation failure) gain a "Manage email preferences" link; footers state why each email was sent. 'public/assets/overlay-logo.png' is regenerated to the current mark for email clients that strip SVG, and the 'convex/email/deliveryRunner.ts' allowlist now accepts 'workspace.mention' and 'workspace.dm_received' so those emails actually deliver instead of dead-lettering. Automation lifecycle events carry 'automationName' so failure emails name the automation.` |
| `CHANGELOG.md:525` | Brand/mark guidance or history | Source: `- **Landing page polish and docs restyle**: nav links now center on the page (not just within the bar), headline reads "The control plane for your workspace", Windsurf is removed from the agent visuals and Devin and Hermes join the roster, the section visuals no longer sit inside gray boxes, and the hero demo stays intact at narrow widths (horizontal scroll with the agents panel collapsing below 560px). The Mintlify docs match the landing design language: Libre Baskerville headings, the grayscale palette with a light/dark theme toggle, the metal-orb lockup, and grouped sidebar navigation for the Desktop, Develop, and Deploy & Operate sections.` |
| `CHANGELOG.md:526` | Brand/mark guidance or history | Source: `- Redesigned the auth screens ('/auth/sign-in', '/auth/sign-up', '/auth/forgot-password', '/auth/reset-password') around a split layout: a quiet brand panel with the orb mark and tagline on desktop, a compact brand mark above the form on mobile: replacing the floating card. Auth options and the SSO capability flag are now resolved server-side during page render instead of two client fetches ('/api/auth/options', '/api/v1/capabilities'), so the full form paints on first load rather than popping in after the heading. Sign-up's explicit Terms/Privacy toggle is now standard implicit-consent fine print ("By continuing, you agree to…"); the legal acceptance payload with document versions is still recorded identically at click time. The column scrolls safely when the form exceeds viewport height. The brand mark renders the canonical inline SVG 'OverlayMark' at 'MARKETING_LOGO_SIZE': identical to the landing header: instead of the raster 'overlay-logo.png', and every auth loading surface ('auth/loading.tsx' plus the 'LandingAuthBoundary'/reset-password Suspense fallbacks) now renders a shared 'AuthPageSkeleton' that mirrors the split layout's real component positions rather than a top-left spinner.` |
| `CHANGELOG.md:583` | Brand/mark guidance or history | Source: `- Agent avatars are now anthropomorphic creatures instead of metallic orbs: a solid-color body in one of eight shapes (circle, blob, squircle, pill, triangle, hexagon, cloud, droplet) with blinking eyes that go dark-on-light and light-on-dark automatically. Shape and color are chosen in the agent editor's Identity section (live creature preview, shape grid, color grid) and persist per agent across the sidebar roster, directory tiles, DM headers, and message avatars. Opening the Agents page now resolves the most recently used agent's conversation directly behind a loading indicator: the blank intermediate page only appears when the workspace has no agents. Requires Postgres migration '0074_agent_avatar_shape' (nullable column, circle default) and the additive Convex schema field on deploy.` |
| `CHANGELOG.md:587` | Brand/mark guidance or history | Source: `- The Overlay logo is now a resizable SVG orb component ('OverlayMark') instead of a PNG: sidebar, marketing nav/footer/showcase, sign-in popover, notebook, and loaders render it crisply at any size. Agents are orbs too ('AgentOrb'): the Overlay master agent renders as the grey metallic mark while every other agent tints the same sphere from its avatar color: in the sidebar roster, directory tiles, DM headers, message avatars (animated while streaming), and the editor, whose color picker now previews orb colorways. Lifecycle emails and favicons intentionally keep the PNG raster.` |
| `CHANGELOG.md:604` | Brand/mark guidance or history | Source: `- The Overlay orb mark moved into '@overlay/ui' ('components/orb/Orb.tsx' + 'ovorb-*' styles, loaded app-wide via 'globals.css'), with 'src/components/orb/Orb.tsx' kept as a re-export shim. Every raster-logo consumer in the chat surface: tool-call rails, the reasoning row, the streaming tail marker, exchange loading states, and the notebook agent panel/editor: now renders the SVG component instead of a background-image PNG. 'chat-react-config'/'toolLogoUrl' (whose only purpose was the logo URL override), 'OVERLAY_LOGO_SRC', the '--overlay-mark-logo-url' vars, and the stray root 'overlay-logo.png' are gone; 'public/assets/overlay-logo.png' stays for lifecycle emails and favicons, which require raster. Requires desktop 'd5bedcd' (SUBNAV 3), which no longer consumes the removed config.` |
| `internal/develop/customization.md:33` | Brand/mark guidance or history | Source: `The default brand mark is the 'OverlayMark' SVG orb component ('@overlay/ui', re-exported from` |
| `internal/develop/customization.md:34` | Brand/mark guidance or history | Source: `'src/components/orb/Orb.tsx'), not the 'logoSrc' raster: the sidebar renders the orb whenever` |
| `internal/develop/customization.md:35` | Brand/mark guidance or history | Source: `'brand.logoSrc' is the default '/assets/overlay-logo.png', and only renders the 'next/image' raster` |
| `internal/develop/customization.md:36` | Brand/mark guidance or history | Source: `when a custom brand overrides it. The same 'Orb' component also renders the small marks inside the` |
| `internal/develop/customization.md:40` | Brand/mark guidance or history | Source: `are anthropomorphic creatures ('AgentCreature' in 'src/components/orb/Creature.tsx'): a solid-color` |
| `internal/develop/interface-design.md:333` | Brand/mark guidance or history | Source: `## Agents are creatures, never orbs` |
| `internal/develop/interface-design.md:338` | Brand/mark guidance or history | Source: `'Orb' glow variant or any colored sphere as an agent identity; the metal orb is` |
| `internal/develop/interface-design.md:483` | Brand/mark guidance or history | Source: `'ready' and the app can never paint before the loader. The wordmark paints` |
| `internal/develop/interface-design.md:495` | Brand/mark guidance or history | Source: `'BrandLockup' ('src/components/brand/BrandLockup.tsx') is the canonical orb + serif "overlay" wordmark. Its geometry is 'em'-scaled: the orb is '0.5em' resting on the wordmark's text baseline with a '0.4em' gap ('align-items: baseline' on '.brand-lockup' in 'globals.css'), the same configuration the landing '.lp .lockup' defines. Size it with 'font-size' on the component or an ancestor. The word sits inside '.brand-lockup-mask', an 'overflow: hidden' window, so reveals can slide it out from behind the orb. Use it wherever the logo and wordmark appear together (loader, auth pages, marketing nav/footer, skeletons) rather than composing 'OverlayMark' plus text ad hoc.` |
| `internal/develop/interface-design.md:497` | Brand/mark guidance or history | Source: `App startup renders a single loading screen wherever the shell is still resolving: 'AppBootLoader' ('src/components/layout/AppBootLoader.tsx') behind 'InitialAppLoading'/'AppShellLoadingFallback', the '/' entry fallback, and the workspace-hydration gate ('WorkspaceAppBoundary', which renders it 'settled' so the handoff shows no second splash). It renders 'BrandLockup' at '24px'; the mark fades in, the word reveals from behind it, then the whole lockup breathes with the same opacity-only pulse as the chat stream marker ('appBrandLoaderPulse' in 'globals.css'), with the "Opening workspace…" line beneath on the same screen.` |
| `internal/develop/interface-design.md:537` | Brand/mark guidance or history | Source: `Chat surfaces build on shadcn AI Elements primitives copied into 'packages/overlay-ui/src/components/ui' and exported from '@overlay/ui/ai' (kept out of the main barrel so Shiki only loads where chat renders): 'Message', 'Bubble', 'Trace', 'CodeBlock' (+ 'useHighlightedCode', Shiki JS engine, GitHub light/dark themes that presets never tint), 'MessageScroller' ('@shadcn/react'), 'Item', 'InputGroup', 'Attachment', 'HoverCard', 'Collapsible', 'Spinner'. Upstream semantic classes are rewritten to Overlay variables ('bg-(--surface-subtle)', 'text-(--muted)', 'text-(--danger)'); '--muted' is a text color here, so never add a '--color-muted' theme alias. Every Trace step uses the Orb in 'TraceIcon'; a running step's title shimmers (CSS in 'styles.css', off under reduced motion).` |
| `internal/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md:113` | Brand/mark guidance or history | Source: `- Use '@overlay/ui' for components and '@overlay/authz-contracts' for permission types. The logo is 'OverlayMark', per` |
| `internal/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md:147` | Brand/mark guidance or history | Source: `- [x] Use the existing app chrome and design language: dark gray surfaces, Lucide icons, 'OverlayMark' lockup.` |
| `internal/plans/APP_SHELL_SIDEBAR_PLAN.md:21` | Brand/mark guidance or history | Source: `8. **Agent identity stays.** Agent rows keep the 'Creature' avatars (shapes and googly eyes) from 'src/components/orb/Creature.tsx'.` |
| `internal/plans/CHAT_AI_ELEMENTS_PLAN.md:17` | Brand/mark guidance or history | Source: `plus a hand-built orb rail ('ToolLogoColumn'). AI Elements puts all of them on` |
| `internal/plans/CHAT_AI_ELEMENTS_PLAN.md:115` | Brand/mark guidance or history | Source: `\| 'ToolLogoColumn' / 'ToolLineLogo' (orb rail + connector line) \| 'TraceIcon' slot holds the Orb on every step (owner decision) \| Running/error/denied state shows through 'TraceLine status' styling and the title, not by swapping the orb for a status icon. The connector line goes away (Trace owns spacing). \|` |
| `internal/plans/CHAT_AI_ELEMENTS_PLAN.md:223` | Brand/mark guidance or history | Source: `\| 1 \| Step icon \| The Orb in 'TraceIcon' on every step. Status reads from 'TraceLine status' and the title. \|` |
| `internal/plans/GENERAL_INPUT_ONBOARDING_REFERENCE.md:319` | Brand/mark guidance or history | Source: `For Overlay specifically: keep the chat, orb introduction, centered inline setup panels, Personal memory default, and workspace reveal. Replace the reported heavy tour border with a quiet borderless highlight. Any new account page or material flow redesign should be mocked up for approval before implementation.` |
| `internal/plans/SHADCN_MIGRATION_PLAN.md:110` | Brand/mark guidance or history | Source: `- **Keep bespoke:** 'OverlayMark'/Orb (brand rule), 'UsageMeterBar',` |
| `README.md:2` | Brand/mark guidance or history | Source: `<img src="./src/assets/overlay-logo.png" alt="Overlay" width="150">` |
| `TRADEMARKS.md:3` | Trademark policy | Source: `The Overlay name, logos, hosted domains, product trade dress, and related brand assets identify LayerNorm Inc. products and services. Open source licenses in this repository do not grant trademark rights.` |
| `TRADEMARKS.md:19` | Trademark policy | Source: `- Use Overlay logos, icons, domains, or confusingly similar branding for a fork, hosted service, app, extension, or commercial offering.` |
| `TRADEMARKS.md:25` | Trademark policy | Source: `Modified distributions should use their own product name, logo, domains, and visual identity. They may include a factual notice such as "Based on Overlay" if the notice is not the primary product branding and does not imply endorsement.` |
| `TRADEMARKS.md:31` | Trademark policy | Source: `Logos, icons, screenshots, product trade dress, and other brand assets may be visible in the source tree so the unmodified project can be built and evaluated. Their presence does not place them under the AGPL or grant a right to use them for a modified distribution, hosted fork, marketing campaign, domain, social account, package, or app-store listing.` |
| `overlay-desktop/ASSET_LICENSES.md:14` | First-party brand asset licensing/provenance | Source: `Overlay logos, app icons, screenshots, sounds, and other first-party brand` |
| `overlay-desktop/ASSET_LICENSES.md:28` | First-party brand asset licensing/provenance | Source: `sound, and icon in 'resources/' and 'public/'. Unknown provenance blocks the` |
| `overlay-desktop/TRADEMARKS.md:3` | Desktop logo/name trademark policy | Source: `The Overlay name, logos, hosted domains, product trade dress, and related brand` |
| `overlay-desktop/TRADEMARKS.md:12` | Desktop logo/name trademark policy | Source: `"Overlay" or an official Overlay product; use Overlay logos, icons, domains, or` |
| `overlay-desktop/guides/website-flow.md:25` | Historical animated logo/footer wordmark spec | Source: `- Animated logo (scales down on scroll)` |
| `overlay-desktop/guides/website-flow.md:209` | Historical animated logo/footer wordmark spec | Source: `- Logo + copyright "2026 overlay"` |
| `internal/develop/interface-design.md:337` | Mark / avatar policy or styling dependency | Source: `('AgentCreature': 'avatarShape' body, 'avatarColor' fill, eyes). Do not use the` |

### Verification and limitations

Static cross-checks: scanned all available repositories and compared Orb/OverlayMark, BrandLockup/OperatorLockup, TraceOrb/ToolLineLogo/ToolLogoColumn, AgentCreature/Creature, stream-marker classes, logo asset literals and desktop imported-logo identifiers. Inventoried binary candidates by path and byte size. No application tests were run: research only, no behavior changed. No snapshots with independent old artwork were identified by text scan; assertion and story dependencies are listed above.

Remaining ambiguity: mobile absent; no runtime confirmation of reachability for legacy desktop exports or unused raster assets; image artwork not visually inspected; arbitrary screenshots may embed branding not discoverable by filename/text. Ordinary prose Overlay mentions, third-party provider logos, workspace-custom icons, and browser site favicons are intentionally excluded. Historical change-log/plan entries are inventory evidence, not instructions to rewrite product history.
