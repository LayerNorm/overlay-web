import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** Native settings kept in userData/settings.json. Unknown keys are preserved on write. */
class SettingsService {
  analyticsConsentEnabled = false

  private path(): string {
    return join(app.getPath('userData'), 'settings.json')
  }

  private load(): Record<string, unknown> {
    try {
      if (existsSync(this.path())) return JSON.parse(readFileSync(this.path(), 'utf-8'))
    } catch (error) {
      console.error('[Settings] Failed to load settings:', error)
    }
    return {}
  }

  initializeFromPersistedSettings(): void {
    this.analyticsConsentEnabled = this.load().analyticsConsentEnabled === true
  }

  persistCurrentSettings(): void {
    try {
      const settings = { ...this.load(), analyticsConsentEnabled: this.analyticsConsentEnabled }
      writeFileSync(this.path(), JSON.stringify(settings, null, 2), 'utf-8')
    } catch (error) {
      console.error('[Settings] Failed to save settings:', error)
    }
  }
}

export const settingsService = new SettingsService()
