export function accountPhotoSource(
  photoUrl: string | null | undefined,
  baseUrl: string,
  accessToken?: string,
) {
  if (!photoUrl) return null
  try {
    const url = new URL(photoUrl, baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    const privatePhoto =
      url.origin === new URL(baseUrl).origin && url.pathname === '/api/v1/account/profile/photo'
    return {
      photoUrl: url.href,
      headers: privatePhoto && accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    }
  } catch {
    return null
  }
}
