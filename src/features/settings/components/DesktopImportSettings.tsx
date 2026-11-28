"use client";

import { Loader2, RotateCw } from "lucide-react";
import { Button } from "@overlay/ui/primitives";
import { SettingsGroup } from "@overlay/modules-react/settings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { LocalSetupList, useLocalSetupImport } from "@/components/desktop/LocalSetupList";
import { DesktopRow, DesktopSection } from "./DesktopSettingsParts";

/**
 * Settings → Import (desktop only): the scan from desktop setup's "Bring your setup" step, run again. Items already in
 * this workspace with the same contents are marked and left out, so importing twice adds nothing twice.
 */
export function DesktopImportSettings() {
  const { activeWorkspaceId } = useWorkspace();
  const { available, scan, picked, toggle, busy, error, result, importPicked, rescan } = useLocalSetupImport(activeWorkspaceId);
  if (!available) return null;
  const count = picked.size;
  return (
    <DesktopSection
      title="Import from other AI tools"
      description="Instructions, skills, subagents and MCP servers from Claude Code, Codex, Claude Desktop, Cursor and Gemini CLI on this computer. Servers that run commands stay on this computer."
    >
      {!scan ? (
        <SettingsGroup>
          <DesktopRow title={<span className="flex items-center gap-2 text-(--muted)"><Loader2 size={14} className="animate-spin" />Checking known settings files…</span>} />
        </SettingsGroup>
      ) : scan.apps.length ? (
        <LocalSetupList className="rounded-xl" scan={scan} picked={picked} busy={busy} onToggle={toggle} />
      ) : (
        <SettingsGroup>
          <DesktopRow title="Nothing found" description="Overlay didn’t find settings from these apps on this computer." />
        </SettingsGroup>
      )}
      <div className="flex items-center gap-2 px-1 pt-1">
        <p role={error || result?.failed.length ? "alert" : undefined} className={`min-w-0 flex-1 text-xs ${error || result?.failed.length ? "text-destructive" : "text-(--muted-light)"}`}>
          {error ?? (result ? resultText(result) : "")}
        </p>
        <Button variant="ghost" size="sm" disabled={busy || !scan} onClick={() => void rescan()}>
          <RotateCw size={14} strokeWidth={1.75} />Scan again
        </Button>
        <Button variant="secondary" size="sm" disabled={busy || !count} onClick={() => void importPicked()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {count ? `Import ${count} ${count === 1 ? "item" : "items"}` : "Import"}
        </Button>
      </div>
    </DesktopSection>
  );
}

function resultText(result: { imported: unknown[]; failed: { name: string; error: string }[] }): string {
  const done = `Imported ${result.imported.length} ${result.imported.length === 1 ? "item" : "items"}.`;
  return result.failed.length ? `${done} ${result.failed.map((item) => `${item.name}: ${item.error}`).join(" ")}` : done;
}
