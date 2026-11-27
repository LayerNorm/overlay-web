const STABLE_VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function parseStableVersion(version: string): [number, number, number] | null {
  const match = STABLE_VERSION.exec(version)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isAllowedStableUpgrade(current: string, candidate: string): boolean {
  const currentParts = parseStableVersion(current)
  const candidateParts = parseStableVersion(candidate)
  if (!currentParts || !candidateParts) return false
  for (let index = 0; index < currentParts.length; index += 1) {
    if (candidateParts[index] > currentParts[index]) return true
    if (candidateParts[index] < currentParts[index]) return false
  }
  return false
}
