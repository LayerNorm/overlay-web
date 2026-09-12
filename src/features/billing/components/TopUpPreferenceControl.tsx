"use client";

import type { ReactNode } from "react";
import { Toggle } from "@overlay/ui/primitives";

type TopUpPreferenceControlProps = {
  variant: "marketing" | "app";
  isDark?: boolean;
  title?: string;
  description?: string;
  amountCents: number;
  minAmountCents: number;
  maxAmountCents: number;
  stepAmountCents: number;
  onAmountChange: (amountCents: number) => void;
  autoTopUpEnabled: boolean;
  onAutoTopUpEnabledChange: (enabled: boolean) => void;
  amountLabel?: string;
  checkboxLabel?: string;
  checkboxDescription?: string;
  note?: ReactNode;
  footer?: ReactNode;
};

export function TopUpPreferenceControl({
  variant,
  isDark = false,
  title,
  description,
  amountCents,
  minAmountCents,
  maxAmountCents,
  stepAmountCents,
  onAmountChange,
  autoTopUpEnabled,
  onAutoTopUpEnabledChange,
  amountLabel = "Top-up amount",
  checkboxLabel = "Automatically top up by this amount when I run out",
  checkboxDescription,
  note,
  footer,
}: TopUpPreferenceControlProps) {
  const amountDollars = Math.round(amountCents) / 100;
  const minDollars = Math.round(minAmountCents) / 100;
  const maxDollars = Math.round(maxAmountCents) / 100;
  const stepDollars = Math.max(1, Math.round(stepAmountCents) / 100);

  const palette =
    variant === "app"
      ? {
          panel: "rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-sm",
          sliderSurface: "mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4",
          label: "text-sm text-[var(--muted)]",
          heading: "text-sm font-medium text-[var(--foreground)]",
          value: "font-medium text-[var(--foreground)]",
          copy: "mt-2 text-sm leading-relaxed text-[var(--muted)]",
          note: "mt-3 text-xs text-[var(--muted)]",
          checkboxRow: "mt-4 flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4",
          checkboxTitle: "text-sm font-medium text-[var(--foreground)]",
          checkboxBody: "mt-1 text-xs leading-relaxed text-[var(--muted)]",
          input: "mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-300 accent-zinc-900 dark:bg-zinc-700 dark:accent-zinc-100",
        }
      : {
          panel: `rounded-[26px] border px-5 py-5 ${isDark ? "border-zinc-800 bg-zinc-950/50 shadow-[0_18px_50px_rgba(0,0,0,0.18)]" : "border-zinc-200 bg-zinc-50/90 shadow-[0_14px_36px_rgba(10,10,10,0.05)]"}`,
          sliderSurface: `mt-4 rounded-[22px] border p-4 ${isDark ? "border-zinc-800 bg-zinc-950/80" : "border-zinc-200 bg-white"}`,
          label: `text-sm ${isDark ? "text-zinc-400" : "text-zinc-500"}`,
          heading: `text-sm font-medium ${isDark ? "text-zinc-100" : "text-zinc-900"}`,
          value: isDark ? "font-medium text-zinc-100" : "font-medium text-zinc-900",
          copy: `mt-2 text-sm leading-relaxed ${isDark ? "text-zinc-400" : "text-zinc-600"}`,
          note: `mt-3 text-xs ${isDark ? "text-zinc-500" : "text-zinc-500"}`,
          checkboxRow: `mt-4 flex items-start gap-3 rounded-[22px] border p-4 ${isDark ? "border-zinc-800 bg-zinc-950/80" : "border-zinc-200 bg-white"}`,
          checkboxTitle: isDark ? "text-sm font-medium text-zinc-100" : "text-sm font-medium text-zinc-900",
          checkboxBody: isDark ? "mt-1 text-xs leading-relaxed text-zinc-400" : "mt-1 text-xs leading-relaxed text-zinc-600",
          input: isDark
            ? "mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-zinc-100"
            : "mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-zinc-900",
        };

  return (
    <div className={palette.panel}>
      {title ? <h2 className={palette.heading}>{title}</h2> : null}
      {description ? <p className={palette.copy}>{description}</p> : null}

      <div className={palette.sliderSurface}>
        <div className="flex items-center justify-between text-sm">
          <span className={palette.label}>{amountLabel}</span>
          <span className={palette.value}>${amountDollars.toFixed(0)}</span>
        </div>
        <input
          type="range"
          min={minDollars}
          max={maxDollars}
          step={stepDollars}
          value={amountDollars}
          onChange={(event) => onAmountChange(Math.round(Number(event.target.value) * 100))}
          className={palette.input}
        />
        <div className={`mt-2 flex items-center justify-between text-xs ${palette.label}`}>
          <span>${minDollars.toFixed(0)}</span>
          <span>${maxDollars.toFixed(0)}</span>
        </div>
      </div>

      <div className={palette.checkboxRow}>
        <div className="min-w-0 flex-1">
          <p className={palette.checkboxTitle}>{checkboxLabel}</p>
          {checkboxDescription ? <p className={palette.checkboxBody}>{checkboxDescription}</p> : null}
        </div>
        <Toggle
          checked={autoTopUpEnabled}
          onCheckedChange={onAutoTopUpEnabledChange}
          aria-label={checkboxLabel}
        />
      </div>

      {note ? <div className={palette.note}>{note}</div> : null}
      {footer ? <div className="mt-4 flex flex-col gap-3 sm:flex-row">{footer}</div> : null}
    </div>
  );
}
