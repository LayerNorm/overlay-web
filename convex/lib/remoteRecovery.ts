/** The offset comes from the authorized canonical message, never the original request metadata. */
export function recoveryStartPayload(payload: Record<string, unknown>, textOffset: number) {
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata : {}
  const { recoveryTextOffset: _oldOffset, ...rest } = metadata as Record<string, unknown>
  void _oldOffset
  return { ...payload, fresh: true, metadata: { ...rest, ...(textOffset > 0 ? { recoveryTextOffset: textOffset } : {}) } }
}
