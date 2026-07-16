/**
 * Shared styling for marketing / auth / account surfaces.
 *
 * These surfaces render inside `LandingThemeProvider`, which sets a scoped
 * `data-theme` so the app's CSS-variable design tokens (see globals.css) resolve
 * correctly for light and dark. As a result these helpers emit token-based
 * classes and no longer need to know the active theme.
 */

export function marketingAuthCard(): string {
  return "rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8 shadow-sm";
}

export function marketingAuthMuted(): string {
  return "text-[var(--muted)]";
}

export function marketingSsoButton(): string {
  return [
    "w-full flex items-center justify-center gap-3 whitespace-nowrap px-4 py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 border",
    "bg-[var(--button-secondary-bg)] border-[var(--button-secondary-border)] text-[var(--button-secondary-text)] hover:bg-[var(--surface-muted)]",
  ].join(" ");
}

export function marketingPrimaryField(): string {
  return [
    "w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 border",
    "bg-[var(--input-background)] border-[var(--input-border)] text-[var(--input-text)] placeholder:text-[var(--input-placeholder)] focus:ring-[var(--accent)]",
  ].join(" ");
}

export function marketingSubmitButton(): string {
  return [
    "w-full py-3 px-4 rounded-xl text-sm font-medium transition-opacity disabled:opacity-50",
    "bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] hover:opacity-90",
  ].join(" ");
}

export function marketingDividerLabel(): string {
  return "px-4 bg-[var(--surface-elevated)] text-[var(--muted)]";
}

/** Account / pricing cards. */
export function marketingPanel(): string {
  return "rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-sm";
}

export function marketingPanelLg(): string {
  return "mx-auto max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8 shadow-sm";
}

/** Typography for marketing surfaces. */
export function marketingPageTitle(): string {
  return "text-[var(--foreground)]";
}

export function marketingHeading(): string {
  return "text-[var(--foreground)]";
}

export function marketingBody(): string {
  return "text-[var(--muted)]";
}

export function marketingMuted(): string {
  return "text-[var(--muted-light)]";
}

export function marketingFeatureText(included: boolean): string {
  return included ? "text-[var(--foreground)]" : "text-[var(--muted-light)]";
}
