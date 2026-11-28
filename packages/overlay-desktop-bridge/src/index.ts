import { z } from "zod";

export const BRIDGE_VERSION = 1 as const;
export const BRIDGE_CHANNEL = "overlay-desktop:call";
export const BRIDGE_EVENT = "overlay-desktop:event";
export const capabilities = [
  "window",
  "auth",
  "hotkeys",
  "panels",
  "transcription",
  "capture",
  "notifications",
  "agentHost",
  "localComputer",
  "localThreads",
  "localSetup",
  "updates",
  "diagnostics",
] as const;
export type Capability = (typeof capabilities)[number];
const empty = z.undefined();
const panel = z.object({ kind: z.enum(["chat", "notes"]) }).strict();
const modelId = z.enum([
  "parakeet_v2",
  "parakeet_v3",
  "openai_whisper-base",
  "openai_whisper-small",
  "openai_whisper-large-v3_turbo",
]);
const id = z.string().trim().min(1).max(200);
/** Private threads belong to one person in one workspace on this computer. */
const owner = z.object({ userId: id, workspaceId: id }).strict();
const thread = { owner, threadId: id };
export const localModelProviders = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
] as const;
export type LocalModelProvider = (typeof localModelProviders)[number];
/** Plans a person signs in to on this computer (Claude, ChatGPT), used through the desktop's local CLIProxyAPI. */
export const localPlanProviders = ["claude", "chatgpt"] as const;
export type LocalPlanProvider = (typeof localPlanProviders)[number];
/** How a private turn calls its model: a key, a plan, or Overlay's metered models (paid workspaces). */
export const localModelSources = [
  ...localModelProviders,
  ...localPlanProviders,
  "overlay",
] as const;
export type LocalModelSource = (typeof localModelSources)[number];
const localFolder = z.string().trim().min(1).max(4096).startsWith("/");
export const methodSchemas = {
  handshake: empty,
  "window.openDataFolder": empty,
  "window.openExternal": z
    .object({
      url: z
        .string()
        .max(4096)
        .url()
        .refine((value) =>
          ["https:", "http:", "mailto:"].includes(new URL(value).protocol),
        ),
    })
    .strict(),
  "window.setBadgeCount": z
    .object({ count: z.number().int().min(0).max(99999) })
    .strict(),
  "auth.signIn": z.object({ force: z.boolean().optional() }).strict(),
  "auth.signedOut": empty,
  "hotkeys.list": empty,
  "hotkeys.set": z
    .object({
      id: z.enum(["dictation", "chat", "notes"]),
      accelerator: z.string().min(1).max(100),
    })
    .strict(),
  "hotkeys.reset": z
    .object({ id: z.enum(["dictation", "chat", "notes"]) })
    .strict(),
  "panels.show": panel,
  "panels.hide": panel,
  "panels.toggle": panel,
  "panels.setDocked": panel.extend({ edge: z.enum(["left", "right", "none"]) }),
  "transcription.status": empty,
  "transcription.start": z
    .object({
      target: z.enum(["composer", "system"]),
      model: z.union([modelId, z.literal("cloud")]),
    })
    .strict(),
  "transcription.stop": empty,
  "transcription.transcribe": z
    .object({
      audio: z
        .instanceof(Uint8Array)
        .refine((v) => v.byteLength > 0 && v.byteLength <= 25 * 1024 * 1024),
      mime: z.enum(["audio/webm", "audio/mp4", "audio/wav"]),
      model: z.union([modelId, z.literal("cloud")]),
    })
    .strict(),
  "transcription.listModels": empty,
  "transcription.listDevices": empty,
  "transcription.downloadModel": z.object({ id: modelId }).strict(),
  "transcription.configure": z
    .object({
      model: z.union([modelId, z.literal("cloud")]),
      inputDeviceId: z.string().min(1).max(512).optional(),
    })
    .strict(),
  "capture.screenshot": z
    .object({ display: z.string().max(100).optional() })
    .strict(),
  "notifications.show": z
    .object({
      title: z.string().min(1).max(200),
      body: z.string().max(2000),
      route: z
        .string()
        .max(2048)
        .startsWith("/app")
        .refine((v) => !v.startsWith("//") && !v.includes("\\")),
    })
    .strict(),
  "agentHost.status": empty,
  /** Connects this computer as an Overlay Computer: the host serves Overlay's own tools, never a third-party harness. */
  "agentHost.start": z
    .object({
      enrollmentCode: z.string().regex(/^[A-Za-z0-9_-]{6,128}$/),
      localTools: z.literal(true),
    })
    .strict(),
  "agentHost.stop": empty,
  "agentHost.logs": empty,
  "localComputer.status": empty,
  "localComputer.requestPermission": z
    .object({ permission: z.enum(["accessibility", "screen_recording"]) })
    .strict(),
  "localComputer.setKeepAvailable": z
    .object({ enabled: z.boolean() })
    .strict(),
  /** Opens the system's folder dialog. Choosing a folder is the person's consent to let agents work in it. */
  "localComputer.chooseFolder": empty,
  "localThreads.list": z.object({ owner }).strict(),
  "localThreads.get": z.object(thread).strict(),
  /** Choosing "Not synced" before the first message creates the thread on this computer only. */
  "localThreads.create": z
    .object({ ...thread, agentId: id, folder: localFolder.nullable() })
    .strict(),
  "localThreads.send": z
    .object({
      ...thread,
      turnId: id,
      /** The whole transcript as the page holds it (AI SDK UI messages). */
      messages: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .max(2000),
      /** The desktop adds the key, the plan proxy's secret or a token for Overlay's models; the page never holds them. */
      model: z
        .object({
          provider: z.enum(localModelSources),
          modelId: z.string().trim().min(1).max(200),
        })
        .strict(),
      agent: z
        .object({
          name: z.string().trim().min(1).max(200),
          instructions: z.string().max(50_000).optional(),
        })
        .strict(),
      approvalMode: z.enum(["ask", "auto"]),
    })
    .strict(),
  "localThreads.stop": z.object(thread).strict(),
  /** Renames a thread, or changes its folder before the first message. */
  "localThreads.update": z
    .object({
      ...thread,
      title: z.string().trim().min(1).max(200).optional(),
      folder: localFolder.nullable().optional(),
    })
    .strict(),
  "localThreads.delete": z.object(thread).strict(),
  /** Which providers have a key on this computer. Keys never leave the desktop app. */
  "localThreads.keys": empty,
  /** Checks the key with the provider, then stores it in the system keychain; null removes it. */
  "localThreads.setKey": z
    .object({
      provider: z.enum(localModelProviders),
      apiKey: z.string().trim().min(8).max(4096).nullable(),
    })
    .strict(),
  "localThreads.models": z
    .object({ provider: z.enum([...localModelProviders, ...localPlanProviders]) })
    .strict(),
  /** Which plans this computer is signed in to for private threads. Tokens never leave the desktop app. */
  "localThreads.plans": empty,
  /** Opens the provider's sign-in in the browser and resolves once it finishes; tokens go to the system keychain. */
  "localThreads.signIn": z
    .object({ provider: z.enum(localPlanProviders) })
    .strict(),
  /** Stops waiting for a sign-in started with `localThreads.signIn`. */
  "localThreads.cancelSignIn": empty,
  "localThreads.signOut": z
    .object({ provider: z.enum(localPlanProviders) })
    .strict(),
  /** Names and counts of the AI tools' settings on this computer (Claude Code, Codex…); never contents or secrets. */
  "localSetup.scan": empty,
  /** Reads the chosen items again and adds them to the workspace with the app's own session. */
  "localSetup.import": z
    .object({
      workspaceId: id,
      itemIds: z.array(id).min(1).max(200),
      /** The model and tools new agents start with, as the web app picks them for any new agent. */
      agentDefaults: z
        .object({ modelId: id, allowedToolIds: z.array(id).max(300) })
        .strict(),
    })
    .strict(),
  /** Checks a model key found in the login shell's environment, then keeps it in the system keychain. */
  "localSetup.useShellKey": z
    .object({ provider: z.enum(localModelProviders) })
    .strict(),
  "diagnostics.status": empty,
  "diagnostics.configure": z.object({ enabled: z.boolean() }).strict(),
  "updates.status": empty,
  "updates.check": empty,
  "updates.install": empty,
} as const;
export type Method = keyof typeof methodSchemas;
export type Input<M extends Method> = z.input<(typeof methodSchemas)[M]>;
export type Handshake = {
  bridgeVersion: 1;
  appVersion: string;
  platform: string;
  surface?: "main" | "panel";
  capabilities: Capability[];
};
export type HostStatus = {
  state: string;
  pid: number | null;
  logTail: string[];
};
/** This computer as an Overlay Computer: host state, the enrollment phrase it printed, and system permissions. */
export type LocalComputerStatus = {
  hostState: string;
  localTools: boolean;
  verificationPhrase: string | null;
  keepAvailable: boolean;
  homeDirectory: string;
  /** The computer's own name, as its owner sees it in system settings. */
  computerName: string;
  /** The environment this computer connected as, once it has connected. */
  environmentId: string | null;
  /** Where threads without a folder work and where Overlay Files folders are copied. Always approved first. */
  workFolder: string;
  permissions: { accessibility: boolean; screenRecording: boolean };
};
/** A thread that runs and is stored only on this computer. */
export type LocalThread = {
  id: string;
  userId: string;
  workspaceId: string;
  agentId: string;
  title: string;
  folder: string | null;
  /** `provider/model` of the last run. */
  model: string | null;
  createdAt: number;
  updatedAt: number;
};
/** AI SDK UI message, as stored on this computer. */
export type LocalThreadMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  parts: Array<{ type: string } & Record<string, unknown>>;
  metadata?: unknown;
};
export type LocalThreadTurnState = "running" | "finished" | "stopped" | "error";
export type LocalModelKeys = Record<LocalModelProvider, boolean>;
/** A plan on this computer: signed in or not, and the account's email when the provider gives one. */
export type LocalPlanStatus = { signedIn: boolean; account: string | null };
export type LocalPlans = {
  /** False when this copy of Overlay can't run plans (an older app or Agent Host). */
  available: boolean;
  /** Whether this copy of Overlay can run Overlay's metered models in private threads (paid workspaces). */
  overlayModels: boolean;
} & Record<LocalPlanProvider, LocalPlanStatus>;
/** What an AI tool keeps on this computer, and what it becomes in Overlay when imported. */
export type LocalSetupItemKind =
  | "instructions"
  | "skill"
  | "agent"
  | "mcp_remote"
  | "mcp_local";
export type LocalSetupItem = {
  /** Stable for this computer: the app, kind and name. */
  id: string;
  kind: LocalSetupItemKind;
  name: string;
  detail: string;
  /** Local (command) MCP servers can't be imported yet. */
  importable: boolean;
};
export type LocalSetupApp = {
  id: "claude_code" | "codex" | "claude_desktop" | "cursor" | "gemini_cli";
  name: string;
  /** Where its settings live, with the home folder written as `~`. */
  location: string;
  items: LocalSetupItem[];
};
export type LocalSetupScan = {
  apps: LocalSetupApp[];
  /** Model keys set in the login shell's environment; only the variable name and the key's last four characters. */
  shellKeys: { provider: LocalModelProvider; variable: string; hint: string }[];
  /** Whether Claude Code and Codex use a plan on this computer: a hint to sign in to that plan for private threads. */
  subscriptions: { claude: boolean; chatgpt: boolean };
};
export type LocalSetupImportResult = {
  imported: { id: string; kind: LocalSetupItemKind; name: string }[];
  failed: { id: string; name: string; error: string }[];
};
export type UpdateStatus = {
  state: string;
  version?: string;
  percent?: number;
  message?: string;
};
export type TranscriptionStatus = {
  phase?: string;
  firstAudioMs?: number;
  inputDeviceId?: string;
  recording: boolean;
  model: string;
  microphone: string;
  accessibility: boolean;
};
export type Model = { id: string; name: string; downloaded: boolean };
export type Results = {
  handshake: Handshake;
  "window.openDataFolder": void;
  "window.openExternal": void;
  "window.setBadgeCount": void;
  "auth.signIn": void;
  "auth.signedOut": void;
  "hotkeys.list": Record<"dictation" | "chat" | "notes", string>;
  "hotkeys.set": void;
  "hotkeys.reset": void;
  "panels.show": void;
  "panels.hide": void;
  "panels.toggle": void;
  "panels.setDocked": void;
  "transcription.status": TranscriptionStatus;
  "transcription.start": void;
  "transcription.stop": void;
  "transcription.transcribe": { text: string };
  "transcription.listModels": Model[];
  "transcription.listDevices": { id: string; label: string }[];
  "transcription.downloadModel": void;
  "transcription.configure": void;
  "capture.screenshot": { dataUrl: string; name: string };
  "notifications.show": void;
  "agentHost.status": HostStatus;
  "agentHost.start": HostStatus;
  "agentHost.stop": HostStatus;
  "agentHost.logs": string[];
  "localComputer.status": LocalComputerStatus;
  "localComputer.requestPermission": LocalComputerStatus;
  "localComputer.setKeepAvailable": LocalComputerStatus;
  "localComputer.chooseFolder": { path: string } | null;
  "localThreads.list": { threads: LocalThread[]; running: string[] };
  "localThreads.get": {
    thread: LocalThread;
    messages: LocalThreadMessage[];
    running: boolean;
  };
  "localThreads.create": { thread: LocalThread };
  "localThreads.send": { turnId: string };
  "localThreads.stop": { stopped: boolean };
  "localThreads.update": { thread: LocalThread };
  "localThreads.delete": { deleted: boolean };
  "localThreads.keys": LocalModelKeys;
  "localThreads.setKey": LocalModelKeys;
  "localThreads.models": { models: { id: string; name: string }[] };
  "localThreads.plans": LocalPlans;
  "localThreads.signIn": LocalPlans;
  "localThreads.cancelSignIn": void;
  "localThreads.signOut": LocalPlans;
  "localSetup.scan": LocalSetupScan;
  "localSetup.import": LocalSetupImportResult;
  "localSetup.useShellKey": LocalModelKeys;
  "diagnostics.status": { enabled: boolean };
  "diagnostics.configure": void;
  "updates.status": UpdateStatus;
  "updates.check": UpdateStatus;
  "updates.install": void;
};
export type Events = {
  "window.focus": boolean;
  "notifications.click": string;
  "agentHost.status": HostStatus;
  "updates.status": UpdateStatus;
  "transcription.start": { target: "composer" | "system"; model: string };
  "transcription.stop": undefined;
  "transcription.cancel": undefined;
  "transcription.final": { text: string };
  /** One AI SDK UI message stream chunk of a running private turn. */
  "localThreads.chunk": {
    threadId: string;
    turnId: string;
    chunk: { type: string } & Record<string, unknown>;
  };
  "localThreads.turn": {
    threadId: string;
    turnId: string;
    state: LocalThreadTurnState;
    error?: string;
  };
  /** The thread list of this person in this workspace changed. */
  "localThreads.threads": { userId: string; workspaceId: string };
};
export interface DesktopBridge {
  handshake(): Promise<Handshake>;
  call<M extends Method>(method: M, input: Input<M>): Promise<Results[M]>;
  on<E extends keyof Events>(
    event: E,
    callback: (value: Events[E]) => void,
  ): () => void;
}
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { overlayDesktop?: DesktopBridge })
    .overlayDesktop;
  return bridge &&
    typeof bridge.handshake === "function" &&
    typeof bridge.call === "function" &&
    typeof bridge.on === "function"
    ? bridge
    : null;
}
export function capabilityForMethod(method: Method): Capability | null {
  return method === "handshake" ? null : (method.split(".")[0] as Capability);
}
export function isTrustedFrame(
  frameUrl: string,
  isMainFrame: boolean,
  origin: string,
): boolean {
  try {
    return isMainFrame && new URL(frameUrl).origin === origin;
  } catch {
    return false;
  }
}
export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(
    url,
    typeof location === "undefined" ? undefined : location.href,
  );
  if (!["http:", "https:", "mailto:"].includes(parsed.protocol))
    throw new Error("Unsupported external URL");
  const bridge = getDesktopBridge();
  if (bridge && (await bridge.handshake()).capabilities.includes("window")) {
    await bridge.call("window.openExternal", { url: parsed.href });
  } else if (typeof window !== "undefined") {
    window.open(parsed.href, "_blank", "noopener,noreferrer");
  }
}

/** Stop native work even when sign-out happens outside the workspace shell. */
export async function notifyDesktopSignedOut(): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        if ((await bridge.handshake()).capabilities.includes("auth"))
          await bridge.call("auth.signedOut", undefined);
      })(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1500);
      }),
    ]);
  } catch {
    /* Native cleanup must never prevent the normal web sign-out. */
  } finally {
    if (timer) clearTimeout(timer);
  }
}
