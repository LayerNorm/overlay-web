"use client";

import { useEffect, useState } from "react";
import { Button, Input, Textarea } from "@overlay/ui/primitives";
import { SettingsGroup } from "@overlay/modules-react/settings";
import { parseEnvironmentLines, splitCommandLine, type DesktopBridge, type LocalMcpServer } from "@overlay/desktop-bridge";
import { DesktopRow, DesktopSection } from "./DesktopSettingsParts";

/**
 * MCP servers that run on this computer, for threads that aren't synced (internal/develop/private-threads.md). The
 * desktop app keeps the list and puts environment values in the keychain; this page sees their names only.
 */
export function DesktopLocalMcpSettings({ bridge }: { bridge: DesktopBridge }) {
  const [servers, setServers] = useState<LocalMcpServer[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [checks, setChecks] = useState<Record<string, { busy: boolean; text: string; failed?: boolean }>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void bridge.call("localMcp.list", undefined).then(
      (value) => { if (live) setServers(value.servers); },
      () => { if (live) setServers([]); },
    );
    return () => { live = false; };
  }, [bridge]);

  const remove = async (id: string) => {
    setError("");
    try {
      setServers((await bridge.call("localMcp.remove", { id })).servers);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove this server.");
    }
  };

  const check = async (id: string) => {
    setChecks((current) => ({ ...current, [id]: { busy: true, text: "Starting…" } }));
    try {
      const { tools } = await bridge.call("localMcp.check", { id });
      const names = tools.map((tool) => tool.name);
      const text = names.length
        ? `${names.length} ${names.length === 1 ? "tool" : "tools"}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? "…" : ""}`
        : "Started, with no tools.";
      setChecks((current) => ({ ...current, [id]: { busy: false, text } }));
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "It did not start.";
      setChecks((current) => ({ ...current, [id]: { busy: false, text, failed: true } }));
    }
  };

  return (
    <DesktopSection
      title="MCP servers on this computer"
      description="Agents with MCP servers in their tools can use these in threads that aren’t synced. Overlay starts a server when a thread needs it and asks before each call. Environment values stay in this computer’s keychain."
    >
      <SettingsGroup>
        {servers?.map((server) => {
          const status = checks[server.id];
          return (
            <DesktopRow
              key={server.id}
              title={server.name}
              description={
                <>
                  <span className="block truncate font-mono">{[server.command, ...server.args].join(" ")}</span>
                  {server.envNames.length || server.importedFrom ? (
                    <span className="block truncate">
                      {[server.envNames.join(", "), server.importedFrom ? `From ${server.importedFrom}` : ""].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  {status ? <span className={`block ${status.failed ? "text-destructive" : ""}`}>{status.text}</span> : null}
                </>
              }
              control={
                <>
                  <Button variant="ghost" size="sm" disabled={status?.busy} onClick={() => void check(server.id)}>Test</Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove(server.id)}>Remove</Button>
                </>
              }
            />
          );
        })}
        <DesktopRow
          title={servers?.length ? "Add a server" : "No servers yet"}
          description={adding ? undefined : "Add one by its command, or bring them in from Settings → Import."}
          control={adding ? null : (
            <Button variant="ghost" size="sm" disabled={servers === null} onClick={() => { setAdding(true); setError(""); }}>Add server</Button>
          )}
        >
          {adding ? (
            <AddServerForm
              bridge={bridge}
              onCancel={() => setAdding(false)}
              onSaved={(next) => { setServers(next); setAdding(false); }}
            />
          ) : null}
        </DesktopRow>
      </SettingsGroup>
      {error ? <p role="alert" className="px-1 text-xs text-destructive">{error}</p> : null}
    </DesktopSection>
  );
}

function AddServerForm({ bridge, onCancel, onSaved }: {
  bridge: DesktopBridge;
  onCancel(): void;
  onSaved(servers: LocalMcpServer[]): void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [env, setEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    try {
      const [program, ...args] = splitCommandLine(command.trim());
      if (!program) throw new Error("Enter the command that starts the server.");
      setBusy(true);
      const { servers } = await bridge.call("localMcp.add", {
        name: name.trim() || program.split("/").at(-1)!, command: program, args, env: parseEnvironmentLines(env),
      });
      onSaved(servers);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add this server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Input autoFocus placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} className="h-8 text-sm" />
      <Input
        placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents"
        spellCheck={false}
        autoComplete="off"
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        className="h-8 font-mono text-xs"
      />
      <Textarea
        placeholder={"Environment values, one per line\nAPI_KEY=…"}
        spellCheck={false}
        autoComplete="off"
        rows={3}
        value={env}
        onChange={(event) => setEnv(event.target.value)}
        className="min-h-0 font-mono text-xs"
      />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={busy || !command.trim()}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
