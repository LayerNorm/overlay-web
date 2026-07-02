/**
 * Shared layout + typography helpers for marketing pages.
 *
 * These consolidate the section/container/grid/eyebrow/heading strings that
 * were previously inlined (and drifted) across home, use-cases/business, and pricing.
 * All token-based — they resolve correctly under LandingThemeProvider.
 *
 * Lives in `features/marketing/` so both `features/marketing/components/*` and
 * `src/app/*` pages can import it without crossing feature boundaries.
 */

/** Full-width marketing section with top hairline + vertical rhythm. */
export function marketingSection(): string {
  return "border-t border-[var(--border)] px-5 py-16 md:px-8 md:py-24";
}

/** Centered max-width container used inside every marketing section. */
export function marketingContainer(): string {
  return "mx-auto max-w-7xl";
}

/**
 * Two-column hero grid (text left, visual right). One ratio across all pages
 * instead of the previous per-page splits (0.62/1.38, 0.72/1.28, etc.).
 */
export function marketingHeroGrid(): string {
  return "mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.6fr_1.4fr] lg:items-center";
}

/** Uppercase eyebrow label above section headings. */
export function marketingEyebrow(): string {
  return "text-xs font-medium uppercase tracking-[0.24em] text-[var(--muted-light)]";
}

/**
 * Large display heading (section H2). Pair with `marketingSerifStyle()` to
 * apply the serif display face (Libre Baskerville via `--font-serif`).
 */
export function marketingHeadingLg(): string {
  return "text-3xl tracking-tight md:text-5xl";
}

/** Inline style object to apply the serif display face to a heading element. */
export function marketingSerifStyle(): { fontFamily: string } {
  return { fontFamily: "var(--font-serif)" };
}

/**
 * Small icon chip used in feature/workflow lists. Matches the app's
 * `rounded-md` control styling (not `rounded-lg`).
 */
export function marketingIconChip(): string {
  return "flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]";
}

/** Small feature card in a primitives grid. */
export function marketingFeatureCard(): string {
  return "bg-[var(--surface-elevated)] p-5";
}
