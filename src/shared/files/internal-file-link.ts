const CONTENT_PATH = /^\/api\/v1\/files\/([^/?#]+)\/content$/
const FILES_PATH = /^\/app\/(?:w\/[^/]+\/)?files$/
const NOTES_PATH = /^\/app\/(?:w\/[^/]+\/)?notes$/

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value) || null
  } catch {
    return null
  }
}

/**
 * The file a link inside Overlay points at, or null for anything else. Recognises the file content route, the Files
 * page (`?file=`) and the Notes page (`?id=`), relative or absolute on Overlay's own origin.
 */
export function internalFileIdFromHref(href: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(href, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  const content = CONTENT_PATH.exec(url.pathname)
  if (content) return decoded(content[1]!)
  if (FILES_PATH.test(url.pathname)) return url.searchParams.get('file') || null
  if (NOTES_PATH.test(url.pathname)) return url.searchParams.get('id') || null
  return null
}
