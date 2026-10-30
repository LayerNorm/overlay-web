# Overlay brand: O mark rollout plan

Status: web implementation under review in #354; desktop and mobile rollout deferred.

Replace the metallic orb and lowercase "overlay" wordmark with the uppercase Libre Baskerville Regular **O with two eyes** and the **Overlay** wordmark (only the O capitalized). The mark becomes the Overlay agent's avatar, and every orb pulse becomes eye motion.

- Mockup: `internal/plans/mockups/overlay-brand-rollout-mockup.html`
- Source assets (SVG, PNG, generator): `internal/plans/mockups/overlay-brand/`

## Approved decisions

1. **One component, `OverlayMark`**, rewritten in `@overlay/ui` to render the O. Props: `size`, `motion: 'none' | 'blink' | 'look'`. At sizes <= 24px it switches to the larger small-size eyes. `Orb` is deleted, not kept as an alias.
2. **Motion mapping.** Idle brand marks: static. Overlay agent avatar: blink (same as creatures). Thinking, loading, streaming, running tool rows: `look` (eyes glance left and right). Reduced motion: static.
3. **Wordmark** is real "Overlay" text in Libre Baskerville with the O swapped for the mark (`BrandLockup` renders mark + "verlay"), so it stays selectable and sized by `font-size`. Outlined SVG is used only where fonts can't load (OG images, email PNG, desktop tray, docs).
4. **Overlay agent identity.** `AgentCreature` gains an `isDefault` input (from `agent.isDefault`, already stored) and renders `OverlayMark` for it. Gray color alone is not used, so user agents that happen to be gray stay creatures.
5. **Other agents stay creatures.** AGENTS.md rule is rewritten: "Agents are creatures, except the default Overlay agent, which is the O mark."
6. **Raster files** in `public/` are regenerated from the new SVGs at the same filenames, so existing references (email, white-label sentinel, metadata) keep working.

## Phases

| # | Status | Scope | Main files |
|---|---|---|---|
| 1 | Done | New `OverlayMark` + eye motion in `@overlay/ui`; delete `Orb`, `OVERLAY_ORB_DEFAULT_COLOR`, glow variant, metal palette | `packages/overlay-ui/src/components/orb/OverlayMark.tsx`, `src/components/brand/OverlayMark.tsx`, package exports |
| 2 | Done | Wordmark: `BrandLockup` to "Overlay", plus sidebar, admin, auth, landing, footer, docs headers | `src/components/brand/BrandLockup.tsx`, `AppSidebar` `BrandMark`, `apps/admin` |
| 3 | Done | Loaders and thinking: chat response loading, streaming rows, boot loader, page loaders; replace opacity pulse CSS with `motion="look"` | chat-react loading rows, boot loader, `ovorb-*` / pulse CSS |
| 4 | Done | Logo-free tool, trace and approval rows; one active 24px response-footer mark; notebook eye motion | tool rail, trace, approval, notebook components |
| 5 | Done | Overlay agent avatar: pass `isDefault` through every `AgentCreature` caller (sidebar, agent list, chat header, mentions, tasks, automations) | `src/components/orb/Creature.tsx` and 98 consumer rows |
| 6 | Done | Static assets: favicon, apple-touch, `overlay-logo.png`, OG images and OG routes (lowercase o square), JSON-LD logo, email PNG | `public/`, `src/app/**/opengraph-image*`, `src/shared/email/lifecycle-email.ts` |
| 7 | Deferred | Desktop (`overlay-desktop` submodule): app icon, tray, onboarding, raster stream markers, `ToolLineLogo`, vendored package copies; separate PR in that repo | `overlay-desktop/resources/**`, desktop renderer |
| 8 | Deferred | Mobile (`overlay-mobile`): icon, adaptive icon, splash. Not in this checkout; inventory when it is cloned | `overlay-mobile/assets/**`, `app.json` |
| 9 | Done | Docs, rules, tests: AGENTS.md brand and avatar rules, design docs, snapshots, stories | `AGENTS.md`, living design docs and focused render tests |

Web phases are combined in #354. Desktop and mobile remain separate follow-ups.

## Verification

- Targeted ESLint and `tsc` per phase, updated snapshots.
- `rg -n "Orb\b|OverlayMark|ovorb|metal" src packages apps` returns only the new component after phase 4.
- `rg -n "'overlay'|>overlay<" src packages apps` returns no brand wordmark after phase 2.
- Preview QA in light and dark: landing header, sidebar, Overlay agent in agent list and chat, chat loading, tool rows, boot loader, favicon, an OG link preview, a lifecycle email.

## Known gaps

- `overlay-mobile/` is not in this checkout.
- Web brand assets and representative favicon/app-icon/logo PNGs are regenerated and visually checked. Marketing screenshots contain no old Overlay mark and remain unchanged. No existing Apple-specific, ICO or admin icon files were found.
- Desktop vendored package copies differ from web and need their own pass.
