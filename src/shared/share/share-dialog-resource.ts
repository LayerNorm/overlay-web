export type ShareDialogResource = {
  id?: string
  type: 'chat' | 'file' | 'project' | 'knowledge_base' | 'automation' | 'agent'
  title: string
  url?: string
  thumbnailUrl?: string
}

export type ShareDialogRenderProps = {
  isOpen: boolean
  onClose: () => void
  resource: ShareDialogResource | null
}
