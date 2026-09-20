import { AsyncLocalStorage } from "node:async_hooks";
import type { ResponseMetadata, ResponseNotice } from "@inkbox/sdk";
import type { Command } from "commander";

export const commandOutput = new AsyncLocalStorage<{
  json: boolean;
  envelope: boolean;
  notices: ResponseNotice[];
  data: unknown;
}>();

export function observeResponse(metadata: ResponseMetadata): void {
  const state = commandOutput.getStore();
  if (!state) return;
  for (const notice of metadata.notices ?? []) {
    if (!state.notices.some((item) => item.code === notice.code && item.level === notice.level && item.message === notice.message)) {
      state.notices.push({ ...notice });
    }
  }
}

export function noticeFields(): { notices?: ResponseNotice[] } {
  const notices = commandOutput.getStore()?.notices;
  return notices?.length ? { notices } : {};
}

export function terminalSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function diagnosticJson(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space).replace(/[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, terminalSafe);
}

export function renderNotices(): void {
  const state = commandOutput.getStore();
  if (!state?.notices.length) return;
  if (state.json) {
    console.error(diagnosticJson(noticeFields()));
  } else {
    for (const notice of state.notices) console.error(`Notice (${terminalSafe(notice.level)}): ${terminalSafe(notice.message)}`);
  }
}

export function validateMetadataOutput(command: Command | undefined): void {
  const state = commandOutput.getStore();
  if (!state?.envelope) return;
  if (!state.json) throw new Error("--with-response-metadata requires --json");
  if (command?.name?.() === "sign-csr" && command.parent?.name() === "tunnel" && !command.opts().out) {
    throw new Error("--with-response-metadata is not supported for certificate stdout; supply --out");
  }
}

export function finishCommandOutput(): void {
  const state = commandOutput.getStore();
  if (state?.envelope) {
    console.log(diagnosticJson({ data: state.data ?? null, ...noticeFields() }, 2));
  } else {
    renderNotices();
  }
}
