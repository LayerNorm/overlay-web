export function isSupportedSlackChannel(channel: {
  is_channel?: boolean
  is_private?: boolean
  is_im?: boolean
  is_mpim?: boolean
  is_shared?: boolean
  is_ext_shared?: boolean
  is_org_shared?: boolean
  is_pending_ext_shared?: boolean
  pending_shared?: unknown[]
  is_archived?: boolean
} | null | undefined): boolean {
  return channel?.is_channel === true && channel.is_private === false && !channel.is_im && !channel.is_mpim
    && channel.is_shared === false && !channel.is_ext_shared && !channel.is_org_shared
    && !channel.is_pending_ext_shared && !channel.pending_shared?.length && !channel.is_archived
}
