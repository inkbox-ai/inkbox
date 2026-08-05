import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { InkboxAPIError } from "@inkbox/sdk";

async function readAllStdin(): Promise<string> {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
}

async function hiddenPrompt(stdinOption = "--token-stdin"): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `No invitation token available. Set INKBOX_A2A_INVITATION_TOKEN or use ${stdinOption}.`,
    );
  }
  process.stderr.write("Invitation token: ");
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
  if (fromStdin) {
    const token = await readAllStdin();
    if (!token) throw new Error("No invitation token was provided on stdin.");
    return token;
  }
  const fromEnv = process.env.INKBOX_A2A_INVITATION_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const token = await hiddenPrompt();
  if (!token) throw new Error("An invitation token is required.");
  return token;
}

/** Resolve an optional signup token without prompting ordinary signup flows. */
export async function resolveOptionalA2AInvitationToken(
  fromStdin: boolean,
  fromPrompt: boolean,
  promptReader: () => Promise<string> = () => hiddenPrompt("--invitation-token-stdin"),
): Promise<string | undefined> {
  if (fromStdin && fromPrompt) {
    throw new Error(
      "Use only one of --invitation-token-stdin or --invitation-token-prompt.",
    );
  }
  if (fromStdin) {
    const token = await readAllStdin();
    if (!token) throw new Error("No invitation token was provided on stdin.");
    return token;
  }
  if (fromPrompt) {
    const token = (await promptReader()).trim();
    if (!token) throw new Error("An invitation token is required.");
    return token;
  }
  return process.env.INKBOX_A2A_INVITATION_TOKEN?.trim() || undefined;
}

function redactValue(value: unknown, secret: string): unknown {
  if (typeof value === "string") return value.split(secret).join("[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secret));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, secret)]),
    );
  }
  return value;
}

/** Preserve an API error while ensuring it cannot reflect the submitted secret. */
export function redactSecretError(error: unknown, secret: string): Error {
  if (error instanceof InkboxAPIError) {
    return new InkboxAPIError(
      error.statusCode,
      redactValue(error.detail, secret) as typeof error.detail,
      error.retryAfterSeconds,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const safe = secret ? message.split(secret).join("[REDACTED]") : message;
  const redacted = new Error(safe);
  if (error instanceof Error) redacted.name = error.name;
  return redacted;
}
