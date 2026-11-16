"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@overlay/ui/primitives";
import { DelayedTooltip } from "@overlay/ui/overlays";

export function DesktopSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="px-1">
        <h2 className="text-sm font-medium text-(--foreground)">{title}</h2>
        {description ? (
          <p className="text-xs text-(--muted-light)">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A settings row without an icon slot, so titles and controls align. */
export function DesktopRow({
  title,
  description,
  control,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-(--foreground)">{title}</div>
          {description ? (
            <div className="text-xs leading-relaxed text-(--muted-light)">
              {description}
            </div>
          ) : null}
        </div>
        {control ? (
          <div className="flex shrink-0 items-center gap-1.5">{control}</div>
        ) : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-(--border) bg-(--surface-subtle) px-1.5 py-0.5 font-sans text-[11px] font-medium leading-5 text-(--foreground)">
      {children}
    </kbd>
  );
}

/** Shows a native accelerator as key caps; click it, then press a new combination. */
export function ShortcutRecorder({
  label,
  accelerator,
  mac,
  disabled,
  onChange,
  onReset,
}: {
  label: string;
  accelerator: string | undefined;
  mac: boolean;
  disabled?: boolean;
  onChange(accelerator: string): void;
  onReset(): void;
}) {
  const [recording, setRecording] = useState(false);
  const keys = accelerator ? shortcutKeys(accelerator, mac) : [];
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${label} shortcut`}
        aria-pressed={recording}
        disabled={disabled}
        className="justify-end gap-1 px-1.5"
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (!recording) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setRecording(false);
            return;
          }
          const next = shortcutFromKey(event);
          if (next) {
            setRecording(false);
            onChange(next);
          }
        }}
      >
        {recording ? (
          <span className="text-xs text-(--muted)">Press keys…</span>
        ) : keys.length ? (
          keys.map((key, index) => <KeyCap key={index}>{key}</KeyCap>)
        ) : (
          <span className="text-xs text-(--muted)">Not set</span>
        )}
      </Button>
      <DelayedTooltip label="Reset to default">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reset ${label.toLowerCase()} shortcut`}
          disabled={disabled}
          onClick={onReset}
        >
          <RotateCcw strokeWidth={1.75} />
        </Button>
      </DelayedTooltip>
    </>
  );
}

export function shortcutKeys(accelerator: string, mac: boolean): string[] {
  const labels: Record<string, string> = {
    CommandOrControl: mac ? "⌘" : "Ctrl",
    Command: "⌘",
    Control: mac ? "⌃" : "Ctrl",
    Alt: mac ? "⌥" : "Alt",
    Shift: mac ? "⇧" : "Shift",
  };
  return accelerator.split("+").map((key) => labels[key] ?? key);
}

export function shortcutFromKey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === "Tab") return null;
  event.preventDefault();
  if (["Escape", "Meta", "Control", "Alt", "Shift"].includes(event.key))
    return null;
  if (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !/^F\d+$/.test(event.key)
  )
    return null;
  const physical: Record<string, string> = {
    Space: "Space",
    Period: ".",
    Comma: ",",
    Slash: "/",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
  };
  const key =
    physical[event.code] ??
    (/^(Key|Digit)/.test(event.code)
      ? event.code.replace(/^(Key|Digit)/, "")
      : event.key.replace("Arrow", ""));
  return [
    event.metaKey ? "Command" : "",
    event.ctrlKey ? "Control" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
