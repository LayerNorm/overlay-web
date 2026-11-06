export function nativeChatTitleForDisplay(
  isNativePersonalChat: boolean,
  nativeTitle: string | null | undefined,
  legacyTitle: string | null,
): string | null {
  return isNativePersonalChat ? nativeTitle ?? null : legacyTitle
}

export async function persistNativeChatTitle(
  renameNative: (chatId: string, title: string) => Promise<void>,
  chatId: string,
  title: string,
): Promise<boolean> {
  try {
    await renameNative(chatId, title)
    return true
  } catch {
    return false
  }
}
