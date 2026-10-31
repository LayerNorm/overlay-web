export type UploadedFileInput = {
  userId: string
  workspaceId?: string
  name: string
  parentId?: string
  r2Key: string
  sizeBytes: number
  mimeType?: string
  extension?: string
  scope?: 'personal' | 'workspace'
}
