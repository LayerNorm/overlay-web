"use client";

import { useState } from "react";
import { Button, Input } from "@overlay/ui/primitives";
import { SettingsGroup } from "@overlay/modules-react/settings";
import { useLocalModelKeys } from "@/components/desktop/useLocalThreads";
import { PRIVATE_MODEL_PROVIDERS, PRIVATE_PROVIDER_NAMES, type PrivateModelProvider } from "@/shared/agents/private-threads";
import { DesktopRow, DesktopSection } from "./DesktopSettingsParts";

/**
 * Model keys for private threads (internal/develop/private-threads.md). A key is checked with its provider, then kept
 * in this computer's keychain by the desktop app; the page never reads it back.
 */
export function DesktopModelKeysSettings() {
  const { keys, setKey } = useLocalModelKeys();
  const [editing, setEditing] = useState<PrivateModelProvider | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (provider: PrivateModelProvider, apiKey: string | null) => {
    setBusy(true);
    setError("");
    try {
      await setKey(provider, apiKey);
      setEditing(null);
      setValue("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DesktopSection
      title="Model keys"
      description="Threads that aren’t synced run on this computer with your own keys. Keys stay in this computer’s keychain and are sent only to their provider."
    >
      <SettingsGroup>
        {PRIVATE_MODEL_PROVIDERS.map((provider) => (
          <DesktopRow
            key={provider}
            title={PRIVATE_PROVIDER_NAMES[provider]}
            description={keys?.[provider] ? "Key saved on this computer" : "No key"}
            control={editing === provider ? null : keys?.[provider] ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save(provider, null)}>Remove</Button>
            ) : (
              <Button variant="ghost" size="sm" disabled={busy || keys === null} onClick={() => { setEditing(provider); setValue(""); setError(""); }}>Add key</Button>
            )}
          >
            {editing === provider ? (
              <form
                className="mt-3 flex items-center gap-2"
                onSubmit={(event) => { event.preventDefault(); if (value.trim()) void save(provider, value.trim()); }}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  placeholder={`${PRIVATE_PROVIDER_NAMES[provider]} API key`}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  className="h-8 flex-1 text-sm"
                />
                <Button type="submit" size="sm" disabled={busy || !value.trim()}>{busy ? "Checking…" : "Save"}</Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
              </form>
            ) : null}
          </DesktopRow>
        ))}
      </SettingsGroup>
      {error ? <p role="alert" className="px-1 text-xs text-destructive">{error}</p> : null}
    </DesktopSection>
  );
}
