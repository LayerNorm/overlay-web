/**
 * Ultra-minimal marketing layout helpers.
 *
 * The rebuilt home / manifesto / pricing / account surfaces use a stripped
 * editorial design: huge serif display type, radical whitespace, one visual
 * per page, near-zero decoration. These helpers keep the type scale and
 * rhythm consistent across pages. All classes are token-based so light and
 * dark themes resolve via `LandingThemeProvider`.
 */

/** Page-level display heading — one per page. Pair with `minimalSerif()`. */
export function minimalDisplay(): string {
  return "text-balance text-5xl leading-[0.98] tracking-tight md:text-7xl lg:text-8xl";
}

/** Smaller display for utility pages (account, billing-disabled). */
export function minimalDisplaySm(): string {
  return "text-balance text-4xl leading-[1.02] tracking-tight md:text-6xl";
}

/** Section heading — at most ~3 per page. Pair with `minimalSerif()`. */
export function minimalHeading(): string {
  return "text-balance text-3xl leading-[1.08] tracking-tight md:text-5xl";
}

/** Inline style for the serif display face. */
export function minimalSerif(): { fontFamily: string } {
  return { fontFamily: "var(--font-serif)" };
}

/** Reading body copy. */
export function minimalBody(): string {
  return "text-base leading-8 text-[var(--muted)] md:text-lg";
}

/** The single small label allowed per page. */
export function minimalLabel(): string {
  return "text-xs font-medium uppercase tracking-[0.28em] text-[var(--muted-light)]";
}

/** Section vertical rhythm — whitespace does the separating, not borders. */
export function minimalSection(): string {
  return "px-6 py-24 md:px-10 md:py-40";
}

/** Tighter section for utility pages. */
export function minimalSectionSm(): string {
  return "px-6 py-16 md:px-10 md:py-24";
}

/** Centered reading column. */
export function minimalProse(): string {
  return "mx-auto max-w-2xl";
}

/** Wide container for the rare full-width moment (product demo, plans). */
export function minimalContainer(): string {
  return "mx-auto max-w-5xl";
}

/** The only card treatment allowed: flat, bordered, no shadow. */
export function minimalPanel(): string {
  return "rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)]";
}

/** Quiet inline text link with underline offset. */
export function minimalTextLink(): string {
  return "inline-flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)] underline decoration-[var(--border)] underline-offset-4 transition-colors hover:decoration-[var(--foreground)]";
}
