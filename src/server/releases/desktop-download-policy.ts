type DesktopDownloadEnvironment = Record<string, string | undefined>

export function areOfficialDesktopDownloadsEnabled(
  env: DesktopDownloadEnvironment = process.env
): boolean {
  return env.OVERLAY_DESKTOP_DOWNLOADS_ENABLED?.trim() === '1'
}
