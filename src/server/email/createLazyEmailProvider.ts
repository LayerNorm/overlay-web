import 'server-only'

import type { OverlayRuntimeConfig } from '@/shared/config'
import type { EmailProvider } from '@/shared/email'

export function createLazyEmailProvider(config: OverlayRuntimeConfig): EmailProvider {
  const name = config.providers.email?.provider ?? config.email?.provider ?? 'none'
  let provider: Promise<EmailProvider> | undefined
  return {
    name,
    send: async (message) => {
      provider ??= import('./createEmailProvider').then((module) => module.createEmailProvider(config))
      return await (await provider).send(message)
    },
  }
}
