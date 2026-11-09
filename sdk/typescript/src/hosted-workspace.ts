import { HttpTransport, validateIdempotencyKey } from "./_http.js";
export interface ChatCapabilities {
  permission_mode_selection?: boolean;
  model_selection?: boolean;
  send_message: boolean;
  cancel_turn: boolean;
  approvals: boolean;
  questions: boolean;
  attachments: boolean;
  tool_activity: boolean;
}
export interface ChatConversation {
  permission_mode?: "ask" | "yolo";
  created_at?: string | null;
  last_active_at?: string | null;
  id: string;
  identity_id?: string | null;
  title: string;
  origin: "chat" | "communication" | "schedule";
  capabilities: ChatCapabilities;
  history_completeness: "complete" | "partial" | "unavailable";
}
export interface ChatTurn {
  id: string;
  conversation_id: string;
  status:
    | "queued"
    | "running"
    | "waiting_for_input"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "outcome_unknown";
  terminal: boolean;
  blocker?: WorkspaceBlocker | null;
}
export interface WorkspaceBlocker {
  code: string;
  message: string;
  scope: "organization" | "agent" | "turn";
  retryable: boolean;
  actions: string[];
}
export type ChatContent =
  | { type: "text"; text: string }
  | { type: "file"; file_id: string };
export type ChatAnswer =
  | { kind: "approval"; decision: "approve_once" | "deny" }
  | { kind: "question"; answers: Record<string, string | string[]> };
export interface ChatResource {
  id: string;
  revision?: number | null;
  created_sequence?: number | null;
  turn_id?: string | null;
  resource_type?:
    | "message"
    | "turn"
    | "tool"
    | "interaction"
    | "artifact"
    | null;
}
export interface ChatMessage extends ChatResource {
  phase?: "commentary" | "final_answer" | null;
  role: "user" | "assistant";
  content?: ({ type: "text"; text: string } | HostedFile)[];
  completed?: boolean;
}
export interface ChatTool extends ChatResource {
  title: string;
  status: "running" | "completed" | "failed";
  detail?: string | null;
}
export interface ChatQuestionField {
  id: string;
  label: string;
  required: boolean;
  type: "text" | "single_select" | "multi_select";
  choices?: { id: string; label: string }[];
  allow_free_text?: boolean;
}
export interface ChatInteraction extends ChatResource {
  auto_approve?: boolean;
  decision?: "approve_once" | "deny" | null;
  kind: "approval" | "question";
  version: number;
  status: "pending" | "submitted" | "resolved" | "expired" | "cancelled";
  expires_at: string;
  title: string;
  detail?: string | null;
  effective_scope?: "operation" | "turn" | null;
  tool_call_id?: string | null;
  decisions?: ("approve_once" | "deny")[] | null;
  fields?: ChatQuestionField[] | null;
}
export interface ChatTurnUpdate extends ChatResource {
  status: ChatTurn["status"];
  terminal: boolean;
  conversation_id?: string | null;
  blocker?: WorkspaceBlocker | null;
}
export interface ChatArtifact extends ChatResource {
  file_id: string;
  name: string;
  media_type: string;
  size_bytes: number;
  availability: HostedFile["availability"];
}
export type ChatProjection =
  | ChatMessage
  | ChatTool
  | ChatInteraction
  | ChatTurnUpdate
  | ChatArtifact;
export interface ChatEnvelope {
  schema_version: 1;
  id: string;
  sequence: number;
  conversation_id: string;
  turn_id: string | null;
  created_at: string;
  cursor?: string | null;
}
export type ChatEvent = ChatEnvelope &
  (
    | { type: "message.created" | "message.completed"; data: ChatMessage }
    | { type: "message.delta"; data: { id: string; text: string } }
    | { type: "turn.updated"; data: ChatTurnUpdate }
    | {
        type: "tool.started" | "tool.updated" | "tool.completed";
        data: ChatTool;
      }
    | {
        type: "interaction.created" | "interaction.updated";
        data: ChatInteraction;
      }
    | { type: "artifact.created"; data: ChatArtifact }
  );
export interface ChatEventPage {
  items: ChatEvent[];
  next_cursor: string;
}
export interface ChatSnapshot extends ChatConversation {
  sequence: number;
  snapshot_token: string;
  event_cursor: string;
  items: ChatProjection[];
  pending_interactions: ChatInteraction[];
  current_turn: ChatTurnUpdate | null;
  next_cursor: string | null;
}
export interface WorkspacePage<T> {
  items: T[];
  next_cursor: string | null;
}
export interface ScheduleOutputReference {
  conversation_id: string;
  message_id: string;
  availability: "available" | "unavailable";
}
export interface ScheduleOccurrence {
  id: string;
  intended_due_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  output_references?: ScheduleOutputReference[];
  state: string;
  reason: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface ScheduleHistory {
  items: ScheduleOccurrence[];
  conversation_id: string | null;
  history_completeness: "partial" | "unavailable";
}
export type ScheduleTiming =
  | { kind: "once"; at: string; timezone?: string }
  | { kind: "interval"; seconds: number; timezone?: string }
  | { kind: "cron"; expression: string; timezone?: string };
export interface ScheduleFields {
  name?: string;
  task?:
    | { kind: "prompt"; prompt: string }
    | { kind: "script"; script: string };
  timing?: ScheduleTiming;
  enabled?: boolean;
  catch_up?: boolean;
  reauthorize?: boolean;
}
export interface ScheduleReceipt {
  command_id: string;
  state: "applied";
  registration_status: string;
  schedule_id: string;
  revision: number;
  deleted: boolean;
}
export interface HostedFile {
  type: "file";
  file_id: string;
  name: string;
  media_type: string;
  size_bytes: number;
  availability:
    | "available"
    | "computer_start_required"
    | "unavailable"
    | "deleted";
}
type ObjectValue = Record<string, unknown>;
const enc = encodeURIComponent;
/** Identity-scoped workspace. Reads never start compute. Resource fields use the API's snake_case. */
export class HostedWorkspace {
  private readonly base: string;
  constructor(
    private readonly http: HttpTransport,
    handle: string,
  ) {
    this.base = `/${enc(handle)}/hosting`;
  }
  private key(key: string) {
    validateIdempotencyKey(key);
    return { headers: { "Idempotency-Key": key } };
  }
  streamEvents(
    conversation: string,
    after?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    return this.http.streamEvents(
      `${this.base}/chat/conversations/${enc(conversation)}/events`,
      after,
      signal,
    );
  }
  status(): Promise<ObjectValue> {
    return this.http.get(`${this.base}/workspace`, {});
  }
  conversations(
    after?: string,
    limit = 50,
  ): Promise<WorkspacePage<ChatConversation>> {
    return this.http.get(`${this.base}/chat/conversations`, { after, limit });
  }
  createConversation(title: string, key: string): Promise<ChatConversation> {
    return this.http.post(
      `${this.base}/chat/conversations`,
      { title },
      this.key(key),
    );
  }
  snapshot(conversation: string): Promise<ChatSnapshot> {
    return this.http.get(
      `${this.base}/chat/conversations/${enc(conversation)}`,
      {},
    );
  }
  renameConversation(conversation: string, title: string, key: string): Promise<ChatConversation> {
    return this.http.patch(
      `${this.base}/chat/conversations/${enc(conversation)}`,
      { title },
      this.key(key),
    );
  }
  setPermissionMode(conversation: string, mode: "ask" | "yolo", key: string): Promise<ChatConversation> {
    if (mode !== "ask" && mode !== "yolo") throw new Error("mode must be ask or yolo");
    return this.http.patch(
      `${this.base}/chat/conversations/${enc(conversation)}`,
      { permission_mode: mode },
      this.key(key),
    );
  }
  messages(
    conversation: string,
    after?: string,
    snapshot?: string,
    limit = 50,
  ): Promise<WorkspacePage<ChatProjection> & { sequence: number }> {
    return this.http.get(
      `${this.base}/chat/conversations/${enc(conversation)}/messages`,
      { after, snapshot, limit },
    );
  }
  events(
    conversation: string,
    after?: string,
    limit = 50,
  ): Promise<ChatEventPage> {
    return this.http.get(
      `${this.base}/chat/conversations/${enc(conversation)}/events`,
      { after, limit },
    );
  }
  send(
    conversation: string,
    content: ChatContent[],
    key: string,
    model?: string,
  ): Promise<ChatTurn> {
    return this.http.post(
      `${this.base}/chat/conversations/${enc(conversation)}/turns`,
      { content, ...(model === undefined ? {} : { model }) },
      this.key(key),
    );
  }
  turn(conversation: string, turn: string): Promise<ChatTurn> {
    return this.http.get(
      `${this.base}/chat/conversations/${enc(conversation)}/turns/${enc(turn)}`,
      {},
    );
  }
  cancel(
    conversation: string,
    turn: string,
    key: string,
  ): Promise<ObjectValue> {
    return this.http.post(
      `${this.base}/chat/conversations/${enc(conversation)}/turns/${enc(turn)}/cancel`,
      {},
      this.key(key),
    );
  }
  respond(
    conversation: string,
    interaction: string,
    expectedVersion: number,
    response: ChatAnswer,
    key: string,
  ): Promise<ObjectValue> {
    return this.http.post(
      `${this.base}/chat/conversations/${enc(conversation)}/interactions/${enc(interaction)}/response`,
      { expected_version: expectedVersion, response },
      this.key(key),
    );
  }
  uploadFile(
    name: string,
    dataBase64: string,
    key: string,
    mediaType = "application/octet-stream",
  ): Promise<ObjectValue> {
    return this.http.post(
      `${this.base}/chat/files`,
      { name, data_base64: dataBase64, media_type: mediaType },
      this.key(key),
    );
  }
  file(file: string): Promise<HostedFile> {
    return this.http.get(`${this.base}/chat/files/${enc(file)}`, {});
  }
  downloadFile(
    file: string,
  ): Promise<{ file_id: string; data_base64: string }> {
    return this.http.get(`${this.base}/chat/files/${enc(file)}/content`, {});
  }
  start(key: string): Promise<ObjectValue> {
    return this.http.post(
      `${this.base}/workspace/actions/start`,
      {},
      this.key(key),
    );
  }
  stop(key: string): Promise<ObjectValue> {
    return this.http.post(
      `${this.base}/workspace/actions/stop`,
      {},
      this.key(key),
    );
  }
  operation(operation: string): Promise<ObjectValue> {
    return this.http.get(
      `${this.base}/workspace/operations/${enc(operation)}`,
      {},
    );
  }
  environment(): Promise<ObjectValue> {
    return this.http.get(`${this.base}/workspace/environment`, {});
  }
  updateEnvironment(options: ObjectValue): Promise<ObjectValue> {
    return this.http.put(`${this.base}/workspace/environment`, options, {});
  }
  usage(): Promise<ObjectValue> {
    return this.http.get(`${this.base}/workspace/usage`, {});
  }
  usageHistory(
    window: "1h" | "24h" | "7d" | "30d" = "24h",
  ): Promise<ObjectValue> {
    return this.http.get(`${this.base}/workspace/usage/history`, { window });
  }
  terminals(after?: string, limit = 50): Promise<WorkspacePage<ObjectValue>> {
    return this.http.get(`${this.base}/workspace/terminals`, { after, limit });
  }
  createTerminal(options: ObjectValue, key: string): Promise<ObjectValue> {
    return this.http.post(
      `${this.base}/workspace/terminals`,
      options,
      this.key(key),
    );
  }
  terminalTicket(terminal: string): Promise<ObjectValue> {
    return this.http.post(
      `${this.base}/workspace/terminals/${enc(terminal)}/ticket`,
      {},
      {},
    );
  }
  closeTerminal(terminal: string, key: string): Promise<ObjectValue> {
    return this.http.post(
      `${this.base}/workspace/terminals/${enc(terminal)}/close`,
      {},
      this.key(key),
    );
  }
  schedules(after?: string, limit = 50): Promise<WorkspacePage<ObjectValue>> {
    return this.http.get(`${this.base}/workspace/schedules`, { after, limit });
  }
  createSchedule(
    fields: ScheduleFields,
    key: string,
  ): Promise<ScheduleReceipt> {
    return this.http.post(
      `${this.base}/workspace/schedules`,
      { expected_revision: 0, fields },
      this.key(key),
    );
  }
  updateSchedule(
    schedule: string,
    expectedRevision: number,
    fields: ScheduleFields,
    key: string,
  ): Promise<ScheduleReceipt> {
    return this.http.put(
      `${this.base}/workspace/schedules/${enc(schedule)}`,
      { expected_revision: expectedRevision, fields },
      this.key(key),
    );
  }
  deleteSchedule(
    schedule: string,
    expectedRevision: number,
    key: string,
  ): Promise<ScheduleReceipt> {
    return this.http.deleteWithResponse(
      `${this.base}/workspace/schedules/${enc(schedule)}`,
      {
        ...this.key(key),
        body: { expected_revision: expectedRevision, fields: {} },
      },
    );
  }
  previewSchedule(
    timing: ScheduleTiming,
  ): Promise<{ timing: ScheduleTiming; next_occurrences: string[] }> {
    return this.http.post(
      `${this.base}/workspace/schedules/preview`,
      { timing },
      {},
    );
  }
  scheduleHistory(schedule: string): Promise<ScheduleHistory> {
    return this.http.get(
      `${this.base}/workspace/schedules/${enc(schedule)}/occurrences`,
      {},
    );
  }
}
