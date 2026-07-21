"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
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
 *  These are inlined on the wrapper div so the landing subtree never reads
 *  the app's theme (which AppSettingsProvider overrides via JS-injected
 *  preset variables on document.documentElement.style). */
const LANDING_CSS_VARS: Record<LandingTheme, React.CSSProperties> = {
  light: {
    /* Warm paper field — editorial marketing base (Runner-adjacent, not pure gray). */
    "--background": "#f7f5f1",
    "--foreground": "#0a0a0a",
    "--muted": "#6b6560",
    "--muted-light": "#9a948c",
    "--border": "#e6e1d8",
    "--surface-elevated": "#fffcf7",
    "--surface-muted": "#f0ebe3",
    "--surface-subtle": "#ebe6de",
    "--sidebar-surface": "#f0ebe3",
    "--overlay-scrim": "rgba(0,0,0,0.4)",
    "--accent": "#0a0a0a",
    "--button-primary-bg": "#0a0a0a",
    "--button-primary-text": "#ffffff",
    "--button-secondary-bg": "#fffcf7",
    "--button-secondary-border": "#e6e1d8",
    "--button-secondary-text": "#0a0a0a",
    "--input-background": "#fffcf7",
    "--input-border": "#e6e1d8",
    "--input-text": "#0a0a0a",
    "--input-placeholder": "#9a948c",
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
    "--sidebar-surface": "#151518",
    "--overlay-scrim": "rgba(0,0,0,0.6)",
    "--accent": "#f5f5f5",
    "--button-primary-bg": "#f5f5f5",
    "--button-primary-text": "#0a0a0a",
    "--button-secondary-bg": "transparent",
    "--button-secondary-border": "#27272a",
    "--button-secondary-text": "#f5f5f5",
    "--input-background": "#111113",
    "--input-border": "#27272a",
    "--input-text": "#f5f5f5",
    "--input-placeholder": "#71717a",
    "--success": "#10b981",
    "--warning": "#f59e0b",
    "--danger": "#ef4444",
  } as React.CSSProperties,
};

export function LandingThemeProvider({ children }: { children: React.ReactNode }) {
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
        style={{
          colorScheme: landingTheme,
          ...LANDING_CSS_VARS[landingTheme],
        }}
        className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)]"
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
