/**
 * Shared styling for marketing / auth / account surfaces.
 *
 * These surfaces render inside `LandingThemeProvider`, which sets a scoped
 * `data-theme` so the app's CSS-variable design tokens (see globals.css) resolve
 * correctly for light and dark. As a result these helpers emit token-based
 * classes and no longer need to know the active theme.
 */

export function marketingAuthCard(): string {
  return "rounded-2xl border border-(--border) bg-(--surface-elevated) p-8 shadow-xs";
}

export function marketingAuthMuted(): string {
  return "text-(--muted)";
}

export function marketingSsoButton(): string {
  return [
    "w-full flex items-center justify-center gap-3 whitespace-nowrap px-4 py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 border",
    "bg-(--button-secondary-bg) border-(--button-secondary-border) text-(--button-secondary-text) hover:bg-(--surface-muted)",
  ].join(" ");
}

export function marketingPrimaryField(): string {
  return [
    "w-full px-4 py-3 rounded-xl text-sm focus:outline-hidden focus:ring-2 border",
    "bg-(--input-background) border-(--input-border) text-(--input-text) placeholder:text-(--input-placeholder) focus:ring-(--accent)",
  ].join(" ");
}

export function marketingSubmitButton(): string {
  return [
    "w-full py-3 px-4 rounded-xl text-sm font-medium transition-opacity disabled:opacity-50",
    "bg-(--button-primary-bg) text-(--button-primary-text) hover:opacity-90",
  ].join(" ");
}

export function marketingDividerLabel(): string {
  return "px-4 bg-(--surface-elevated) text-(--muted)";
}

/** Account / pricing cards. */
export function marketingPanel(): string {
  return "rounded-2xl border border-(--border) bg-(--surface-elevated) p-6 shadow-xs";
}

export function marketingPanelLg(): string {
  return "mx-auto max-w-md rounded-2xl border border-(--border) bg-(--surface-elevated) p-8 shadow-xs";
}

/** Typography for marketing surfaces. */
export function marketingPageTitle(): string {
  return "text-(--foreground)";
}

export function marketingHeading(): string {
  return "text-(--foreground)";
}

export function marketingBody(): string {
  return "text-(--muted)";
}

export function marketingMuted(): string {
  return "text-(--muted-light)";
}

export function marketingFeatureText(included: boolean): string {
  return included ? "text-(--foreground)" : "text-(--muted-light)";
}
