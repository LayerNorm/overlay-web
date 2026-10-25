export interface KnowledgeUploadToast {
  loading(message: string, options: { id: string }): unknown
  success(message: string, options: { id: string }): unknown
  error(message: string, options: { id: string }): unknown
}

export function beginKnowledgeUploadToast(
  toast: KnowledgeUploadToast,
  loadingMessage: string,
  createId: () => string = () => `knowledge-upload-${crypto.randomUUID()}`,
) {
  const id = createId()
  toast.loading(loadingMessage, { id })
  return {
    success(message: string) {
      toast.success(message, { id })
    },
    error(message: string) {
      toast.error(message, { id })
    },
  }
}
