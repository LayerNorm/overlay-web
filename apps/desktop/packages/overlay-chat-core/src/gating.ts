export type OverlayGatedFeature = 'web_search' | 'deep_research' | 'remote_browser' | 'workspace'

export type OverlayGatedToolOutput = {
  _overlayGatedFeature: true
  feature: OverlayGatedFeature
  message: string
}

export function isOverlayGatedToolOutput(output: unknown): output is OverlayGatedToolOutput {
  if (output === null || typeof output !== 'object') return false
  return (output as { _overlayGatedFeature?: unknown })._overlayGatedFeature === true
}
