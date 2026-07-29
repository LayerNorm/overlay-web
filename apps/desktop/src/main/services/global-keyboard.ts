export type GlobalKeyCommand = 'paste' | 'enter'

export interface GlobalKeyboardBackend {
  sendNative(command: GlobalKeyCommand): Promise<void>
  sendWithSystemEvents(command: GlobalKeyCommand): Promise<void>
}

/**
 * Prefer direct native key injection. System Events is retained only as a
 * compatibility fallback because it can disappear after sleep or fast user
 * switching and return macOS error -600.
 */
export async function sendGlobalKey(
  command: GlobalKeyCommand,
  backend: GlobalKeyboardBackend
): Promise<'native' | 'system-events'> {
  try {
    await backend.sendNative(command)
    return 'native'
  } catch (nativeError) {
    console.warn(
      `[GlobalKeyboard] Native ${command} injection failed; trying System Events:`,
      nativeError
    )
    await backend.sendWithSystemEvents(command)
    return 'system-events'
  }
}
