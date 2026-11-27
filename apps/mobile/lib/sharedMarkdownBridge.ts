export const MAX_MARKDOWN_COPY_LENGTH = 1_000_000

export type SharedMarkdownTheme = 'light' | 'dark'

export interface SharedMarkdownMessageSnapshot {
  id: string
  text: string
}

export interface SharedMarkdownSnapshot {
  theme: SharedMarkdownTheme
  isStreaming: boolean
  messages: SharedMarkdownMessageSnapshot[]
}

export type NativeMarkdownUrlOpener = (url: string) => Promise<unknown>
export type NativeMarkdownClipboardWriter = (text: string) => Promise<unknown>

export function validateNativeMarkdownLink(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2_048 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !/^https?:\/\//i.test(value)
  ) {
    return null
  }

  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

export async function openValidatedMarkdownLink(
  value: unknown,
  openURL: NativeMarkdownUrlOpener,
): Promise<boolean> {
  const url = validateNativeMarkdownLink(value)
  if (!url) return false
  await openURL(url)
  return true
}

export async function copyNativeMarkdownText(
  value: unknown,
  writeText: NativeMarkdownClipboardWriter,
): Promise<boolean> {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_MARKDOWN_COPY_LENGTH) {
    return false
  }
  await writeText(value)
  return true
}
