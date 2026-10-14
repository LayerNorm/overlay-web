const capabilities = { work: true, chat: true, files: true, integrations: false, automations: false, skills: false, mcpServers: false }
export function useOverlayCapabilities() {
  return { capabilities, isLoading: false }
}
