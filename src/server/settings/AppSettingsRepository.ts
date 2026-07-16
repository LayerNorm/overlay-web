import 'server-only'

import type { AppSettings } from '@overlay/app-core'

export type AppSettingsPatch = Partial<AppSettings>

export interface AppSettingsRepository {
  getByUserId(userId: string): Promise<AppSettings>
  updateForUserId(userId: string, patch: AppSettingsPatch): Promise<AppSettings>
}
