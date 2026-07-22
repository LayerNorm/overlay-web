"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { LANDING_THEME_STORAGE_KEY } from "@/features/landing/lib/landingThemeConstants";

export type LandingTheme = "light" | "dark";

type LandingThemeContextValue = {
  landingTheme: LandingTheme;
  setLandingTheme: (theme: LandingTheme) => void;
  toggleLandingTheme: () => void;
  isLandingDark: boolean;
};

const LandingThemeContext = createContext<LandingThemeContextValue | null>(null);
const LANDING_THEME_CHANGE_EVENT = "overlay:landing-theme-change";

function readStoredLandingTheme(): LandingTheme {
  if (typeof window === "undefined") return "light";
  try {
    const t = window.localStorage.getItem(LANDING_THEME_STORAGE_KEY);
    if (t === "dark" || t === "light") return t;
  } catch {
    /* ignore */
  }
  return "light";
}

function subscribeToLandingTheme(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleChange = () => {
    callback();
  };

  window.addEventListener("storage", handleChange);
  window.addEventListener(LANDING_THEME_CHANGE_EVENT, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(LANDING_THEME_CHANGE_EVENT, handleChange);
  };
}

function writeStoredLandingTheme(theme: LandingTheme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANDING_THEME_STORAGE_KEY, theme);
    window.dispatchEvent(new Event(LANDING_THEME_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

/** Self-contained CSS variables for the landing theme.
 *
 *  Mirrors `globals.css` `:root` and `[data-theme='dark']` exactly so the
 *  landing (and its product demo) share one source of truth with the app.
 *  Inlined on the wrapper div so the landing subtree never reads the app's
 *  JS-injected preset variables (set by AppSettingsProvider on
 *  document.documentElement.style). */
const LANDING_CSS_VARS: Record<LandingTheme, React.CSSProperties> = {
  light: {
    "--background": "#fafafa",
    "--foreground": "#0a0a0a",
    "--muted": "#71717a",
    "--muted-light": "#a1a1aa",
    "--border": "#e4e4e7",
    "--surface-elevated": "#ffffff",
    "--surface-muted": "#f5f5f5",
    "--surface-subtle": "#f0f0f0",
    "--sidebar-surface": "#f5f5f5",
    "--glass-bg": "rgba(255, 255, 255, 0.7)",
    "--glass-border": "rgba(255, 255, 255, 0.5)",
    "--selection-bg": "rgba(0, 0, 0, 0.1)",
    "--scrollbar-thumb": "#d4d4d8",
    "--scrollbar-thumb-hover": "#a1a1aa",
    "--overlay-scrim": "rgba(0, 0, 0, 0.4)",
    "--font-serif-family": "'Libre Baskerville'",
    "--font-sans":
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "--font-mono":
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    "--font-serif": "var(--font-serif-family), var(--font-sans)",
    "--accent": "#0a0a0a",
    "--skill": "#751ed9",
    "--chat-badge-free-bg": "#ecfdf5",
    "--chat-badge-free-fg": "#065f46",
    "--chat-badge-upgrade-bg": "#fef9ec",
    "--chat-badge-upgrade-fg": "#b45309",
    "--chat-badge-upgrade-hover": "#fde68a",
    "--chat-alert-error-bg": "#fef2f2",
    "--chat-alert-error-border": "#fecaca",
    "--chat-alert-error-text": "#dc2626",
    "--chat-alert-warn-bg": "#fffbeb",
    "--chat-alert-warn-border": "#fde68a",
    "--chat-alert-warn-text": "#92400e",
    "--tool-line-label": "#52525b",
    "--tool-line-chevron": "#a1a1aa",
    "--overlay-mark-logo-url": "url('/assets/overlay-logo.png')",
    "--button-primary-bg": "#0a0a0a",
    "--button-primary-text": "#ffffff",
    "--button-secondary-bg": "#ffffff",
    "--button-secondary-border": "#e4e4e7",
    "--button-secondary-text": "#0a0a0a",
    "--input-background": "#ffffff",
    "--input-border": "#e4e4e7",
    "--input-text": "#0a0a0a",
    "--input-placeholder": "#a1a1aa",
    "--success": "#10b981",
    "--warning": "#f59e0b",
    "--danger": "#ef4444",
  } as React.CSSProperties,
  dark: {
    "--background": "#09090b",
    "--foreground": "#f5f5f5",
    "--muted": "#a1a1aa",
    "--muted-light": "#71717a",
    "--border": "#27272a",
    "--surface-elevated": "#111113",
    "--surface-muted": "#151518",
    "--surface-subtle": "#1c1c20",
    "--sidebar-surface": "#111113",
    "--glass-bg": "rgba(17, 17, 19, 0.72)",
    "--glass-border": "rgba(255, 255, 255, 0.08)",
    "--selection-bg": "rgba(255, 255, 255, 0.16)",
    "--scrollbar-thumb": "#3f3f46",
    "--scrollbar-thumb-hover": "#52525b",
    "--overlay-scrim": "rgba(0, 0, 0, 0.58)",
    "--font-serif-family": "'Libre Baskerville'",
    "--font-sans":
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "--font-mono":
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    "--font-serif": "var(--font-serif-family), var(--font-sans)",
    "--accent": "#f5f5f5",
    "--skill": "#751ed9",
    "--chat-badge-free-bg": "rgba(16, 185, 129, 0.16)",
    "--chat-badge-free-fg": "#6ee7b7",
    "--chat-badge-upgrade-bg": "rgba(245, 158, 11, 0.14)",
    "--chat-badge-upgrade-fg": "#fbbf24",
    "--chat-badge-upgrade-hover": "rgba(245, 158, 11, 0.22)",
    "--chat-alert-error-bg": "rgba(127, 29, 29, 0.45)",
    "--chat-alert-error-border": "rgba(248, 113, 113, 0.28)",
    "--chat-alert-error-text": "#fecaca",
    "--chat-alert-warn-bg": "rgba(120, 53, 15, 0.45)",
    "--chat-alert-warn-border": "rgba(251, 191, 36, 0.25)",
    "--chat-alert-warn-text": "#fde68a",
    "--tool-line-label": "#d4d4d8",
    "--tool-line-chevron": "#c4c4c4",
    "--overlay-mark-logo-url": "url('/assets/overlay-logo.png')",
    "--button-primary-bg": "#f5f5f5",
    "--button-primary-text": "#09090b",
    "--button-secondary-bg": "#111113",
    "--button-secondary-border": "#27272a",
    "--button-secondary-text": "#f5f5f5",
    "--input-background": "#111113",
    "--input-border": "#27272a",
    "--input-text": "#f5f5f5",
    "--input-placeholder": "#71717a",
    "--success": "#34d399",
    "--warning": "#fbbf24",
    "--danger": "#f87171",
  } as React.CSSProperties,
};

export function LandingThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const embeddedInApp = pathname.startsWith("/app/");
  const landingTheme = useSyncExternalStore<LandingTheme>(
    subscribeToLandingTheme,
    readStoredLandingTheme,
    () => "light",
  );

  const setLandingTheme = useCallback((theme: LandingTheme) => {
    writeStoredLandingTheme(theme);
  }, []);

  const toggleLandingTheme = useCallback(() => {
    const nextTheme: LandingTheme = landingTheme === "light" ? "dark" : "light";
    writeStoredLandingTheme(nextTheme);
  }, [landingTheme]);

  const value = useMemo<LandingThemeContextValue>(
    () => ({
      landingTheme,
      setLandingTheme,
      toggleLandingTheme,
      isLandingDark: landingTheme === "dark",
    }),
    [landingTheme, setLandingTheme, toggleLandingTheme],
  );

  return (
    <LandingThemeContext.Provider value={value}>
      <div
        suppressHydrationWarning
        data-landing-theme={landingTheme}
        style={embeddedInApp ? undefined : {
          colorScheme: landingTheme,
          ...LANDING_CSS_VARS[landingTheme],
        }}
        className={`flex flex-col bg-[var(--background)] text-[var(--foreground)] ${embeddedInApp ? "min-h-full" : "min-h-screen"}`}
      >
        {children}
      </div>
    </LandingThemeContext.Provider>
  );
}

export function useLandingTheme(): LandingThemeContextValue {
  const ctx = useContext(LandingThemeContext);
  if (!ctx) {
    throw new Error("useLandingTheme must be used within LandingThemeProvider");
  }
  return ctx;
}

/** For shared components that may render outside marketing (e.g. rare fallbacks). */
export function useLandingThemeOptional(): LandingThemeContextValue | null {
  return useContext(LandingThemeContext);
}
