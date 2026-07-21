export type FileViewerType =
  | 'text'
  | 'html'
  | 'markdown'
  | 'csv'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'document'
  | 'binary'

export function getFileType(filename: string): FileViewerType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['md', 'markdown'].includes(ext)) return 'markdown'
  if (
    ['txt', 'log', 'sh', 'py', 'js', 'ts', 'tsx', 'jsx', 'json', 'css', 'xml', 'yaml', 'yml', 'toml', 'go', 'rs', 'java', 'c', 'cpp', 'h'].includes(ext)
  ) return 'text'
  if (['html', 'htm'].includes(ext)) return 'html'
  if (ext === 'csv') return 'csv'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'ogv', 'm4v'].includes(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (['docx', 'doc'].includes(ext)) return 'document'
  return 'binary'
}

export function isEditableType(filename: string): boolean {
  const type = getFileType(filename)
  return type === 'text' || type === 'html' || type === 'markdown'
}

export function isPreviewableType(filename: string): boolean {
  return getFileType(filename) !== 'binary'
}

export function prefersUrlPreview(filename: string): boolean {
  const type = getFileType(filename)
  return type === 'pdf' || type === 'image' || type === 'audio' || type === 'video' || type === 'document'
}

export function shouldFetchTextContent(filename: string): boolean {
  const type = getFileType(filename)
  return type === 'text' || type === 'html' || type === 'markdown' || type === 'csv'
}
