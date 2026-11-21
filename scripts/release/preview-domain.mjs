// Parent domain of isolated PR previews (pr-<n>.preview.overlay.works).
// Keep in sync with PREVIEW_PARENT_DOMAIN in src/shared/web/preview-origin.ts.
export const PREVIEW_PARENT_DOMAIN = 'preview.overlay.works'
const PARENT = PREVIEW_PARENT_DOMAIN.replaceAll('.', '\\.')
/** Canonical PR preview hostname; group 1 is the PR number. */
export const PREVIEW_HOSTNAME_PATTERN = new RegExp(`^pr-([1-9]\\d*)\\.${PARENT}$`)
/** Canonical PR preview origin (HTTPS, no port or path); group 1 is the PR number. */
export const PREVIEW_ORIGIN_PATTERN = new RegExp(`^https://pr-([1-9]\\d*)\\.${PARENT}$`)
// Previews before 2026-11-21 used pr-<n>.preview.getoverlay.io. Cleanup still removes those domains;
// delete this (and its uses in preview-control.mjs) once no `pr-*.preview.getoverlay.io` domain remains.
export const LEGACY_PREVIEW_HOSTNAME_PATTERN = /^pr-([1-9]\d*)\.preview\.getoverlay\.io$/
export const legacyPreviewHostname = number => `pr-${number}.preview.getoverlay.io`
export const previewOriginFor = number => `https://pr-${number}.${PREVIEW_PARENT_DOMAIN}`
