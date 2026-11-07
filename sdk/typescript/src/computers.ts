import type { HttpTransport } from "./_http.js";

export interface ComputerMetricSummary {unit: string; average: number | null; maximum: number | null; samples: number; last_sample_at: string | null}
export interface ComputerUsageHistory {
  machine_id: string; source: string; from: string; to: string; resolution_seconds: number;
  sample_interval_seconds: number; missing_intervals: string;
  items: {at: string; values: Record<string, ComputerMetricSummary>}[];
}
export interface ComputerConversation {id: string; label: string}
export interface ComputerConversationList {machine_id: string; status: string; conversations: ComputerConversation[]; truncated?: boolean}
export interface ComputerConversationHistory {
  machine_id: string; status: string; session_id?: string; next_before?: string | null;
  messages?: {id: string; role: string; text: string; truncated: boolean}[];
}
export interface ComputerSessionRun {id: string; state: string; terminal: boolean; created_at: string}

/** Read-only observations; these methods never start a computer. */
export class ComputersResource {
  constructor(private readonly http: HttpTransport) {}
  usageHistory(machineId: string, window: "1h" | "24h" | "7d" | "30d" = "24h"): Promise<ComputerUsageHistory> {
    return this.http.get(`/computers/machines/${encodeURIComponent(machineId)}/usage/history`, {window});
  }
  conversations(machineId: string): Promise<ComputerConversationList> {
    return this.http.get(`/computers/machines/${encodeURIComponent(machineId)}/conversations`);
  }
  conversation(machineId: string, sessionId: string, before?: string): Promise<ComputerConversationHistory> {
    return this.http.get(`/computers/machines/${encodeURIComponent(machineId)}/conversations`, {session_id: sessionId, before});
  }
  async sessionRuns(sessionId: string): Promise<ComputerSessionRun[]> {
    const data = await this.http.get<{items: ComputerSessionRun[]}>(`/computers/sessions/${encodeURIComponent(sessionId)}/runs`);
    return data.items;
  }
}
