import mixpanel from 'mixpanel-browser'

const REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const SESSION_STATS_KEY = 'analytics-session-stats'
const CUMULATIVE_STATS_KEY = 'analytics-cumulative-stats'
const LAST_REPORT_KEY = 'analytics-last-report'

export type UsageStat =
  | 'chat_panel_sessions'
  | 'notebook_panel_sessions'
  | 'browser_panel_sessions'
  | 'chats_created'
  | 'messages_sent'
  | 'notes_created'
  | 'words_written'
  | 'transcriptions_done'
  | 'browser_tabs_opened'

interface UsageStats {
  chat_panel_sessions: number
  notebook_panel_sessions: number
  browser_panel_sessions: number
  chats_created: number
  messages_sent: number
  notes_created: number
  words_written: number
  transcriptions_done: number
  browser_tabs_opened: number
}

const emptyStats = (): UsageStats => ({
  chat_panel_sessions: 0,
  notebook_panel_sessions: 0,
  browser_panel_sessions: 0,
  chats_created: 0,
  messages_sent: 0,
  notes_created: 0,
  words_written: 0,
  transcriptions_done: 0,
  browser_tabs_opened: 0
})

let initialized = false
let consentEnabled = false
let reportInterval: ReturnType<typeof setInterval> | null = null
let pendingUserId: string | null = null

function clearStoredStats(): void {
  try {
    localStorage.removeItem(SESSION_STATS_KEY)
    localStorage.removeItem(CUMULATIVE_STATS_KEY)
    localStorage.removeItem(LAST_REPORT_KEY)
  } catch {
    // Storage may be unavailable.
  }
}

async function pseudonymousId(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`overlay-desktop-analytics:${userId}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function applyPendingIdentity(): void {
  if (!initialized || !pendingUserId) return
  const userId = pendingUserId
  void pseudonymousId(userId)
    .then((id) => {
      if (initialized && consentEnabled && pendingUserId === userId) {
        mixpanel.identify(id)
      }
    })
    .catch(() => {
      // Identity is optional; never fall back to the raw application user ID.
    })
}

function loadStats(key: string): UsageStats {
  try {
    const saved = localStorage.getItem(key)
    return saved ? { ...emptyStats(), ...JSON.parse(saved) } : emptyStats()
  } catch {
    return emptyStats()
  }
}

function saveStats(key: string, stats: UsageStats): void {
  try {
    localStorage.setItem(key, JSON.stringify(stats))
  } catch {
    // Silently ignore storage errors (e.g. QuotaExceededError)
  }
}

function getLastReportTime(): number {
  try {
    const saved = localStorage.getItem(LAST_REPORT_KEY)
    return saved ? parseInt(saved, 10) : 0
  } catch {
    return 0
  }
}

function sendReport(): void {
  if (!initialized) return

  try {
    const session = loadStats(SESSION_STATS_KEY)
    const cumulative = loadStats(CUMULATIVE_STATS_KEY)

    const properties: Record<string, number> = {}
    for (const key of Object.keys(emptyStats()) as UsageStat[]) {
      properties[`session_${key}`] = session[key]
      properties[`cumulative_${key}`] = cumulative[key]
    }

    mixpanel.track('usage_report', properties)

    // Reset session stats after sending, keep cumulative
    saveStats(SESSION_STATS_KEY, emptyStats())
    localStorage.setItem(LAST_REPORT_KEY, String(Date.now()))
  } catch (e) {
    console.warn('[Analytics] Failed to send report:', e)
  }
}

export const analytics = {
  async setConsent(enabled: boolean) {
    consentEnabled = enabled === true
    if (!consentEnabled) {
      this.destroy()
      if (initialized) {
        try {
          mixpanel.reset()
          mixpanel.opt_out_tracking()
        } catch {
          // Best effort cleanup.
        }
      }
      initialized = false
      pendingUserId = null
      clearStoredStats()
      return
    }
    await this.init()
  },

  async init() {
    if (initialized || !consentEnabled) return
    try {
      const token = await window.bridge?.getAnalyticsToken?.()
      if (!token) {
        console.warn('[Analytics] No Mixpanel token available, skipping init')
        return
      }

      mixpanel.init(token, {
        debug: import.meta.env.DEV,
        track_pageview: false,
        persistence: 'localStorage',
        ip: false,
        ignore_dnt: false,
        property_blacklist: ['$current_url', '$initial_referrer', '$referrer']
      })
      initialized = true
      mixpanel.opt_in_tracking()
      applyPendingIdentity()

      // Check if a report is due
      const lastReport = getLastReportTime()
      const now = Date.now()
      if (lastReport === 0) {
        // First run — just set the timestamp
        localStorage.setItem(LAST_REPORT_KEY, String(now))
      } else if (now - lastReport >= REPORT_INTERVAL_MS) {
        sendReport()
      }

      // Schedule reports every 6 hours while app is open
      reportInterval = setInterval(sendReport, REPORT_INTERVAL_MS)
    } catch (e) {
      console.warn('[Analytics] Failed to initialize Mixpanel:', e)
    }
  },

  identify(userId: string) {
    if (!consentEnabled) return
    pendingUserId = userId
    applyPendingIdentity()
  },

  increment(stat: UsageStat, count = 1) {
    if (!consentEnabled) return
    try {
      const session = loadStats(SESSION_STATS_KEY)
      const cumulative = loadStats(CUMULATIVE_STATS_KEY)
      session[stat] += count
      cumulative[stat] += count
      saveStats(SESSION_STATS_KEY, session)
      saveStats(CUMULATIVE_STATS_KEY, cumulative)
    } catch (e) {
      console.warn('[Analytics] Failed to increment stat:', e)
    }
  },

  reset() {
    pendingUserId = null
    if (!initialized) return
    try {
      mixpanel.reset()
    } catch (e) {
      console.warn('[Analytics] Failed to reset:', e)
    }
  },

  destroy() {
    if (reportInterval) {
      clearInterval(reportInterval)
      reportInterval = null
    }
  }
}
