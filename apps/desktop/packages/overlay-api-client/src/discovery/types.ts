export type OverlayServerDiscovery = {
  api: {
    currentVersion: 'v1'
    supportedVersions: ['v1']
  }
  capabilities: {
    byok: boolean
    hostedInference: boolean
  }
  deployment: {
    id: string
  }
  minimumDesktopVersion: string
  nativeAuth: {
    authorizationPath: string
    browserHandoffPath?: string
    flow: 'system_browser_pkce'
    refreshPath: string
    supported: boolean
    tokenPath: string
  }
}
