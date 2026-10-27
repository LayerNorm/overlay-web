export function resolveIdentityDisplayName(input: {
  workspaceOverride?: string | null
  accountOverride?: string | null
  providerName?: string | null
  legacyDisplayName?: string | null
  email?: string | null
}): string {
  return [
    input.workspaceOverride,
    input.accountOverride,
    input.providerName,
    input.legacyDisplayName,
    input.email,
  ].map((value) => value?.trim()).find(Boolean) ?? 'User'
}

export function resolveIdentityPhotoUrl(input: {
  workspacePhotoUrl?: string | null
  accountPhotoUrl?: string | null
  providerPhotoUrl?: string | null
}): string | null {
  return input.workspacePhotoUrl?.trim()
    || input.accountPhotoUrl?.trim()
    || input.providerPhotoUrl?.trim()
    || null
}
