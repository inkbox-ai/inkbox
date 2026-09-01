import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { InkboxAPIError } from "@inkbox/sdk";

async function readAllStdin(): Promise<string> {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
}

/** Read a secret from stdin so it never appears in argv or shell history. */
export async function readSecretFromStdin(what: string): Promise<string> {
  const value = await readAllStdin();
  if (!value) throw new Error(`No ${what} was provided on stdin.`);
  return value;
}

async function hiddenPrompt(stdinOption = "--token-stdin"): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `No invitation available. Set INKBOX_A2A_INVITATION or use ${stdinOption}.`,
    );
  }
  process.stderr.write("Invitation link or token: ");
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const terminal = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  try {
    const token = (await terminal.question("")).trim();
    process.stderr.write("\n");
    return token;
  } finally {
    terminal.close();
  }
}

/** Resolve a secret without accepting it as a command-line argument. */
export async function resolveA2AInvitationToken(fromStdin: boolean): Promise<string> {
  const fromEnv = invitationFromEnvironment();
  if (fromStdin && fromEnv) {
    throw new Error("Use only one invitation input source.");
  }
  if (fromStdin) {
    const invitation = await readAllStdin();
    if (!invitation) throw new Error("No invitation was provided on stdin.");
    return invitation;
  }
  if (fromEnv) return fromEnv;
  const invitation = await hiddenPrompt();
  if (!invitation) throw new Error("An invitation is required.");
  return invitation;
}

/** Resolve an optional signup token without prompting ordinary signup flows. */
export async function resolveOptionalA2AInvitationToken(
  fromStdin: boolean,
  fromPrompt: boolean,
  promptReader: () => Promise<string> = () => hiddenPrompt("--invitation-stdin"),
): Promise<string | undefined> {
  if (fromStdin && fromPrompt) {
    throw new Error(
      "Use only one of --invitation-token-stdin or --invitation-token-prompt.",
    );
  }
  const fromEnv = invitationFromEnvironment();
  if ((fromStdin || fromPrompt) && fromEnv) {
    throw new Error("Use only one invitation input source.");
  }
  if (fromStdin) {
    const invitation = await readAllStdin();
    if (!invitation) throw new Error("No invitation was provided on stdin.");
    return invitation;
  }
  if (fromPrompt) {
    const invitation = (await promptReader()).trim();
    if (!invitation) throw new Error("An invitation is required.");
    return invitation;
  }
  return fromEnv;
}

function invitationFromEnvironment(): string | undefined {
  const neutral = process.env.INKBOX_A2A_INVITATION?.trim();
  const legacy = process.env.INKBOX_A2A_INVITATION_TOKEN?.trim();
  if (neutral && legacy) {
    throw new Error(
      "Set only one of INKBOX_A2A_INVITATION or INKBOX_A2A_INVITATION_TOKEN.",
    );
  }
  return neutral || legacy || undefined;
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    return secrets.reduce(
      (redacted, secret) => secret ? redacted.split(secret).join("[REDACTED]") : redacted,
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]),
    );
  }
  return value;
}

/** Preserve an API error while ensuring it cannot reflect the submitted secret. */
export function redactSecretError(error: unknown, ...secrets: string[]): Error {
  if (error instanceof InkboxAPIError) {
    return new InkboxAPIError(
      error.statusCode,
      redactValue(error.detail, secrets) as typeof error.detail,
      error.retryAfterSeconds,
      redactValue(error.agentSupport, secrets) as typeof error.agentSupport,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const safe = redactValue(message, secrets) as string;
  const redacted = new Error(safe);
  if (error instanceof Error) redacted.name = error.name;
  return redacted;
}
