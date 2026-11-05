export function nativeMcpSettingsMode({
  nativeAuthConfigured,
  hasConvexClient,
}: {
  nativeAuthConfigured: boolean
  hasConvexClient: boolean
}): 'legacy' | 'native' | 'unavailable' {
  if (!nativeAuthConfigured) return 'legacy'
  return hasConvexClient ? 'native' : 'unavailable'
}
