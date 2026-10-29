export interface RuntimeLicenseException {
  package: string
  licenses: readonly string[]
  reason: string
}

export function findRuntimeLicenseException(
  packageName: string,
  license: string,
  allowlist: ReadonlyArray<RuntimeLicenseException>,
): RuntimeLicenseException | undefined {
  return allowlist.find(
    (entry) =>
      matchesPackagePattern(packageName, entry.package) &&
      entry.licenses.includes(license) &&
      entry.reason.trim(),
  )
}

function matchesPackagePattern(packageName: string, pattern: string): boolean {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`).test(packageName)
}
