/**
 * The workspace an audit event belongs to, read from its serialized metadata.
 * Governance writers put `workspaceId` in metadata; anything else is unscoped.
 */
export function auditWorkspaceId(metadataJson: string): string | undefined {
  try {
    const metadata = JSON.parse(metadataJson) as unknown
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
    const workspaceId = (metadata as Record<string, unknown>).workspaceId
    return typeof workspaceId === 'string' && workspaceId.length > 0 ? workspaceId : undefined
  } catch {
    return undefined
  }
}
