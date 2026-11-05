import { overlayAppClient } from '@/shared/app/overlay-app-client'

export async function fetchFileFirstUploadEnabled(): Promise<boolean> {
  return overlayAppClient.files.ingestionCapabilities({ credentials: 'same-origin', cache: 'no-store' })
    .then(capabilities => capabilities['files-file-first'] === true)
    .catch(() => false)
}

export async function uploadFileFirst(
  file: File,
  options: { parentId?: string | null; scope?: 'personal' | 'workspace' } = {},
): Promise<{ fileId: string; fileName: string }> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  const checksumSha256 = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const mimeType = file.type || 'application/octet-stream'
  const upload = await overlayAppClient.files.uploadUrl({
    name: file.name, mimeType, sizeBytes: file.size, checksumSha256,
  }, { credentials: 'same-origin' })
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: {
      'content-type': mimeType,
      'x-amz-checksum-sha256': btoa(String.fromCharCode(...digest)),
      'if-none-match': '*',
    },
    body: file,
  })
  if (!put.ok) throw new Error(`Could not upload file (HTTP ${put.status})`)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const commit = await overlayAppClient.files.registerDocumentResponse({
        r2Key: upload.r2Key, fileName: file.name, mimeType,
        sizeBytes: file.size, checksumSha256,
        ...(options.parentId ? { parentId: options.parentId } : {}),
        ...(options.scope ? { scope: options.scope } : {}),
      }, { credentials: 'same-origin' })
      if (!commit.ok) {
        if (commit.status < 500 && commit.status !== 429) {
          throw Object.assign(new Error(`Could not register file (HTTP ${commit.status})`), { permanent: true })
        }
        throw new Error(`Could not register file (HTTP ${commit.status})`)
      }
      const result = await commit.json() as { fileId?: string; fileName?: string }
      if (!result.fileId) throw new Error('Could not register uploaded file.')
      return { fileId: result.fileId, fileName: result.fileName ?? file.name }
    } catch (error) {
      if (attempt === 2 || (error && typeof error === 'object' && 'permanent' in error)) throw error
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt))
    }
  }
  throw new Error('Could not register uploaded file.')
}
