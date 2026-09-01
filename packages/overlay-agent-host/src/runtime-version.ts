export const MINIMUM_NODE_MAJOR = 24

export function assertSupportedNodeVersion(version = process.versions.node): void {
  const major = Number.parseInt(version.split('.', 1)[0] ?? '', 10)
  if (!Number.isFinite(major) || major < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `Overlay Agent Host requires Node.js ${MINIMUM_NODE_MAJOR} or newer; current version is ${version}. Regenerate the connection command in Overlay so it can launch with Node.js ${MINIMUM_NODE_MAJOR}.`,
    )
  }
}
