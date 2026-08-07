export type ShareDialogResource = {
  id: string
  type: 'chat' | 'file' | 'agent' | 'knowledge_base'
  title: string
  url?: string
  thumbnailUrl?: string
}

export type ShareDialogRenderProps = {
  isOpen: boolean
  onClose: () => void
  resource: ShareDialogResource | null
}
