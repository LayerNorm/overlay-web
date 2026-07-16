import { getFileType } from './file-viewer-types'

export function shouldIngestDocument(filename: string): boolean {
  const type = getFileType(filename)
  if (type === 'pdf' || type === 'text' || type === 'html' || type === 'markdown' || type === 'csv') {
    return true
  }
  return filename.toLowerCase().endsWith('.docx')
}
