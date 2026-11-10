export function showShellExtensions(
  registry: ReadonlyArray<{ id: string; enabled: boolean }> | null | undefined,
  permitted: boolean,
): boolean {
  return permitted && registry?.some((flag) => flag.id === 'extensions' && flag.enabled) === true
}
