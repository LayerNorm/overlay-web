const params = new URLSearchParams(window.location.search)
const capabilities = { work: params.get('workOff') !== '1', chat: true, files: true, integrations: false, automations: false, skills: false, mcpServers: false }
export function useOverlayCapabilities() {
  return { capabilities, isLoading: params.get('capsLoading') === '1' }
}
