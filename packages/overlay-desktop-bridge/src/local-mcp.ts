import { z } from "zod";

/** Environment variable names a local MCP server is started with. */
export const localMcpEnvName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(200);

/** An MCP server that runs on this computer. Environment values stay in the keychain; only their names are here. */
export type LocalMcpServer = {
  id: string;
  name: string;
  command: string;
  args: string[];
  envNames: string[];
  /** The app it was imported from (Claude Code, Cursor…), or null when added by hand. */
  importedFrom: string | null;
  addedAt: number;
};

/**
 * Splits a command line typed in Settings → Desktop into the program and its arguments, honouring single and double quotes and
 * backslash escapes. No shell runs it: `$VAR`, globs and pipes are passed as written.
 */
export function splitCommandLine(line: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  let started = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && index + 1 < line.length) current += line[++index]
      else current += char
    } else if (char === '"' || char === '\'') {
      quote = char
      started = true
    } else if (char === '\\' && index + 1 < line.length) {
      current += line[++index]
      started = true
    } else if (/\s/.test(char)) {
      if (started) words.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (quote) throw new Error('A quote in the command is not closed.')
  if (started) words.push(current)
  return words
}

/** Environment values typed in Settings → Desktop: `NAME=value` lines; blank lines and `#` comments are skipped. */
export function parseEnvironmentLines(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`“${line.split("=")[0]}” isn’t an environment value. Write NAME=value.`);
    env[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}
