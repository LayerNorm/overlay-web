export type ShareDialogResource = {
  type: 'chat' | 'file'
  title: string
  url: string
  thumbnailUrl?: string
}

export type ShareDialogRenderProps = {
  isOpen: boolean
  onClose: () => void
  resource: ShareDialogResource | null
}
